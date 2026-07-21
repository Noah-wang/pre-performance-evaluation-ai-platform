import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { SectionHeader, StatTile, StatusPill } from "@/components/ui-kit";
import {
  BadgeDollarSign, ExternalLink, FileCheck2, Plus, Save, Search, ShieldCheck, Trash2, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  BudgetCostItem,
  CostAnalysisData,
  EVIDENCE_SOURCE_LABELS,
  EvidenceSource,
  emptyCostItem,
  normalizeCostAnalysis,
  summarizeCostAnalysis,
} from "@/lib/costAnalysis";
import { buildEconomicAnalysis } from "@/lib/economicAnalysis";

interface ProjectForCostAnalysis {
  id: string;
  name: string;
  budget: number;
  unit: string;
  custom_fields: unknown;
}

interface Props {
  project: ProjectForCostAnalysis;
  onSaved?: () => void;
}

const yuan = (value: number) => `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;

export const CostAnalysisPanel = ({ project, onSaved }: Props) => {
  const [data, setData] = useState<CostAnalysisData>(() => normalizeCostAnalysis(project.custom_fields));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setData(normalizeCostAnalysis(project.custom_fields));
  }, [project.custom_fields, project.id]);

  const summary = useMemo(() => summarizeCostAnalysis(data.items), [data.items]);
  const analysisText = useMemo(
    () => buildEconomicAnalysis({ ...project, custom_fields: { cost_analysis: data } }),
    [data, project],
  );

  const updateItem = (id: string, patch: Partial<BudgetCostItem>) => {
    setData((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  };

  const removeItem = (id: string) => {
    setData((current) => ({ ...current, items: current.items.filter((item) => item.id !== id) }));
  };

  const addItem = () => {
    setData((current) => ({ ...current, items: [...current.items, emptyCostItem()] }));
  };

  const save = async () => {
    const namedItems = data.items.filter((item) => item.name.trim());
    if (!namedItems.length) return toast.error("请至少填写一项预算明细");
    if (namedItems.some((item) => item.quantity <= 0 || item.declaredUnitPrice < 0)) {
      return toast.error("数量必须大于 0，申报单价不能为负数");
    }

    setSaving(true);
    const currentFields = project.custom_fields && typeof project.custom_fields === "object"
      ? project.custom_fields as Record<string, unknown>
      : {};
    const nextAnalysis: CostAnalysisData = {
      items: namedItems,
      overallNote: data.overallNote.trim(),
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from("projects").update({
      custom_fields: {
        ...currentFields,
        cost_analysis: nextAnalysis,
      },
    }).eq("id", project.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setData(nextAnalysis);
    toast.success("预算合理性与节约分析已保存，生成报告时会自动引用");
    onSaved?.();
  };

  const openEvidenceSearch = (item: BudgetCostItem) => {
    const keyword = [project.name, item.name, item.specification, "中标 价格"].filter(Boolean).join(" ");
    window.open(`https://www.bing.com/search?q=${encodeURIComponent(keyword)}`, "_blank", "noopener,noreferrer");
  };

  const budgetGap = summary.declaredTotal - Number(project.budget || 0);
  const evidenceTone = summary.coverage >= 0.8 ? "success" : summary.coverage >= 0.6 ? "gold" : "warning";

  return (
    <div className="space-y-5">
      <Card className="surface-card overflow-hidden">
        <CardContent className="p-6">
          <SectionHeader
            eyebrow="预算明细 · 客观证据 · 节约测算"
            title="项目资金合理性与成本节约分析"
            icon={BadgeDollarSign}
            actions={
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4" />添加预算项
                </Button>
                <Button variant="hero" size="sm" onClick={save} disabled={saving}>
                  <Save className="h-4 w-4" />{saving ? "保存中…" : "保存分析"}
                </Button>
              </div>
            }
          />
          <p className="text-sm text-muted-foreground max-w-4xl leading-relaxed">
            逐项录入预算数量和申报单价，并引用政府采购中标公告、公共资源交易结果、造价信息、市场询价、历史合同或政策定额。系统只对有客观来源的项目测算合理金额和节约空间。
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatTile label="预算明细合计" value={yuan(summary.declaredTotal)} hint={`项目申报预算 ${yuan(Number(project.budget || 0))}`} icon={WalletCards} tone="info" />
        <StatTile label="证据覆盖率" value={`${(summary.coverage * 100).toFixed(0)}%`} hint={`${summary.evidenceCount}/${summary.results.length} 项有价格证据`} icon={FileCheck2} tone={evidenceTone} />
        <StatTile label="建议合理金额" value={yuan(summary.reasonableTotal)} hint="按已录入客观参考价测算" icon={ShieldCheck} tone="success" />
        <StatTile label="潜在节约空间" value={yuan(summary.potentialSaving)} hint={`占明细金额 ${(summary.savingRate * 100).toFixed(1)}%`} icon={BadgeDollarSign} tone={summary.potentialSaving > 0 ? "gold" : "neutral"} />
      </div>

      <Card className="surface-card overflow-hidden p-0">
        <div className="px-5 py-4 border-b border-border bg-muted/25 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display font-semibold text-foreground">预算明细与价格证据</div>
            <div className="text-xs text-muted-foreground mt-1">参考价必须填写来源标题或链接；调整比例用于处理规格、区域、年度和服务范围差异。</div>
          </div>
          <StatusPill tone={Math.abs(budgetGap) <= 1 ? "success" : "warning"} dot={false}>
            {Math.abs(budgetGap) <= 1
              ? "明细合计与项目预算一致"
              : `与项目预算相差 ${yuan(Math.abs(budgetGap))}`}
          </StatusPill>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[1500px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[210px]">预算项目</TableHead>
                <TableHead className="w-[160px]">规格/服务范围</TableHead>
                <TableHead className="w-[85px]">单位</TableHead>
                <TableHead className="w-[95px] text-right">数量</TableHead>
                <TableHead className="w-[125px] text-right">申报单价（元）</TableHead>
                <TableHead className="w-[165px]">证据类型</TableHead>
                <TableHead className="w-[230px]">来源标题/文件</TableHead>
                <TableHead className="w-[220px]">来源链接</TableHead>
                <TableHead className="w-[130px] text-right">参考单价（元）</TableHead>
                <TableHead className="w-[110px] text-right">调整比例</TableHead>
                <TableHead className="w-[160px]">判断</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => {
                const result = summary.results.find((row) => row.id === item.id);
                const tone = result?.judgment === "价格偏高"
                  ? "warning"
                  : result?.judgment === "基本合理"
                    ? "success"
                    : result?.judgment === "价格偏低"
                      ? "info"
                      : "neutral";
                return (
                  <TableRow key={item.id} className="align-top">
                    <TableCell>
                      <Input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} placeholder="如：系统开发服务" />
                    </TableCell>
                    <TableCell>
                      <Input value={item.specification} onChange={(event) => updateItem(item.id, { specification: event.target.value })} placeholder="规模、期限、参数" />
                    </TableCell>
                    <TableCell>
                      <Input value={item.unit} onChange={(event) => updateItem(item.id, { unit: event.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" type="number" min="0" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" type="number" min="0" value={item.declaredUnitPrice} onChange={(event) => updateItem(item.id, { declaredUnitPrice: Number(event.target.value) })} />
                      <div className="text-[10px] text-muted-foreground text-right mt-1">{yuan(result?.declaredAmount ?? 0)}</div>
                    </TableCell>
                    <TableCell>
                      <Select value={item.evidenceSource} onValueChange={(value: EvidenceSource) => updateItem(item.id, { evidenceSource: value })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(EVIDENCE_SOURCE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input value={item.evidenceTitle} onChange={(event) => updateItem(item.id, { evidenceTitle: event.target.value })} placeholder="公告、合同或询价单名称" />
                      <Input className="mt-2" type="date" value={item.evidenceDate} onChange={(event) => updateItem(item.id, { evidenceDate: event.target.value })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Input value={item.evidenceUrl} onChange={(event) => updateItem(item.id, { evidenceUrl: event.target.value })} placeholder="https://…" />
                        {item.evidenceUrl ? (
                          <Button variant="ghost" size="icon" asChild>
                            <a href={item.evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" onClick={() => openEvidenceSearch(item)} title="检索公开价格证据">
                            <Search className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" type="number" min="0" value={item.benchmarkUnitPrice} onChange={(event) => updateItem(item.id, { benchmarkUnitPrice: Number(event.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input className="text-right" type="number" value={item.adjustmentRate} onChange={(event) => updateItem(item.id, { adjustmentRate: Number(event.target.value) })} />
                      <div className="text-[10px] text-muted-foreground mt-1">正数上调，负数下调</div>
                      <Input
                        className="mt-2"
                        value={item.adjustmentNote}
                        onChange={(event) => updateItem(item.id, { adjustmentNote: event.target.value })}
                        placeholder="规格/年度差异"
                      />
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={tone} dot={false}>{result?.judgment ?? "证据不足"}</StatusPill>
                      {result?.deviationRate !== null && result?.deviationRate !== undefined && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          偏差 {(result.deviationRate * 100).toFixed(1)}%
                        </div>
                      )}
                      {result && result.potentialSaving > 0 && (
                        <div className="text-[10px] text-gold-soft mt-1">可节约 {yuan(result.potentialSaving)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!data.items.length && (
                <TableRow>
                  <TableCell colSpan={12} className="h-28 text-center text-muted-foreground">
                    暂无预算明细，点击“添加预算项”开始分析。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-5">
        <Card className="surface-card">
          <CardContent className="p-5 space-y-4">
            <div>
              <Label>可比性调整与人工说明</Label>
              <p className="text-xs text-muted-foreground mt-1">说明为什么参考价格可比、有哪些规格或服务范围差异，以及拟采取的节约措施。</p>
            </div>
            <Textarea
              value={data.overallNote}
              onChange={(event) => setData((current) => ({ ...current, overallNote: event.target.value }))}
              placeholder="例如：参考项目服务期为一年，本项目为两年，因此已按服务期限调整；建议采用竞争性采购并合并重复培训场次。"
              className="min-h-[150px]"
            />
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">客观证据覆盖度</span>
                <span className="font-mono">{(summary.coverage * 100).toFixed(1)}%</span>
              </div>
              <Progress value={summary.coverage * 100} />
            </div>
          </CardContent>
        </Card>

        <Card className="surface-card">
          <CardContent className="p-5">
            <SectionHeader eyebrow="自动生成 · 可追溯口径" title="项目经济性分析意见" icon={ShieldCheck} />
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90 rounded-lg border border-border bg-muted/25 p-4">
              {analysisText}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

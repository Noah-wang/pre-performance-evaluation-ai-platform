import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Archive as ArchiveIcon, Building2, Search, Coins, TrendingUp, Download, Loader2, Package } from "lucide-react";
import { Seal } from "@/components/Seal";
import { StatusPill, StatTile, EmptyState } from "@/components/ui-kit";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { MarkdownView } from "@/components/MarkdownView";

interface Snapshot {
  id: string; name: string; unit: string; budget: number;
  category: string | null; description: string | null;
  fiscal_year?: number;
}
interface Archived {
  id: string; project_id: string; report_id: string | null;
  project_snapshot: Snapshot; conclusion: string | null;
  archive_note: string | null; archived_at: string;
}
interface Report {
  id: string; title: string; content: string | null;
  conclusion: string | null; ai_rectification: any;
}

const CONCLUSION_TONE: Record<string, "success" | "warning" | "danger"> = {
  "予以支持": "success",
  "部分支持": "warning",
  "不予支持": "danger",
};

const CONCLUSION_SUPPORT_SCORE: Record<string, number> = {
  "予以支持": 1,
  "部分支持": 0.5,
  "不予支持": 0,
};

const Archive = () => {
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState<Archived[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [year, setYear] = useState<string>("all");
  const [conclusion, setConclusion] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [active, setActive] = useState<Archived | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);
  const [batchZipping, setBatchZipping] = useState(false);

  const downloadZip = async (a: Archived, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (zipping) return;
    setZipping(a.id);
    const tid = toast.loading(`正在打包 ${a.project_snapshot.name}…`, { description: "准备中…" });
    try {
      const { buildArchiveZip } = await import("@/lib/archiveZip");
      await buildArchiveZip({
        archiveId: a.id,
        projectId: a.project_id,
        reportId: a.report_id,
        snapshot: a.project_snapshot,
        conclusion: a.conclusion,
        archiveNote: a.archive_note,
        archivedAt: a.archived_at,
        onProgress: (m) => {
          toast.loading(`正在打包 ${a.project_snapshot.name}…`, { id: tid, description: m });
        },
      });
      toast.success("ZIP 已下载", { id: tid, description: "包含报告/资料/会议/方案/调研" });
    } catch (err: any) {
      console.error(err);
      toast.error("打包失败", { id: tid, description: err?.message ?? String(err) });
    } finally {
      setZipping(null);
    }
  };

  const downloadBatchZip = async () => {
    if (batchZipping || filtered.length === 0) return;
    if (filtered.length > 30) {
      if (!(await confirm({ title: `批量打包 ${filtered.length} 个项目？`, description: "项目数较多，可能耗时数分钟（含文件下载与 PDF 生成），过程中请勿关闭页面。", confirmText: "继续打包" }))) return;
    }
    setBatchZipping(true);
    const tid = toast.loading(`正在批量打包 ${filtered.length} 个项目…`, { description: "0%" });
    try {
      const { buildBatchArchiveZip } = await import("@/lib/archiveZip");
      const yearLabel = year === "all" ? "全部年度" : `${year}年`;
      const concLabel = conclusion === "all" ? "" : `_${conclusion}`;
      const zipName = `批量归档_${yearLabel}${concLabel}_${filtered.length}项_${new Date().toISOString().slice(0, 10)}.zip`;
      await buildBatchArchiveZip(
        filtered.map((a) => ({
          archiveId: a.id,
          projectId: a.project_id,
          reportId: a.report_id,
          snapshot: a.project_snapshot,
          conclusion: a.conclusion,
          archiveNote: a.archive_note,
          archivedAt: a.archived_at,
        })),
        zipName,
        (msg, pct) => {
          toast.loading(`正在批量打包 ${filtered.length} 个项目…`, { id: tid, description: `${pct}% · ${msg}` });
        },
      );
      toast.success("批量 ZIP 已下载", { id: tid, description: `共 ${filtered.length} 个项目，按子目录分包` });
    } catch (err: any) {
      console.error(err);
      toast.error("批量打包失败", { id: tid, description: err?.message ?? String(err) });
    } finally {
      setBatchZipping(false);
    }
  };

  useEffect(() => {
    supabase.from("archived_projects").select("*").order("archived_at", { ascending: false })
      .then(({ data }) => {
        setItems((data as any) ?? []);
        setLoading(false);
      });
  }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    items.forEach((i) => {
      const y = i.project_snapshot.fiscal_year ?? new Date(i.archived_at).getFullYear();
      s.add(y);
    });
    return [...s].sort((a, b) => b - a);
  }, [items]);

  const filtered = items.filter((i) => {
    const snap = i.project_snapshot;
    if (q && !snap.name.includes(q) && !snap.unit.includes(q)) return false;
    if (year !== "all") {
      const y = snap.fiscal_year ?? new Date(i.archived_at).getFullYear();
      if (String(y) !== year) return false;
    }
    if (conclusion !== "all" && i.conclusion !== conclusion) return false;
    return true;
  });

  const totalBudget = filtered.reduce((s, i) => s + (i.project_snapshot.budget || 0), 0);
  const supportRate = filtered.length
    ? Math.round(
      filtered.reduce((sum, item) => sum + (CONCLUSION_SUPPORT_SCORE[item.conclusion ?? ""] ?? 0), 0)
      / filtered.length
      * 100,
    )
    : 0;

  const openDetail = async (a: Archived) => {
    setActive(a);
    setOpen(true);
    setReport(null);
    if (a.report_id) {
      const { data } = await supabase.from("reports").select("*").eq("id", a.report_id).maybeSingle();
      setReport(data as any);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="PHASE III · 08 · 项目库"
        title="结果应用与项目库"
        subtitle="在报告页点「存入项目库」后归集 · 支持检索 / 筛选 / 追溯报告与整改建议"
      />

      {/* 统计 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="ARCHIVED" value={filtered.length.toString().padStart(2, "0")} hint="入库项目" icon={ArchiveIcon} tone="info" />
        <StatTile label="UNITS" value={new Set(filtered.map((i) => i.project_snapshot.unit)).size.toString().padStart(2, "0")} hint="涉及单位" icon={Building2} tone="gold" />
        <StatTile label="TOTAL BUDGET" value={`¥${(totalBudget / 10000).toFixed(1)}万`} hint="累计预算" icon={Coins} tone="success" />
        <StatTile label="SUPPORT RATE" value={`${supportRate}%`} hint="支持率" icon={TrendingUp} tone="accent" />
      </div>

      {/* 筛选条 */}
      <Card className="surface-card mb-6">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按项目名称或单位搜索…" className="pl-9" />
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部年度</SelectItem>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={conclusion} onValueChange={setConclusion}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部结论</SelectItem>
              <SelectItem value="予以支持">予以支持</SelectItem>
              <SelectItem value="部分支持">部分支持</SelectItem>
              <SelectItem value="不予支持">不予支持</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={downloadBatchZip}
            disabled={batchZipping || filtered.length === 0}
            className="w-full sm:ml-auto sm:w-auto"
            title={filtered.length === 0 ? "无可打包项目" : `批量打包当前筛选的 ${filtered.length} 个项目`}
          >
            {batchZipping ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Package className="h-4 w-4 mr-1.5" />
            )}
            批量打包 ZIP
            {filtered.length > 0 && !batchZipping && (
              <span className="ml-1.5 font-mono text-[11px] tabular-nums opacity-80">({filtered.length})</span>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 项目卡片网格 */}
      {loading ? (
        <div className="text-center text-muted-foreground py-12 font-mono text-sm">LOADING…</div>
      ) : filtered.length === 0 ? (
        <Card className="surface-card p-0">
          <EmptyState
            icon={ArchiveIcon}
            title="暂无归档项目"
            hint="请先在『评估报告』页面完成评估并点击『归档』按钮"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a, i) => (
            <Card
              key={a.id}
              className="surface-card cursor-pointer hover:-translate-y-0.5 hover:shadow-glow transition-all animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              onClick={() => openDetail(a)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
                      ARCHIVED · {new Date(a.archived_at).toLocaleDateString("zh-CN")}
                    </div>
                    <h3 className="font-display font-bold text-base text-foreground line-clamp-2 leading-snug mt-1">
                      {a.project_snapshot.name}
                    </h3>
                  </div>
                  <Seal size={36} text="✓" />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{a.project_snapshot.unit}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-foreground font-mono tabular-nums font-semibold">
                    <Coins className="h-3.5 w-3.5 text-accent shrink-0" />
                    ¥{a.project_snapshot.budget.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border flex-wrap">
                  {a.conclusion ? (
                    <StatusPill tone={CONCLUSION_TONE[a.conclusion] ?? "neutral"}>{a.conclusion}</StatusPill>
                  ) : <StatusPill tone="neutral" dot={false}>未结论</StatusPill>}
                  {a.project_snapshot.category && (
                    <StatusPill tone="neutral" dot={false}>{a.project_snapshot.category}</StatusPill>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 px-2 text-[11px]"
                    disabled={zipping === a.id}
                    onClick={(e) => downloadZip(a, e)}
                  >
                    {zipping === a.id ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3 mr-1" />
                    )}
                    ZIP
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 详情 Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <div className="section-eyebrow mb-2">ARCHIVED PROJECT · 归档项目</div>
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="font-display text-2xl font-bold text-foreground tracking-tight">
                {active?.project_snapshot.name}
              </DialogTitle>
              {active && (
                <Button
                  size="sm"
                  disabled={zipping === active.id}
                  onClick={() => downloadZip(active)}
                  className="shrink-0"
                >
                  {zipping === active.id ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1.5" />
                  )}
                  下载完整归档 ZIP
                </Button>
              )}
            </div>
          </DialogHeader>
          {active && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                <div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">单位</span>{active.project_snapshot.unit}</div>
                <div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">预算</span><span className="font-mono tabular-nums text-accent font-bold">¥{active.project_snapshot.budget.toLocaleString()}</span></div>
                <div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">类别</span>{active.project_snapshot.category ?? "—"}</div>
                <div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">归档时间</span><span className="font-mono tabular-nums">{new Date(active.archived_at).toLocaleString("zh-CN")}</span></div>
                <div className="col-span-2 flex items-center gap-2 pt-2 border-t border-border">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">评估结论</span>
                  {active.conclusion && (
                    <StatusPill tone={CONCLUSION_TONE[active.conclusion] ?? "neutral"}>{active.conclusion}</StatusPill>
                  )}
                </div>
              </div>

              {report?.content && (
                <div>
                  <div className="section-eyebrow mb-3">REPORT · 评估报告正文</div>
                  <div className="bg-card p-5 border border-border rounded-lg max-h-72 overflow-auto">
                    <MarkdownView content={report.content} />
                  </div>
                </div>
              )}

              {report?.ai_rectification && (report.ai_rectification as any[]).length > 0 && (
                <div>
                  <div className="section-eyebrow mb-3">RECTIFICATION · 整改建议清单</div>
                  <div className="space-y-2">
                    {(report.ai_rectification as any[]).map((r, i) => (
                      <div key={i} className="rounded-md border border-border p-3 bg-card text-sm">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <StatusPill tone="info" dot={false}>{r.category}</StatusPill>
                          <span className="font-display font-bold text-foreground">{r.title}</span>
                          <span className="ml-auto text-[11px] font-mono text-muted-foreground">{r.responsible}</span>
                        </div>
                        <p className="text-foreground/80 leading-relaxed">{r.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  );
};

export default Archive;

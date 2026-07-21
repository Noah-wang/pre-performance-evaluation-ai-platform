import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { calcFee, formatYuan, DEFAULT_FEE } from "@/lib/fee";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, FolderKanban, ListChecks, Layers, Users, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (projectId: string) => void;
}

interface SystemLite { id: string; name: string; category: string | null; }
interface PackageLite { id: string; name: string; code: string | null; }

const STEP_LABELS = ["基础信息", "资料清单", "指标体系", "工作组"];
const STEP_ICONS = [FolderKanban, ListChecks, Layers, Users];

const baseSchema = z.object({
  name: z.string().trim().min(1, "项目名称必填").max(200),
  unit: z.string().trim().min(1, "申请单位必填").max(200),
  budget: z.coerce.number().min(0).max(1e15),
  category: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
});

// 标准资料清单（项目类 / 政策类）
const TEMPLATE_PROJECT = [
  { category: "立项依据", name: "项目立项申请文件", required: true },
  { category: "立项依据", name: "可行性研究报告", required: true },
  { category: "立项依据", name: "上级批复文件", required: true },
  { category: "立项依据", name: "政策依据文件", required: false },
  { category: "预算资料", name: "预算编制说明", required: true },
  { category: "预算资料", name: "预算明细表", required: true },
  { category: "预算资料", name: "成本测算依据", required: true },
  { category: "实施方案", name: "项目实施方案", required: true },
  { category: "实施方案", name: "组织保障措施", required: false },
  { category: "实施方案", name: "风险防控方案", required: false },
  { category: "绩效目标", name: "总体绩效目标", required: true },
  { category: "绩效目标", name: "量化绩效指标", required: true },
];
const TEMPLATE_POLICY = [
  { category: "政策依据", name: "政策出台文件", required: true },
  { category: "政策依据", name: "上位法依据", required: true },
  { category: "政策依据", name: "政策评估报告", required: false },
  { category: "实施情况", name: "政策实施方案", required: true },
  { category: "实施情况", name: "执行情况报告", required: true },
  { category: "效果评估", name: "受益人群分析", required: true },
  { category: "效果评估", name: "社会经济效益数据", required: true },
  { category: "效果评估", name: "满意度调查结果", required: false },
  { category: "财政投入", name: "财政资金安排", required: true },
  { category: "财政投入", name: "资金使用情况", required: true },
];

export const ProjectWizard = ({ open, onOpenChange, onCreated }: Props) => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [systems, setSystems] = useState<SystemLite[]>([]);
  const [packages, setPackages] = useState<PackageLite[]>([]);

  const [base, setBase] = useState({ name: "", unit: "", budget: "", category: "", description: "" });
  const [pkgId, setPkgId] = useState("none");
  const [budgetUnit, setBudgetUnit] = useState("");
  const [manager, setManager] = useState("");
  const [agentOrg, setAgentOrg] = useState("");
  const [matTemplate, setMatTemplate] = useState<"project" | "policy" | "skip">("project");
  const [pickedItems, setPickedItems] = useState<Set<string>>(new Set());
  const [systemId, setSystemId] = useState("none");
  const [groupName, setGroupName] = useState("");
  const [groupLeader, setGroupLeader] = useState("");
  const [smartMatchHint, setSmartMatchHint] = useState(true);

  const reset = () => {
    setStep(0); setSaving(false);
    setBase({ name: "", unit: "", budget: "", category: "", description: "" });
    setPkgId("none"); setBudgetUnit(""); setManager(""); setAgentOrg("");
    setMatTemplate("project"); setPickedItems(new Set());
    setSystemId("none"); setGroupName(""); setGroupLeader(""); setSmartMatchHint(true);
  };

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from("evaluation_systems").select("id,name,category").order("created_at", { ascending: false }),
        supabase.from("evaluation_packages").select("id,name,code").order("created_at", { ascending: false }),
      ]);
      setSystems((s.data as SystemLite[]) ?? []);
      setPackages((p.data as PackageLite[]) ?? []);
    })();
  }, [open]);

  // 默认全选模板项
  useEffect(() => {
    const tpl = matTemplate === "project" ? TEMPLATE_PROJECT : matTemplate === "policy" ? TEMPLATE_POLICY : [];
    setPickedItems(new Set(tpl.map((_, i) => `${matTemplate}-${i}`)));
  }, [matTemplate]);

  const budgetNum = Number(base.budget) || 0;
  const refFee = budgetNum > 0 ? calcFee(budgetNum, { ...DEFAULT_FEE, enabled: true }).total : 0;

  const validateStep = (): string | null => {
    if (step === 0) {
      const r = baseSchema.safeParse(base);
      if (!r.success) return r.error.errors[0].message;
    }
    if (step === 3 && groupName.trim().length === 0) return "请填写工作组名称";
    return null;
  };

  const next = () => {
    const err = validateStep();
    if (err) return toast.error(err);
    setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
  };
  const prev = () => setStep((s) => Math.max(0, s - 1));

  const finalize = async () => {
    if (!user) return;
    const err = validateStep();
    if (err) return toast.error(err);
    setSaving(true);
    try {
      // 1) Create project
      const { data: proj, error: pErr } = await supabase.from("projects").insert({
        name: base.name.trim(),
        unit: base.unit.trim(),
        budget: budgetNum,
        category: base.category.trim() || null,
        description: base.description.trim() || null,
        package_id: pkgId === "none" ? null : pkgId,
        budget_unit: budgetUnit.trim() || null,
        manager: manager.trim() || null,
        agent_org: agentOrg.trim() || null,
        evaluation_system_id: systemId === "none" ? null : systemId,
        fee_calculation: { ...DEFAULT_FEE, enabled: true },
        created_by: user.id,
      } as any).select().single();
      if (pErr || !proj) throw pErr ?? new Error("项目创建失败");

      // 2) Materials checklist
      const tpl = matTemplate === "project" ? TEMPLATE_PROJECT : matTemplate === "policy" ? TEMPLATE_POLICY : [];
      const matRows = tpl
        .map((t, i) => ({ key: `${matTemplate}-${i}`, ...t }))
        .filter((t) => pickedItems.has(t.key))
        .map((t) => ({
          project_id: proj.id,
          name: t.name,
          category: t.category,
          required: t.required,
          status: "missing",
          created_by: user.id,
        }));
      if (matRows.length > 0) {
        const { error: mErr } = await supabase.from("materials").insert(matRows as any);
        if (mErr) console.warn("materials insert:", mErr);
      }

      // 3) Work group
      if (groupName.trim()) {
        const { error: gErr } = await supabase.from("work_groups").insert({
          project_id: proj.id,
          name: groupName.trim(),
          leader: groupLeader.trim() || null,
          formed_on: new Date().toISOString().slice(0, 10),
          created_by: user.id,
        } as any);
        if (gErr) console.warn("group insert:", gErr);
      }

      toast.success("项目创建完成 · 即将进入工作台");
      onCreated?.(proj.id);
      onOpenChange(false);
      reset();
      nav(`/projects/${proj.id}/workbench`);
    } catch (e: any) {
      toast.error(e?.message ?? "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const StepIcon = STEP_ICONS[step];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> 新建评估项目
          </DialogTitle>
          <DialogDescription>4 步引导式创建，自动初始化资料清单与工作组</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          {STEP_LABELS.map((label, i) => {
            const Ic = STEP_ICONS[i];
            const done = i < step, active = i === step;
            return (
              <div key={i} className="flex-1 flex items-center">
                <div className={[
                  "w-8 h-8 rounded-full grid place-items-center border-2 shrink-0 transition-all",
                  done ? "bg-success border-success text-success-foreground" :
                  active ? "border-accent text-accent bg-accent/10" :
                  "border-border text-muted-foreground",
                ].join(" ")}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Ic className="h-4 w-4" />}
                </div>
                <div className="ml-2 mr-2 min-w-0">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground">STEP {i + 1}</div>
                  <div className={`text-xs font-medium truncate ${active ? "text-accent" : "text-foreground"}`}>{label}</div>
                </div>
                {i < STEP_LABELS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-success" : "bg-border"}`} />}
              </div>
            );
          })}
        </div>

        <div className="min-h-[340px] py-2">
          {step === 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>项目名称 *</Label><Input value={base.name} onChange={(e) => setBase({ ...base, name: e.target.value })} /></div>
                <div><Label>申请单位 *</Label><Input value={base.unit} onChange={(e) => setBase({ ...base, unit: e.target.value })} /></div>
                <div>
                  <Label>预算金额（元）*</Label>
                  <Input type="number" value={base.budget} onChange={(e) => setBase({ ...base, budget: e.target.value })} />
                  {refFee > 0 && (
                    <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                      参考评估费：<span className="text-cyan font-bold">{formatYuan(refFee)}</span>（默认阶梯，可后续调整）
                    </p>
                  )}
                </div>
                <div>
                  <Label>项目类别</Label>
                  <Input value={base.category} onChange={(e) => setBase({ ...base, category: e.target.value })} placeholder="如：基础设施、民生工程" />
                </div>
                <div>
                  <Label>所属评估包</Label>
                  <Select value={pkgId} onValueChange={setPkgId}>
                    <SelectTrigger><SelectValue placeholder="不归属" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— 不归属 —</SelectItem>
                      {packages.map((p) => <SelectItem key={p.id} value={p.id}>{p.code ? `[${p.code}] ` : ""}{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>预算单位</Label><Input value={budgetUnit} onChange={(e) => setBudgetUnit(e.target.value)} /></div>
                <div><Label>项目负责人</Label><Input value={manager} onChange={(e) => setManager(e.target.value)} /></div>
                <div><Label>代理机构</Label><Input value={agentOrg} onChange={(e) => setAgentOrg(e.target.value)} /></div>
              </div>
              <div>
                <Label>项目说明</Label>
                <Textarea rows={3} value={base.description} onChange={(e) => setBase({ ...base, description: e.target.value })} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label className="shrink-0">资料清单模板：</Label>
                <Select value={matTemplate} onValueChange={(v: any) => setMatTemplate(v)}>
                  <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="project">附件 2-1 · 项目类清单</SelectItem>
                    <SelectItem value="policy">附件 2-2 · 政策类清单</SelectItem>
                    <SelectItem value="skip">跳过（手动添加）</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">已勾选 {pickedItems.size} 项</span>
              </div>
              {matTemplate === "skip" ? (
                <div className="text-sm text-muted-foreground py-12 text-center border border-dashed border-border rounded-md">
                  跳过模板加载 · 创建后可在「资料」模块手动添加
                </div>
              ) : (
                <div className="border border-border rounded-md max-h-[340px] overflow-y-auto divide-y divide-border">
                  {(matTemplate === "project" ? TEMPLATE_PROJECT : TEMPLATE_POLICY).map((t, i) => {
                    const key = `${matTemplate}-${i}`;
                    const checked = pickedItems.has(key);
                    return (
                      <label key={key} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/5 cursor-pointer">
                        <Checkbox checked={checked} onCheckedChange={() => {
                          const n = new Set(pickedItems); n.has(key) ? n.delete(key) : n.add(key); setPickedItems(n);
                        }} />
                        <span className="text-xs font-mono text-muted-foreground w-20">{t.category}</span>
                        <span className="text-sm flex-1">{t.name}</span>
                        {t.required && <span className="text-[10px] font-mono text-destructive">必填</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>关联评估指标体系</Label>
              <Select value={systemId} onValueChange={setSystemId}>
                <SelectTrigger><SelectValue placeholder="可不关联，稍后再选" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— 暂不关联 —</SelectItem>
                  {systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                选择已有的指标体系将自动用于资料关联、专家打分汇总和 AI 报告引用。也可在「评估指标体系」页面新建后再关联。
              </p>
              {systems.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 border border-dashed border-border rounded-md">
                  暂无指标体系。可先完成创建，后到「评估指标体系」页新建并回填。
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>工作组名称 *</Label>
                  <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="如：xx项目评估工作组" />
                </div>
                <div>
                  <Label>组长</Label>
                  <Input value={groupLeader} onChange={(e) => setGroupLeader(e.target.value)} />
                </div>
              </div>
              <label className="flex items-start gap-2 p-3 rounded-md border border-accent/30 bg-accent/5 cursor-pointer">
                <Checkbox checked={smartMatchHint} onCheckedChange={(v) => setSmartMatchHint(!!v)} />
                <div className="flex-1">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    创建后自动跳转工作台并打开"专家智能匹配"
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    将基于项目类别 / 指标体系 / 历史评分自动推荐专家组合
                  </div>
                </div>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-4">
          <Button variant="outline" onClick={prev} disabled={step === 0}>
            <ChevronLeft className="h-4 w-4" /> 上一步
          </Button>
          {step < STEP_LABELS.length - 1 ? (
            <Button variant="hero" onClick={next}>
              下一步 <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="hero" onClick={finalize} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              创建并进入工作台
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

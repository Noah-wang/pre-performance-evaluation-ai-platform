import { PermissionGate } from "@/components/PermissionGate";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Plus, Trash2, Download, FolderKanban, Building2, Coins, Calculator, Tags, ArrowRight, CheckCircle2, Archive as ArchiveIcon, Sparkles, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, StatTile, EmptyState } from "@/components/ui-kit";
import { FeeCalculatorPanel } from "@/components/FeeCalculatorPanel";
import { CustomFieldsPanel, CustomField } from "@/components/CustomFieldsPanel";
import { FeeCalculation, DEFAULT_FEE, calcFee, formatYuan, normalizeFeeCalculation } from "@/lib/fee";
import { ProjectWizard } from "@/components/ProjectWizard";
import { useNavigate, useSearchParams } from "react-router-dom";
import { exportDemandDeclarationWorkbook } from "@/lib/projectDemandExport";
import { useIsMobile } from "@/hooks/use-mobile";

const schema = z.object({
  name: z.string().trim().min(1, "项目名称必填").max(200),
  unit: z.string().trim().min(1, "申请单位必填").max(200),
  budget: z.coerce.number().min(0).max(1e15),
  category: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  package_id: z.string().optional(),
  budget_unit: z.string().trim().max(200).optional(),
  expense_dept: z.string().trim().max(200).optional(),
  manager: z.string().trim().max(50).optional(),
  list_attribute: z.string().optional(),
  project_attribute: z.string().optional(),
  agent_org: z.string().trim().max(200).optional(),
});

interface Project {
  id: string;
  name: string;
  unit: string;
  budget: number;
  category: string | null;
  description: string | null;
  status: string;
  fiscal_year: number;
  created_at: string;
  fee_calculation: any;
  custom_fields: any;
  evaluation_system_id: string | null;
  package_id: string | null;
  budget_unit: string | null;
  expense_dept: string | null;
  manager: string | null;
  list_attribute: string | null;
  project_attribute: string | null;
  agent_org: string | null;
}

interface EvalSystem {
  id: string;
  name: string;
  category: string | null;
}

interface Pkg { id: string; name: string; code: string | null; }

const STATUS_MAP: Record<string, { label: string; tone: "info" | "accent" | "success" | "neutral" }> = {
  preparing: { label: "准备中", tone: "info" },
  implementing: { label: "实施中", tone: "accent" },
  completed: { label: "已完成", tone: "success" },
  archived: { label: "已归档", tone: "neutral" },
};

// 状态流转：上一状态 → 下一状态
const NEXT_STATUS: Record<string, { next: string; label: string; icon: any } | null> = {
  preparing: { next: "implementing", label: "进入实施", icon: ArrowRight },
  implementing: { next: "completed", label: "标记完成", icon: CheckCircle2 },
  completed: { next: "archived", label: "归档", icon: ArchiveIcon },
  archived: null,
};

const emptyForm = {
  name: "", unit: "", budget: "", category: "", description: "",
  package_id: "none", budget_unit: "", expense_dept: "", manager: "",
  list_attribute: "none", project_attribute: "none", agent_org: "",
};
const defaultEnabledFee = normalizeFeeCalculation({ ...DEFAULT_FEE, enabled: true });
const resolveFee = (value: unknown): FeeCalculation => {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return normalizeFeeCalculation({ ...source, enabled: true });
};

const Projects = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [list, setList] = useState<Project[]>([]);
  const [systems, setSystems] = useState<EvalSystem[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fee, setFee] = useState<FeeCalculation>(defaultEnabledFee);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [systemId, setSystemId] = useState<string>("none");
  const [feeOpen, setFeeOpen] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Project | null>(null);
  const [confirmAdv, setConfirmAdv] = useState<Project | null>(null);
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editProjectId = searchParams.get("editProject");

  const load = async () => {
    const [{ data, error }, { data: sys }, { data: pks }] = await Promise.all([
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      supabase.from("evaluation_systems").select("id,name,category").order("created_at", { ascending: false }),
      supabase.from("evaluation_packages").select("id,name,code").order("created_at", { ascending: false }),
    ]);
    if (error) toast.error(error.message);
    else setList((data as Project[]) ?? []);
    setSystems((sys as EvalSystem[]) ?? []);
    setPackages((pks as Pkg[]) ?? []);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setFee(defaultEnabledFee);
    setCustomFields([]);
    setSystemId("none");
    setFeeOpen(false);
    setCfOpen(false);
    setEditing(null);
  };

  // 打开编辑弹窗，预填数据
  const openEdit = (p: Project) => {
    setEditing(p);
    setForm({
      name: p.name,
      unit: p.unit,
      budget: String(p.budget),
      category: p.category ?? "",
      description: p.description ?? "",
      package_id: p.package_id ?? "none",
      budget_unit: p.budget_unit ?? "",
      expense_dept: p.expense_dept ?? "",
      manager: p.manager ?? "",
      list_attribute: p.list_attribute ?? "none",
      project_attribute: p.project_attribute ?? "none",
      agent_org: p.agent_org ?? "",
    });
    setFee(resolveFee(p.fee_calculation));
    const cf = p.custom_fields ?? {};
    setCustomFields(
      Object.entries(cf).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
    );
    setSystemId(p.evaluation_system_id ?? "none");
    setOpen(true);
  };

  useEffect(() => {
    if (!editProjectId || !list.length) return;
    const project = list.find((item) => item.id === editProjectId);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("editProject");

    if (!project) {
      setSearchParams(nextParams, { replace: true });
      toast.error("未找到需要关联指标体系的项目");
      return;
    }

    openEdit(project);
    setSearchParams(nextParams, { replace: true });
    toast.info("请在弹窗中选择「关联评估指标体系」，然后保存项目");
  }, [editProjectId, list, searchParams, setSearchParams]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    const cfMap = customFields
      .filter((f) => f.key.trim())
      .reduce<Record<string, string>>((acc, f) => {
        acc[f.key.trim()] = f.value;
        return acc;
      }, {});
    setSaving(true);
    const payload: any = {
      name: parsed.data.name,
      unit: parsed.data.unit,
      budget: parsed.data.budget,
      category: parsed.data.category || null,
      description: parsed.data.description || null,
      fee_calculation: fee,
      custom_fields: cfMap,
      evaluation_system_id: systemId === "none" ? null : systemId,
      package_id: form.package_id === "none" ? null : form.package_id,
      budget_unit: form.budget_unit.trim() || null,
      expense_dept: form.expense_dept.trim() || null,
      manager: form.manager.trim() || null,
      list_attribute: form.list_attribute === "none" ? null : form.list_attribute,
      project_attribute: form.project_attribute === "none" ? null : form.project_attribute,
      agent_org: form.agent_org.trim() || null,
    };
    let error;
    let savedProject: Project | null = null;
    if (editing) {
      const res = await supabase.from("projects").update(payload).eq("id", editing.id).select("*").maybeSingle();
      error = res.error;
      savedProject = (res.data as Project | null) ?? {
        ...editing,
        ...payload,
      };
    } else {
      const res = await supabase.from("projects").insert({ ...payload, created_by: user.id }).select("*").maybeSingle();
      error = res.error;
      savedProject = (res.data as Project | null) ?? null;
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    if (savedProject) {
      setList((prev) => editing
        ? prev.map((item) => item.id === savedProject!.id ? savedProject! : item)
        : [savedProject!, ...prev]);
    }
    toast.success(editing ? "项目已更新" : "项目已录入");
    setOpen(false);
    resetForm();
    load();
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from("projects").delete().eq("id", confirmDel.id);
    setConfirmDel(null);
    if (error) toast.error(error.message);
    else { toast.success("已删除"); load(); }
  };

  // 状态流转
  const doAdvance = async () => {
    if (!confirmAdv) return;
    const step = NEXT_STATUS[confirmAdv.status];
    if (!step) { setConfirmAdv(null); return; }
    const targetId = confirmAdv.id;
    const nextStatus = step.next;
    const { error } = await supabase.from("projects")
      .update({ status: nextStatus } as any)
      .eq("id", targetId);
    setConfirmAdv(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setList((prev) => prev.map((item) => item.id === targetId ? { ...item, status: nextStatus } : item));
    toast.success(`已切换到「${STATUS_MAP[nextStatus]?.label ?? nextStatus}」`);
  };

  const exportCSV = () => {
    const rows = [["项目名称", "申请单位", "预算金额(元)", "评估服务费(元)", "类别", "财政年度", "状态"]];
    list.forEach((p) => {
      const f = resolveFee(p.fee_calculation);
      const feeTotal = calcFee(p.budget, f).total;
      rows.push([p.name, p.unit, String(p.budget), feeTotal.toFixed(2), p.category ?? "", String(p.fiscal_year), p.status]);
    });
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `财政需求-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const exportDemandForm = async () => {
    await exportDemandDeclarationWorkbook(
      list.map((project) => ({
        name: project.name,
        unit: project.unit,
        budget: project.budget,
        category: project.category,
        description: project.description,
        packageName: packages.find((pkg) => pkg.id === project.package_id)?.name ?? null,
        budgetUnit: project.budget_unit,
        expenseDept: project.expense_dept,
        manager: project.manager,
        listAttribute: project.list_attribute,
        projectAttribute: project.project_attribute,
        agentOrg: project.agent_org,
        feeCalculation: resolveFee(project.fee_calculation),
        systemName: systems.find((system) => system.id === project.evaluation_system_id)?.name ?? null,
        status: STATUS_MAP[project.status]?.label ?? project.status,
      })),
    );
  };

  const totalBudget = list.reduce((s, p) => s + (p.budget || 0), 0);
  const unitCount = new Set(list.map((p) => p.unit)).size;
  const totalFee = useMemo(
    () => list.reduce((s, p) => s + calcFee(p.budget, resolveFee(p.fee_calculation)).total, 0),
    [list],
  );

  const budgetNum = Number(form.budget) || 0;

  const ProjectDialog = (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="hero" onClick={() => { resetForm(); }}>
          <Plus className="h-4 w-4" /> 新增项目
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {editing ? "编辑评估对象" : "新增评估对象"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>项目名称 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} required /></div>
            <div><Label>申请单位 *</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} maxLength={200} required /></div>
            <div>
              <Label>预算金额（元）*</Label>
              <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} required />
              {budgetNum > 0 && (() => {
                const refFee = calcFee(budgetNum, { ...DEFAULT_FEE, enabled: true });
                return (
                  <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                    参考评估费（默认阶梯）：<span className="text-accent font-bold">{formatYuan(refFee.total)}</span>
                    {!fee.enabled && <span className="ml-1">· 展开下方"评估收费"启用并自定义</span>}
                  </p>
                );
              })()}
            </div>
            <div><Label>项目类别</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：基础设施 / 民生工程" maxLength={100} /></div>
          </div>
          <div><Label>项目说明</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} rows={3} /></div>

          {/* 评估包归属与单位字段 */}
          <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
            <div className="text-[11px] font-mono tracking-[0.2em] uppercase text-accent">PACKAGE & ORG</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>所属评估包</Label>
                <Select value={form.package_id} onValueChange={(v) => setForm({ ...form, package_id: v })}>
                  <SelectTrigger><SelectValue placeholder="选择评估包（可不选）" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— 不归属 —</SelectItem>
                    {packages.map((pk) => (
                      <SelectItem key={pk.id} value={pk.id}>{pk.code ? `[${pk.code}] ` : ""}{pk.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>代理机构</Label>
                <Input value={form.agent_org} onChange={(e) => setForm({ ...form, agent_org: e.target.value })} maxLength={200} placeholder="如：xx咨询有限公司" />
              </div>
              <div>
                <Label>预算单位</Label>
                <Input value={form.budget_unit} onChange={(e) => setForm({ ...form, budget_unit: e.target.value })} maxLength={200} />
              </div>
              <div>
                <Label>支出科室</Label>
                <Input value={form.expense_dept} onChange={(e) => setForm({ ...form, expense_dept: e.target.value })} maxLength={200} />
              </div>
              <div>
                <Label>项目负责人</Label>
                <Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} maxLength={50} />
              </div>
              <div>
                <Label>名录属性</Label>
                <Select value={form.list_attribute} onValueChange={(v) => setForm({ ...form, list_attribute: v })}>
                  <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— 未指定 —</SelectItem>
                    <SelectItem value="政府购买服务">政府购买服务</SelectItem>
                    <SelectItem value="重点建设">重点建设</SelectItem>
                    <SelectItem value="公共服务">公共服务</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>项目属性</Label>
                <Select value={form.project_attribute} onValueChange={(v) => setForm({ ...form, project_attribute: v })}>
                  <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— 未指定 —</SelectItem>
                    <SelectItem value="新增">新增</SelectItem>
                    <SelectItem value="存续">存续</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 关联评估指标体系 */}
          <div>
            <Label>关联评估指标体系</Label>
            <Select value={systemId} onValueChange={setSystemId}>
              <SelectTrigger>
                <SelectValue placeholder="选择已有的指标体系（可不选）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— 不关联 —</SelectItem>
                {systems.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.category ? ` · ${s.category}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {systems.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                暂无指标体系，可先到「评估指标体系」页面创建
              </p>
            )}
            {systems.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                项目与评估体系的关联入口就在这里。保存项目后，资料审核、会议评分、AI 匹配都会自动读取当前绑定的指标体系。
              </p>
            )}
          </div>

          {/* 收费计算 */}
          <FeeCalculatorPanel
            budget={budgetNum}
            value={fee}
            onChange={setFee}
            open={feeOpen}
            onOpenChange={setFeeOpen}
          />

          {/* 自定义字段 */}
          <CustomFieldsPanel
            value={customFields}
            onChange={setCustomFields}
            open={cfOpen}
            onOpenChange={setCfOpen}
          />

          <DialogFooter>
            <Button type="submit" variant="hero" disabled={saving}>
              {saving ? "保存中…" : editing ? "更 新" : "保 存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        eyebrow="PHASE I · 01 · 评估对象"
        title="评估对象管理"
        subtitle="录入项目信息，支持收费模板对比与正式需求申报表导出 · 点击表格行可编辑"
        actions={
          <>
            <PermissionGate require="canExport">
              <Button variant="outline" onClick={exportDemandForm} disabled={list.length === 0}>
                <Download className="h-4 w-4" /> 导出需求申报表
              </Button>
            </PermissionGate>
            <PermissionGate require="canExport">
              <Button variant="ghost" onClick={exportCSV} disabled={list.length === 0}>
                <Download className="h-4 w-4" /> 导出 CSV 台账
              </Button>
            </PermissionGate>
            <PermissionGate require="canManage">
              <Button variant="hero" onClick={() => setWizardOpen(true)}>
                <Sparkles className="h-4 w-4" /> 向导新建
              </Button>
            </PermissionGate>
            <PermissionGate require="canManage">{ProjectDialog}</PermissionGate>
          </>
        }
      />

      <EditPermissionNotice />

      {/* 数据指标 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="ACTIVE PROJECTS" value={list.length.toString().padStart(2, "0")} hint="在评项目总数" icon={FolderKanban} tone="info" />
        <StatTile label="UNITS INVOLVED" value={unitCount.toString().padStart(2, "0")} hint="涉及申请单位" icon={Building2} tone="gold" />
        <StatTile label="TOTAL BUDGET" value={`¥${(totalBudget / 10000).toFixed(1)}万`} hint="累计预算金额" icon={Coins} tone="success" />
        <StatTile label="EVAL FEE" value={totalFee > 0 ? `¥${(totalFee / 10000).toFixed(2)}万` : "—"} hint="累计评估服务费" icon={Calculator} tone="info" />
      </div>

      <Card className="surface-card overflow-hidden p-0">
        {list.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="暂无评估对象"
            hint="点击右上角『新增项目』开始录入第一个评估对象"
            action={ProjectDialog}
          />
        ) : (
          <>
            {isMobile ? (
              <div className="divide-y divide-border md:hidden">
                {list.map((p) => {
                  const meta = STATUS_MAP[p.status] ?? { label: p.status, tone: "neutral" as const };
                  const f = resolveFee(p.fee_calculation);
                  const feeTotal = calcFee(p.budget, f).total;
                  const cfCount = p.custom_fields ? Object.keys(p.custom_fields).length : 0;
                  const sys = systems.find((s) => s.id === p.evaluation_system_id);
                  const step = NEXT_STATUS[p.status];
                  const StepIcon = step?.icon;
                  return (
                    <button
                      key={p.id}
                      onClick={() => openEdit(p)}
                      className="w-full p-4 text-left transition-colors hover:bg-accent/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-medium text-foreground break-words">{p.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground break-words">{p.unit}</div>
                        </div>
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="font-mono uppercase tracking-wider text-muted-foreground">预算</div>
                          <div className="mt-1 font-mono text-foreground tabular-nums">{p.budget.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="font-mono uppercase tracking-wider text-muted-foreground">评估费</div>
                          <div className="mt-1 font-mono text-cyan tabular-nums">{feeTotal > 0 ? formatYuan(feeTotal) : "—"}</div>
                        </div>
                        <div>
                          <div className="font-mono uppercase tracking-wider text-muted-foreground">类别</div>
                          <div className="mt-1 text-foreground">{p.category ?? "—"}</div>
                        </div>
                        <div>
                          <div className="font-mono uppercase tracking-wider text-muted-foreground">扩展字段</div>
                          <div className="mt-1 text-foreground">{cfCount > 0 ? `${cfCount} 项` : "—"}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sys && <StatusPill tone="info" dot={false}>{sys.name}</StatusPill>}
                        {!sys && <StatusPill tone="neutral" dot={false}>未关联指标体系</StatusPill>}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => nav(`/projects/${p.id}/workbench`)}
                          className="flex-1 min-w-[112px]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          工作台
                        </Button>
                        {step && StepIcon && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmAdv(p)}
                            className="flex-1 min-w-[112px]"
                          >
                            <StepIcon className="h-3.5 w-3.5" />
                            {step.label}
                          </Button>
                        )}
                        <PermissionGate require="canManage">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDel(p)}
                            className="w-full text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            删除
                          </Button>
                        </PermissionGate>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">项目名称</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">申请单位</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground text-right">预算（元）</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground text-right">评估费</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">类别</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">指标体系</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">扩展</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">状态</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((p) => {
                      const meta = STATUS_MAP[p.status] ?? { label: p.status, tone: "neutral" as const };
                      const f = resolveFee(p.fee_calculation);
                      const feeTotal = calcFee(p.budget, f).total;
                      const cfCount = p.custom_fields ? Object.keys(p.custom_fields).length : 0;
                      const sys = systems.find((s) => s.id === p.evaluation_system_id);
                      const step = NEXT_STATUS[p.status];
                      const StepIcon = step?.icon;
                      return (
                        <TableRow
                          key={p.id}
                          className="group hover:bg-accent/5 transition-colors cursor-pointer"
                          onClick={() => openEdit(p)}
                        >
                          <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                          <TableCell className="text-muted-foreground">{p.unit}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-foreground font-medium">
                            {p.budget.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {feeTotal > 0 ? (
                              <span className="text-cyan">{formatYuan(feeTotal)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{p.category ?? "—"}</TableCell>
                          <TableCell>
                            {sys ? (
                              <span className="text-xs text-cyan">{sys.name}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {cfCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-mono text-gold-soft">
                                <Tags className="h-3 w-3" /> {cfCount}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => nav(`/projects/${p.id}/workbench`)}
                                className="h-8 px-2 text-xs"
                                title="进入工作台"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span className="hidden lg:inline">工作台</span>
                              </Button>
                              {step && StepIcon && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setConfirmAdv(p)}
                                  className="h-8 px-2 text-xs"
                                  title={step.label}
                                >
                                  <StepIcon className="h-3.5 w-3.5" />
                                  <span className="hidden lg:inline">{step.label}</span>
                                </Button>
                              )}
                              <PermissionGate require="canManage">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setConfirmDel(p)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8"
                                  title="删除"
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </PermissionGate>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Card>

      {/* 删除确认 */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除评估对象？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除项目「{confirmDel?.name}」及其所有关联数据，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 状态推进确认 */}
      <AlertDialog open={!!confirmAdv} onOpenChange={(o) => !o && setConfirmAdv(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认切换项目状态？</AlertDialogTitle>
            <AlertDialogDescription>
              将「{confirmAdv?.name}」的状态切换为「
              {confirmAdv ? STATUS_MAP[NEXT_STATUS[confirmAdv.status]?.next ?? ""]?.label : ""}
              」，切换后部分流程将不可逆。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={doAdvance}>确认切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProjectWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={() => load()} />
    </>
  );
};

export default Projects;

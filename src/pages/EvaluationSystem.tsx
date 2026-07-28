import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, FileSpreadsheet, Layers, ListTree, Sparkles, Pencil, ChevronRight, BookMarked, Library } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, EmptyState, SectionHeader, StatTile } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";

interface ESystem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  is_template: boolean;
  created_by: string;
  created_at: string;
}

interface Indicator {
  id: string;
  system_id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  name: string;
  weight: number;
  scoring_method: string | null;
  required_materials: string | null;
  sort_order: number;
}

const TEMPLATE_INDICATORS: Omit<Indicator, "id" | "system_id" | "parent_id">[] = [
  { level: 1, code: "1",   name: "决策科学性",       weight: 20, scoring_method: "查阅立项依据、可研报告", required_materials: "项目立项申请书,可行性研究报告,立项批复文件", sort_order: 1 },
  { level: 1, code: "2",   name: "项目准备充分性",   weight: 20, scoring_method: "审查项目方案与预算编制", required_materials: "总体技术方案,项目预算编制说明", sort_order: 2 },
  { level: 1, code: "3",   name: "绩效目标合理性",   weight: 20, scoring_method: "对照行业标准与历史数据", required_materials: "绩效目标申报表", sort_order: 3 },
  { level: 1, code: "4",   name: "投入经济性",       weight: 20, scoring_method: "概算审核与市场调研对比", required_materials: "概算审核意见,资金来源证明", sort_order: 4 },
  { level: 1, code: "5",   name: "实施可行性",       weight: 20, scoring_method: "现场调研与组织保障审查", required_materials: "前期调研报告,实施方案", sort_order: 5 },
];

type Mode = "add" | "edit";

const EvaluationSystem = () => {
  const { user, isAdmin } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [systems, setSystems] = useState<ESystem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [sysOpen, setSysOpen] = useState(false);
  const [sForm, setSForm] = useState({ name: "", category: "民生工程", description: "" });

  const [indOpen, setIndOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [editing, setEditing] = useState<Indicator | null>(null);
  const [iForm, setIForm] = useState({
    code: "", name: "", weight: 0,
    scoring_method: "", required_materials: "",
    level: 1 as 1 | 2 | 3,
    parent_id: "" as string,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Goal library import
  const [libOpen, setLibOpen] = useState(false);
  const [libList, setLibList] = useState<any[]>([]);
  const [libQ, setLibQ] = useState("");
  const [libPicked, setLibPicked] = useState<Set<string>>(new Set());
  const [libCat, setLibCat] = useState<string>("all");
  const [libLevel, setLibLevel] = useState<string>("all");

  const openLibrary = async () => {
    setLibPicked(new Set());
    const { data } = await supabase.from("goal_library").select("*").order("usage_count", { ascending: false }).limit(500);
    setLibList(data ?? []);
    setLibOpen(true);
  };
  const importFromLibrary = async () => {
    if (!user || !activeId || libPicked.size === 0) return;
    const picks = libList.filter(g => libPicked.has(g.id));
    const baseOrder = indicators.length;
    const payload = picks.map((g, i) => ({
      system_id: activeId,
      created_by: user.id,
      level: g.level,
      code: g.code,
      name: g.name,
      weight: Number(g.weight) || 0,
      scoring_method: g.scoring_method,
      required_materials: g.required_materials,
      parent_id: null,
      sort_order: baseOrder + i + 1,
    }));
    const { error } = await supabase.from("evaluation_indicators").insert(payload);
    if (error) return toast.error(error.message);
    // bump usage counters
    await Promise.all(picks.map(g =>
      supabase.from("goal_library").update({ usage_count: (g.usage_count || 0) + 1 }).eq("id", g.id)
    ));
    toast.success(`已从指标库导入 ${picks.length} 项`);
    setLibOpen(false);
    loadIndicators(activeId);
  };

  const saveToLibrary = async (ind: Indicator) => {
    if (!user) return;
    const cat = active?.category ?? null;
    const { error } = await supabase.from("goal_library").insert({
      category: cat,
      level: ind.level,
      code: ind.code,
      name: ind.name,
      weight: Number(ind.weight) || 0,
      scoring_method: ind.scoring_method,
      required_materials: ind.required_materials,
      source_system_id: activeId,
      source_indicator_id: ind.id,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success(`已沉淀「${ind.name}」到指标库`);
  };

  const filteredLib = libList.filter(g => {
    if (libCat !== "all" && g.category !== libCat) return false;
    if (libLevel !== "all" && String(g.level) !== libLevel) return false;
    if (!libQ.trim()) return true;
    const kw = libQ.trim().toLowerCase();
    return [g.name, g.code, g.scoring_method].some((v: any) => v?.toLowerCase().includes(kw));
  });

  const load = async () => {
    const { data: s } = await supabase.from("evaluation_systems").select("*").order("created_at", { ascending: false });
    // 可见范围由 RLS 的 can_access_evaluation_system 决定：管理员看全部，其他人看自己
    // 建的、以及自己有权访问的项目所关联的体系。这里再按 created_by 过滤一次，会把
    // 「项目关联」这条路径整个抹掉——工作组成员因此看不到本项目的指标体系。
    const rows = (s as ESystem[]) ?? [];
    setSystems(rows);
    if (!activeId && rows.length) setActiveId(rows[0].id);
    if (activeId && !rows.some((system) => system.id === activeId)) setActiveId(rows[0]?.id ?? "");
  };
  const loadIndicators = async (sid: string) => {
    if (!sid) return setIndicators([]);
    const { data } = await supabase
      .from("evaluation_indicators").select("*")
      .eq("system_id", sid).order("level", { ascending: true }).order("sort_order", { ascending: true });
    setIndicators((data as Indicator[]) ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isAdmin, user?.id]);
  useEffect(() => { loadIndicators(activeId); }, [activeId]);

  const active = systems.find(s => s.id === activeId);

  const submitSystem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!sForm.name.trim()) return toast.error("体系名称必填");
    const { data, error } = await supabase.from("evaluation_systems").insert({
      name: sForm.name.trim(),
      category: sForm.category,
      description: sForm.description.trim() || null,
      created_by: user.id,
    }).select().single();
    if (error) return toast.error(error.message);
    toast.success("已创建评估体系");
    setSysOpen(false);
    setSForm({ name: "", category: "民生工程", description: "" });
    setActiveId(data.id);
    load();
  };

  const loadTemplate = async () => {
    if (!user || !activeId) return;
    if (indicators.length > 0 && !(await confirm({ title: "当前体系已有指标，确认继续加载预设？", description: "预设指标将追加到现有指标列表后，不会覆盖已有内容。" }))) return;
    const payload = TEMPLATE_INDICATORS.map(t => ({ ...t, system_id: activeId, created_by: user.id }));
    const { error } = await supabase.from("evaluation_indicators").insert(payload);
    if (error) toast.error(error.message);
    else { toast.success(`已加载 ${payload.length} 项预设指标`); loadIndicators(activeId); }
  };

  const openAdd = (level: 1 | 2 | 3, parent?: Indicator) => {
    setMode("add");
    setEditing(null);
    setIForm({
      code: "", name: "", weight: 0,
      scoring_method: "", required_materials: "",
      level,
      parent_id: parent?.id ?? "",
    });
    setIndOpen(true);
  };
  const openEdit = (ind: Indicator) => {
    setMode("edit");
    setEditing(ind);
    setIForm({
      code: ind.code ?? "",
      name: ind.name,
      weight: Number(ind.weight) || 0,
      scoring_method: ind.scoring_method ?? "",
      required_materials: ind.required_materials ?? "",
      level: ind.level as 1 | 2 | 3,
      parent_id: ind.parent_id ?? "",
    });
    setIndOpen(true);
  };

  const submitIndicator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeId) return;
    if (!iForm.name.trim()) return toast.error("指标名称必填");
    if (iForm.level > 1 && !iForm.parent_id) return toast.error("请选择上级指标");
    if (mode === "edit" && editing) {
      const hasChildren = indicators.some((i) => i.parent_id === editing.id);
      if (hasChildren && iForm.level !== editing.level) {
        return toast.error("该指标下还有子指标，请先调整子指标后再修改当前层级");
      }
      if (iForm.parent_id && descendantIdsOf(editing.id).has(iForm.parent_id)) {
        return toast.error("上级指标不能选择当前指标的子级");
      }
    }
    const nextWeight = Number(iForm.weight) || 0;
    if (iForm.level === 1) {
      const siblingTotal = indicators
        .filter((indicator) => indicator.level === 1 && indicator.id !== editing?.id)
        .reduce((sum, indicator) => sum + (Number(indicator.weight) || 0), 0);
      if (siblingTotal + nextWeight > 100) {
        return toast.error(`一级指标权重合计不能超过 100，当前保存后将达到 ${siblingTotal + nextWeight}`);
      }
    } else {
      const parent = indicators.find((indicator) => indicator.id === iForm.parent_id);
      if (!parent) return toast.error("未找到上级指标");
      const siblingTotal = indicators
        .filter((indicator) => indicator.parent_id === iForm.parent_id && indicator.id !== editing?.id)
        .reduce((sum, indicator) => sum + (Number(indicator.weight) || 0), 0);
      if (siblingTotal + nextWeight > Number(parent.weight || 0)) {
        return toast.error(`当前层级权重合计不能超过上级指标“${parent.name}”的权重 ${parent.weight}`);
      }
    }
    const payload: any = {
      code: iForm.code.trim() || null,
      name: iForm.name.trim(),
      weight: Number(iForm.weight) || 0,
      scoring_method: iForm.scoring_method.trim() || null,
      required_materials: iForm.required_materials.trim() || null,
      level: iForm.level,
      parent_id: iForm.level === 1 ? null : iForm.parent_id,
    };
    let error;
    if (mode === "edit" && editing) {
      ({ error } = await supabase.from("evaluation_indicators").update(payload).eq("id", editing.id));
    } else {
      payload.system_id = activeId;
      payload.created_by = user.id;
      payload.sort_order = indicators.filter(i => i.level === iForm.level).length + 1;
      ({ error } = await supabase.from("evaluation_indicators").insert(payload));
    }
    if (error) return toast.error(error.message);
    toast.success(mode === "edit" ? "指标已更新" : "已添加指标");
    setIndOpen(false);
    setEditing(null);
    loadIndicators(activeId);
  };

  const delIndicator = async (id: string) => {
    const children = indicators.filter(i => i.parent_id === id);
    const desc = children.length > 0
      ? `该指标下还有 ${children.length} 项子指标，将一并删除。此操作不可撤销。`
      : "此操作不可撤销。";
    if (!(await confirm({ title: "删除该指标？", description: desc, destructive: true, confirmText: "删除指标" }))) return;
    // 递归收集子孙
    const toDel = new Set<string>([id]);
    const collect = (pid: string) => {
      indicators.filter(i => i.parent_id === pid).forEach(c => { toDel.add(c.id); collect(c.id); });
    };
    collect(id);
    await supabase.from("evaluation_indicators").delete().in("id", Array.from(toDel));
    loadIndicators(activeId);
  };

  const delSystem = async () => {
    if (!active) return;
    if (!(await confirm({ title: `删除整个评估体系"${active.name}"？`, description: "该体系及其下所有指标将被永久删除，已关联此体系的项目将变为「未关联」状态。", destructive: true, confirmText: "删除整个体系" }))) return;
    await supabase.from("evaluation_systems").delete().eq("id", active.id);
    setActiveId("");
    load();
  };

  const level1 = useMemo(() => indicators.filter(i => i.level === 1), [indicators]);
  const childrenOf = (pid: string) => indicators.filter(i => i.parent_id === pid);
  const totalWeight = level1.reduce((s, i) => s + (Number(i.weight) || 0), 0);
  const descendantIdsOf = (id: string): Set<string> => {
    const result = new Set<string>();
    const walk = (pid: string) => {
      indicators.filter(i => i.parent_id === pid).forEach((child) => {
        result.add(child.id);
        walk(child.id);
      });
    };
    walk(id);
    return result;
  };
  const parentCandidates = useMemo(() => {
    const blocked = editing ? descendantIdsOf(editing.id) : new Set<string>();
    if (editing) blocked.add(editing.id);
    if (iForm.level === 2) return indicators.filter(i => i.level === 1 && !blocked.has(i.id));
    if (iForm.level === 3) return indicators.filter(i => i.level === 2 && !blocked.has(i.id));
    return [];
  }, [iForm.level, indicators, editing]);

  const toggle = (id: string) => setExpanded(s => ({ ...s, [id]: !s[id] }));

  const renderIndicator = (ind: Indicator) => {
    const kids = childrenOf(ind.id);
    const open = expanded[ind.id] ?? true;
    const indent = ind.level === 1 ? 0 : ind.level === 2 ? 20 : 40;
    const tone = ind.level === 1 ? "gold" : ind.level === 2 ? "info" : "neutral";
    return (
      <div key={ind.id}>
        <div
          className="group flex items-start gap-2 p-2.5 rounded-md border border-border bg-card/50 hover:border-accent/40 transition-colors"
          style={{ marginLeft: indent }}
        >
          {kids.length > 0 ? (
            <button onClick={() => toggle(ind.id)} className="mt-0.5 shrink-0 text-muted-foreground hover:text-accent">
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <div className="font-mono text-xs tabular-nums text-accent w-12 shrink-0 pt-0.5">{ind.code ?? "—"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-foreground">{ind.name}</span>
              <StatusPill tone={tone as any} dot={false}>L{ind.level} · 权重 {ind.weight}</StatusPill>
            </div>
            {ind.scoring_method && <div className="mt-1 text-xs text-muted-foreground">{ind.scoring_method}</div>}
            {ind.required_materials && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {ind.required_materials.split(/[,，]/).map((m, idx) => m.trim() && (
                  <span key={idx} className="text-[11px] px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground font-mono">
                    {m.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
            {ind.level < 3 && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openAdd((ind.level + 1) as 2 | 3, ind)}>
                <Plus className="h-3 w-3" />子指标
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveToLibrary(ind)} title="沉淀到指标库">
              <BookMarked className="h-3.5 w-3.5 text-accent" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(ind)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delIndicator(ind.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
        {open && kids.length > 0 && (
          <div className="space-y-2 mt-2">
            {kids.map(renderIndicator)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="PHASE II · 04A · 评估指标体系"
        title="评估指标体系库"
        subtitle="一/二/三级指标手工增删改 · 自动关联资料项"
        actions={isAdmin && (
          <Dialog open={sysOpen} onOpenChange={setSysOpen}>
            <DialogTrigger asChild>
              <Button variant="hero"><Plus className="h-4 w-4" />新建指标体系</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-xl">新建评估指标体系</DialogTitle></DialogHeader>
              <form onSubmit={submitSystem} className="space-y-3">
                <div><Label>体系名称 *</Label><Input value={sForm.name} onChange={e => setSForm({ ...sForm, name: e.target.value })} placeholder="如：智慧城市项目事前绩效评估指标体系" maxLength={120} required /></div>
                <div>
                  <Label>行业大类</Label>
                  <Select value={sForm.category} onValueChange={v => setSForm({ ...sForm, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="基础设施">基础设施</SelectItem>
                      <SelectItem value="民生工程">民生工程</SelectItem>
                      <SelectItem value="信息化">信息化</SelectItem>
                      <SelectItem value="产业发展">产业发展</SelectItem>
                      <SelectItem value="生态环保">生态环保</SelectItem>
                      <SelectItem value="其他">其他</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>说明</Label><Textarea value={sForm.description} onChange={e => setSForm({ ...sForm, description: e.target.value })} rows={3} maxLength={500} /></div>
                <DialogFooter><Button type="submit" variant="hero">保存</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatTile label="SYSTEMS" value={systems.length.toString().padStart(2, "0")} hint="已建评估体系" icon={Layers} tone="info" />
        <StatTile label="INDICATORS" value={indicators.length.toString().padStart(2, "0")} hint="当前体系指标项（含三级）" icon={ListTree} tone="accent" />
        <StatTile label="L1 WEIGHT" value={totalWeight.toString()} hint="一级权重合计（目标 100）" icon={FileSpreadsheet} tone={totalWeight === 100 ? "success" : "warning"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <Card className="surface-card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">SYSTEMS</div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">[{systems.length.toString().padStart(2, "0")}]</span>
          </div>
          {systems.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">暂无指标体系</div>
          ) : (
            <div className="divide-y divide-border max-h-[640px] overflow-auto">
              {systems.map(s => {
                const isActive = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`relative w-full text-left p-4 transition-all ${isActive ? "bg-accent/8" : "hover:bg-accent/4"}`}
                  >
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />}
                    <div className={`font-display font-semibold text-sm truncate ${isActive ? "text-accent" : "text-foreground"}`}>{s.name}</div>
                    <div className="mt-1 flex items-center gap-2">
                      {s.category && <StatusPill tone="gold" dot={false}>{s.category}</StatusPill>}
                      {s.is_template && <StatusPill tone="info" dot={false}>模板</StatusPill>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {!active ? (
          <Card className="surface-card p-0">
            <EmptyState
              icon={Layers}
              title="请选择或新建指标体系"
              hint="建立评估指标体系后，可在『资料审核』页将每条资料关联到对应指标"
            />
          </Card>
        ) : (
          <Card className="surface-card p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="section-eyebrow mb-2">{active.category ?? "—"}</div>
                <h2 className="font-display text-2xl font-bold text-foreground">{active.name}</h2>
                {active.description && <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{active.description}</p>}
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={delSystem}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>

            <SectionHeader
              eyebrow="INDICATORS · 一/二/三级指标"
              title="指标项清单"
              count={indicators.length}
              icon={ListTree}
              actions={
                isAdmin ? (
                  <>
                    {indicators.length === 0 && (
                      <Button size="sm" variant="outline" onClick={loadTemplate}>
                        <Sparkles className="h-3.5 w-3.5" />加载预设模板
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={openLibrary}>
                      <Library className="h-3.5 w-3.5" />从指标库导入
                    </Button>
                    <Button size="sm" variant="hero" onClick={() => openAdd(1)}>
                      <Plus className="h-3.5 w-3.5" />新增指标
                    </Button>
                  </>
                ) : null
              }
            />

            {level1.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8 border border-dashed border-border rounded-md">
                暂无指标 · 点击右上角"加载预设模板"快速建立 5 项标准一级指标，或手工新增
              </div>
            ) : (
              <div className="space-y-2">
                {level1.map(renderIndicator)}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* 指标新增/编辑对话框 */}
      <Dialog open={indOpen} onOpenChange={(o) => { setIndOpen(o); if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {mode === "edit" ? "编辑指标项" : "新增指标"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submitIndicator} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>层级 *</Label>
                <Select
                  value={String(iForm.level)}
                  onValueChange={(v) => setIForm({ ...iForm, level: Number(v) as 1 | 2 | 3, parent_id: "" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">一级</SelectItem>
                    <SelectItem value="2">二级</SelectItem>
                    <SelectItem value="3">三级</SelectItem>
                  </SelectContent>
                </Select>
                {mode === "edit" && indicators.some(i => i.parent_id === editing?.id) && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    当前指标下有子指标，可改上级归属，但不能直接修改当前层级。
                  </div>
                )}
              </div>
              <div>
                <Label>编号</Label>
                <Input value={iForm.code} onChange={e => setIForm({ ...iForm, code: e.target.value })} placeholder="如 1.1.1" maxLength={20} />
              </div>
            </div>
            {iForm.level > 1 && (
              <div>
                <Label>上级指标 *</Label>
                <Select value={iForm.parent_id} onValueChange={(v) => setIForm({ ...iForm, parent_id: v })}>
                  <SelectTrigger><SelectValue placeholder="请选择上级" /></SelectTrigger>
                  <SelectContent>
                    {parentCandidates.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.code ? `${p.code} ` : ""}{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>指标名称 *</Label><Input value={iForm.name} onChange={e => setIForm({ ...iForm, name: e.target.value })} maxLength={120} required /></div>
            <div><Label>权重</Label><Input type="number" step="0.01" value={iForm.weight} onChange={e => setIForm({ ...iForm, weight: Number(e.target.value) })} /></div>
            <div>
              <Label>评分方法 / 自定义公式</Label>
              <Textarea
                value={iForm.scoring_method}
                onChange={e => setIForm({ ...iForm, scoring_method: e.target.value })}
                rows={2}
                maxLength={500}
                placeholder="如：查阅预算测算材料；或公式：经济性得分=市场对标分×60%+节约率分×40%"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                可记录文字评分规则，也可直接写入项目自定义评分公式；后续专家打分和报告生成会随指标一并引用。
              </p>
            </div>
            <div>
              <Label>关联资料（逗号分隔）</Label>
              <Input value={iForm.required_materials} onChange={e => setIForm({ ...iForm, required_materials: e.target.value })} placeholder="如：可行性研究报告, 立项批复" />
            </div>
            <DialogFooter><Button type="submit" variant="hero">{mode === "edit" ? "更 新" : "保 存"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 指标库导入 Dialog */}
      <Dialog open={libOpen} onOpenChange={setLibOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Library className="h-5 w-5 text-accent" /> 从绩效目标库导入
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 items-center pb-2 border-b border-border">
            <Input value={libQ} onChange={e => setLibQ(e.target.value)} placeholder="搜索指标名称 / 编号 / 评分方法…" className="flex-1" />
            <Select value={libCat} onValueChange={setLibCat}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部行业</SelectItem>
                <SelectItem value="基础设施">基础设施</SelectItem>
                <SelectItem value="民生工程">民生工程</SelectItem>
                <SelectItem value="信息化">信息化</SelectItem>
                <SelectItem value="产业发展">产业发展</SelectItem>
                <SelectItem value="生态环保">生态环保</SelectItem>
                <SelectItem value="其他">其他</SelectItem>
              </SelectContent>
            </Select>
            <Select value={libLevel} onValueChange={setLibLevel}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="1">L1</SelectItem>
                <SelectItem value="2">L2</SelectItem>
                <SelectItem value="3">L3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-auto py-2 space-y-1.5">
            {filteredLib.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">指标库为空或无匹配结果</div>
            ) : filteredLib.map((g) => {
              const checked = libPicked.has(g.id);
              return (
                <label key={g.id} className={`flex items-start gap-3 p-2.5 rounded border transition cursor-pointer ${checked ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"}`}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    const s = new Set(libPicked);
                    if (s.has(g.id)) s.delete(g.id); else s.add(g.id);
                    setLibPicked(s);
                  }} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {g.code && <span className="font-mono text-xs text-accent">{g.code}</span>}
                      <span className="font-medium">{g.name}</span>
                      <StatusPill tone={g.level === 1 ? "gold" : "info"} dot={false}>L{g.level} · 权重 {g.weight}</StatusPill>
                      {g.category && <StatusPill tone="neutral" dot={false}>{g.category}</StatusPill>}
                      <span className="ml-auto text-[11px] font-mono text-muted-foreground">{g.usage_count}× 引用</span>
                    </div>
                    {g.scoring_method && <div className="text-xs text-muted-foreground mt-1">{g.scoring_method}</div>}
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground mr-auto self-center">已选 {libPicked.size} 项 · 将以一级指标插入（可后续编辑层级）</div>
            <Button variant="outline" onClick={() => setLibOpen(false)}>取消</Button>
            <Button variant="hero" onClick={importFromLibrary} disabled={libPicked.size === 0}>导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
};

export default EvaluationSystem;

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, Package, Building2, Coins, FolderKanban, Upload, FileSpreadsheet, Pencil, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, StatTile, EmptyState, SectionHeader } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";

interface Pkg {
  id: string; code: string | null; name: string;
  fiscal_year: number; fiscal_dept: string | null;
  agent_org: string | null; manager: string | null; notes: string | null;
}
interface Project {
  id: string; package_id: string | null; name: string; unit: string;
  budget_unit: string | null; expense_dept: string | null; manager: string | null;
  budget: number; category: string | null;
  list_attribute: string | null; project_attribute: string | null;
}

const schema = z.object({
  name: z.string().trim().min(1, "包名称必填").max(200),
  code: z.string().trim().max(50).optional(),
  fiscal_year: z.coerce.number().int().min(2000).max(2100),
  fiscal_dept: z.string().trim().max(100).optional(),
  agent_org: z.string().trim().max(200).optional(),
  manager: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
});

const projectSchema = z.object({
  name: z.string().trim().min(1, "项目名称必填").max(200),
  budget_unit: z.string().trim().min(1, "预算单位必填").max(200),
  budget_wan: z.coerce.number().min(0, "金额不能小于 0").max(1e9, "金额过大"),
  list_attribute: z.string().trim().max(100).optional(),
  project_attribute: z.string().trim().max(100).optional(),
  expense_dept: z.string().trim().max(200).optional(),
  manager: z.string().trim().max(50).optional(),
  agent_org: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
});

const Packages = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState<Pkg[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [form, setForm] = useState({
    name: "", code: "", fiscal_year: new Date().getFullYear(),
    fiscal_dept: "", agent_org: "", manager: "", notes: "",
  });
  const [projectForm, setProjectForm] = useState({
    name: "",
    budget_unit: "",
    budget_wan: "",
    list_attribute: "",
    project_attribute: "",
    expense_dept: "",
    manager: "",
    agent_org: "",
    description: "",
  });
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);

  const load = async () => {
    const [{ data: pk }, { data: pj }] = await Promise.all([
      supabase.from("evaluation_packages").select("*").order("created_at", { ascending: false }),
      supabase.from("projects").select("id,package_id,name,unit,budget_unit,expense_dept,manager,budget,category,list_attribute,project_attribute"),
    ]);
    setList((pk as Pkg[]) ?? []);
    setProjects((pj as Project[]) ?? []);
    if (!activeId && pk && pk.length) setActiveId(pk[0].id);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const active = list.find(p => p.id === activeId);
  const inPackage = projects.filter(p => p.package_id === activeId);

  const reset = () => {
    setForm({ name: "", code: "", fiscal_year: new Date().getFullYear(), fiscal_dept: "", agent_org: "", manager: "", notes: "" });
    setEditing(null);
  };

  const resetProjectForm = () => {
    setProjectForm({
      name: "",
      budget_unit: "",
      budget_wan: "",
      list_attribute: "",
      project_attribute: "",
      expense_dept: active?.fiscal_dept ?? "",
      manager: active?.manager ?? "",
      agent_org: active?.agent_org ?? "",
      description: "",
    });
  };

  const openEdit = (p: Pkg) => {
    setEditing(p);
    setForm({
      name: p.name, code: p.code ?? "", fiscal_year: p.fiscal_year,
      fiscal_dept: p.fiscal_dept ?? "", agent_org: p.agent_org ?? "",
      manager: p.manager ?? "", notes: p.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    const payload = {
      name: parsed.data.name,
      code: parsed.data.code || null,
      fiscal_year: parsed.data.fiscal_year,
      fiscal_dept: parsed.data.fiscal_dept || null,
      agent_org: parsed.data.agent_org || null,
      manager: parsed.data.manager || null,
      notes: parsed.data.notes || null,
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from("evaluation_packages").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("evaluation_packages").insert({ ...payload, created_by: user.id } as any));
    }
    if (error) return toast.error(error.message);
    toast.success(editing ? "已更新" : "评估包已创建");
    setOpen(false); reset(); load();
  };

  const del = async (p: Pkg) => {
    const cnt = projects.filter(x => x.package_id === p.id).length;
    if (!(await confirm({
      title: `删除评估包"${p.name}"？`,
      description: cnt > 0 ? `该包下尚有 ${cnt} 个项目，删除后这些项目将变为未归属（不会被删除）。` : "此操作不可撤销。",
      destructive: true, confirmText: "删除评估包",
    }))) return;
    await supabase.from("projects").update({ package_id: null }).eq("package_id", p.id);
    await supabase.from("evaluation_packages").delete().eq("id", p.id);
    toast.success("已删除"); if (activeId === p.id) setActiveId("");
    load();
  };

  // Excel 批量导入
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) return toast.error("Excel 中没有可识别的数据行");
    setImportRows(rows);
  };

  const doImport = async () => {
    if (!user || !activeId || !importRows.length) return;
    setImporting(true);
    try {
      // 兼容字段名：序号 / 中介机构 / 支出科室 / 预算单位 / 项目名称 / 金额（万元）/ 项目清单属性 / 项目属性 / 专管员
      const payload = importRows.map((r: any) => {
        const name = String(r["项目名称"] ?? r["项目"] ?? r["name"] ?? "").trim();
        const unit = String(r["预算单位"] ?? r["申请单位"] ?? r["unit"] ?? "").trim();
        const wan = Number(String(r["金额（万元）"] ?? r["金额"] ?? r["预算（万元）"] ?? r["budget"] ?? 0).toString().replace(/,/g, "")) || 0;
        return {
          package_id: activeId,
          name: name || "（未命名项目）",
          unit: unit || "（未填写）",
          budget_unit: unit || null,
          budget: wan * 10000,
          category: String(r["项目属性"] ?? "").trim() || null,
          list_attribute: String(r["项目清单属性"] ?? "").trim() || null,
          project_attribute: String(r["项目属性"] ?? "").trim() || null,
          expense_dept: String(r["支出科室"] ?? "").trim() || null,
          manager: String(r["专管员"] ?? r["专管员姓名"] ?? "").trim() || null,
          agent_org: String(r["中介机构"] ?? "").trim() || null,
          created_by: user.id,
        };
      }).filter(r => r.name && r.name !== "（未命名项目）");
      if (!payload.length) {
        toast.error("未识别到有效项目，请检查表头是否包含「项目名称/预算单位/金额（万元）」");
        return;
      }
      const { error } = await supabase.from("projects").insert(payload as any);
      if (error) throw error;
      toast.success(`已导入 ${payload.length} 个项目`);
      setImportOpen(false); setImportRows([]); load();
    } catch (e: any) {
      toast.error(e?.message ?? "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeId) return;
    const parsed = projectSchema.safeParse(projectForm);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    setProjectSaving(true);
    try {
      const payload = {
        package_id: activeId,
        name: parsed.data.name,
        unit: parsed.data.budget_unit,
        budget_unit: parsed.data.budget_unit,
        budget: Math.round(parsed.data.budget_wan * 10000),
        category: parsed.data.project_attribute || null,
        project_attribute: parsed.data.project_attribute || null,
        list_attribute: parsed.data.list_attribute || null,
        expense_dept: parsed.data.expense_dept || null,
        manager: parsed.data.manager || null,
        agent_org: parsed.data.agent_org || null,
        description: parsed.data.description || null,
        created_by: user.id,
      };
      const { error } = await supabase.from("projects").insert(payload as any);
      if (error) throw error;
      toast.success("项目已创建并加入当前评估包");
      setProjectOpen(false);
      resetProjectForm();
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "创建项目失败");
    } finally {
      setProjectSaving(false);
    }
  };

  // 汇总
  const summaryByUnit = useMemo(() => {
    const m = new Map<string, { count: number; budget: number }>();
    inPackage.forEach(p => {
      const k = p.budget_unit ?? p.unit ?? "—";
      const v = m.get(k) ?? { count: 0, budget: 0 };
      v.count += 1; v.budget += Number(p.budget) || 0;
      m.set(k, v);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].budget - a[1].budget);
  }, [inPackage]);

  const summaryByAttr = useMemo(() => {
    const m = new Map<string, { count: number; budget: number }>();
    inPackage.forEach(p => {
      const k = p.list_attribute ?? "未分类";
      const v = m.get(k) ?? { count: 0, budget: 0 };
      v.count += 1; v.budget += Number(p.budget) || 0;
      m.set(k, v);
    });
    return Array.from(m.entries()).sort((a, b) => b[1].budget - a[1].budget);
  }, [inPackage]);

  const totalBudget = inPackage.reduce((s, p) => s + (Number(p.budget) || 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="PHASE I · 00 · 评估包"
        title="财政评估包管理"
        subtitle="按『包』组织多个项目 · 批量从财政汇总表导入 · 按预算单位/项目属性自动汇总"
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button variant="hero"><Plus className="h-4 w-4" />新建评估包</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">{editing ? "编辑评估包" : "新建评估包"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>包编号</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="如 2025-01" maxLength={50} /></div>
                  <div className="col-span-2"><Label>包名称 *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如 2025年部门预算事前绩效评估第一包" required maxLength={200} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>财政年度 *</Label><Input type="number" value={form.fiscal_year} onChange={e => setForm({ ...form, fiscal_year: Number(e.target.value) })} required /></div>
                  <div><Label>财政支出科室</Label><Input value={form.fiscal_dept} onChange={e => setForm({ ...form, fiscal_dept: e.target.value })} placeholder="如 公共事业科" maxLength={100} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>中介机构</Label><Input value={form.agent_org} onChange={e => setForm({ ...form, agent_org: e.target.value })} maxLength={200} /></div>
                  <div><Label>财政专管员</Label><Input value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} maxLength={50} /></div>
                </div>
                <div><Label>备注</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} maxLength={500} /></div>
                <DialogFooter><Button type="submit" variant="hero">{editing ? "更新" : "保存"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatTile label="PACKAGES" value={list.length.toString().padStart(2, "0")} hint="评估包总数" icon={Package} tone="info" />
        <StatTile label="ACTIVE PROJECTS" value={inPackage.length.toString().padStart(2, "0")} hint="当前包项目数" icon={FolderKanban} tone="accent" />
        <StatTile label="UNITS" value={summaryByUnit.length.toString().padStart(2, "0")} hint="涉及预算单位" icon={Building2} tone="gold" />
        <StatTile label="TOTAL BUDGET" value={`¥${(totalBudget / 10000).toFixed(1)}万`} hint="当前包累计预算" icon={Coins} tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <Card className="surface-card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">PACKAGES</div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">[{list.length.toString().padStart(2, "0")}]</span>
          </div>
          {list.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">暂无评估包</div>
          ) : (
            <div className="divide-y divide-border max-h-[640px] overflow-auto">
              {list.map(p => {
                const isActive = p.id === activeId;
                const cnt = projects.filter(x => x.package_id === p.id).length;
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    className={`relative w-full text-left p-4 transition-all ${isActive ? "bg-accent/8" : "hover:bg-accent/4"}`}>
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-display font-semibold text-sm truncate ${isActive ? "text-accent" : "text-foreground"}`}>{p.name}</span>
                      <StatusPill tone="info" dot={false}>{cnt}</StatusPill>
                    </div>
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground tabular-nums">
                      {p.code ?? "—"} · {p.fiscal_year}年 · {p.manager ?? "未指派"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {!active ? (
          <Card className="surface-card p-0">
            <EmptyState icon={Package} title="请选择或新建评估包" hint="先新建评估包，再批量导入财政汇总表中的项目清单" />
          </Card>
        ) : (
          <div className="space-y-5">
            <Card className="surface-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="section-eyebrow mb-2">{active.code ?? "包编号待填"} · {active.fiscal_year} 年</div>
                  <h2 className="font-display text-2xl font-bold text-foreground">{active.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {active.fiscal_dept && <StatusPill tone="info" dot={false}>支出科室 {active.fiscal_dept}</StatusPill>}
                    {active.agent_org && <StatusPill tone="gold" dot={false}>中介 {active.agent_org}</StatusPill>}
                    {active.manager && <StatusPill tone="success" dot={false}>专管员 {active.manager}</StatusPill>}
                  </div>
                  {active.notes && <p className="mt-3 text-sm text-muted-foreground">{active.notes}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link to={`/packages/${active.id}`}>
                    <Button variant="hero" size="sm"><ArrowRight className="h-4 w-4" />打开详情</Button>
                  </Link>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(active)} className="h-8 w-8">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => del(active)} className="h-8 w-8">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="surface-card p-6">
              <SectionHeader
                eyebrow="IMPORT · 财政汇总表批量导入"
                title="批量导入项目"
                icon={Upload}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Dialog open={projectOpen} onOpenChange={(o) => { setProjectOpen(o); if (o) resetProjectForm(); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" />手动创建项目</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <DialogHeader>
                          <DialogTitle className="font-display text-xl">手动创建项目</DialogTitle>
                          <DialogDescription>
                            项目会直接加入当前评估包，字段口径与 Excel 导入保持一致。
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={createProject} className="space-y-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="md:col-span-2">
                              <Label>项目名称 *</Label>
                              <Input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} placeholder="填写项目名称" />
                            </div>
                            <div>
                              <Label>预算单位 *</Label>
                              <Input value={projectForm.budget_unit} onChange={(e) => setProjectForm({ ...projectForm, budget_unit: e.target.value })} placeholder="填写预算单位" />
                            </div>
                            <div>
                              <Label>金额（万元） *</Label>
                              <Input type="number" min={0} step="0.01" value={projectForm.budget_wan} onChange={(e) => setProjectForm({ ...projectForm, budget_wan: e.target.value })} placeholder="如 5800" />
                            </div>
                            <div>
                              <Label>项目清单属性</Label>
                              <Input value={projectForm.list_attribute} onChange={(e) => setProjectForm({ ...projectForm, list_attribute: e.target.value })} placeholder="如 新增项目" />
                            </div>
                            <div>
                              <Label>项目属性</Label>
                              <Input value={projectForm.project_attribute} onChange={(e) => setProjectForm({ ...projectForm, project_attribute: e.target.value })} placeholder="如 信息化建设" />
                            </div>
                            <div>
                              <Label>支出科室</Label>
                              <Input value={projectForm.expense_dept} onChange={(e) => setProjectForm({ ...projectForm, expense_dept: e.target.value })} placeholder="填写支出科室" />
                            </div>
                            <div>
                              <Label>专管员</Label>
                              <Input value={projectForm.manager} onChange={(e) => setProjectForm({ ...projectForm, manager: e.target.value })} placeholder="填写专管员" />
                            </div>
                            <div className="md:col-span-2">
                              <Label>中介机构</Label>
                              <Input value={projectForm.agent_org} onChange={(e) => setProjectForm({ ...projectForm, agent_org: e.target.value })} placeholder="填写中介机构" />
                            </div>
                            <div className="md:col-span-2">
                              <Label>项目说明</Label>
                              <Textarea value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} rows={3} placeholder="可选：填写项目背景或备注" />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setProjectOpen(false)}>取消</Button>
                            <Button type="submit" variant="hero" disabled={projectSaving}>
                              {projectSaving ? "创建中…" : "创建并加入当前包"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) setImportRows([]); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="hero"><FileSpreadsheet className="h-3.5 w-3.5" />从 Excel 导入</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl">
                        <DialogHeader>
                          <DialogTitle className="font-display text-xl">从财政汇总表导入项目</DialogTitle>
                          <DialogDescription>
                            支持 .xlsx/.xls；表头识别：项目名称、预算单位、金额（万元）、项目清单属性、项目属性、支出科室、专管员、中介机构
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
                          {importRows.length > 0 && (
                            <div className="border border-border rounded-md max-h-80 overflow-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>项目名称</TableHead>
                                    <TableHead>预算单位</TableHead>
                                    <TableHead className="text-right">金额(万)</TableHead>
                                    <TableHead>清单属性</TableHead>
                                    <TableHead>专管员</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {importRows.slice(0, 50).map((r, i) => (
                                    <TableRow key={i}>
                                      <TableCell className="text-xs">{r["项目名称"] ?? r["项目"] ?? "—"}</TableCell>
                                      <TableCell className="text-xs">{r["预算单位"] ?? "—"}</TableCell>
                                      <TableCell className="text-right text-xs font-mono">{r["金额（万元）"] ?? r["金额"] ?? "—"}</TableCell>
                                      <TableCell className="text-xs">{r["项目清单属性"] ?? "—"}</TableCell>
                                      <TableCell className="text-xs">{r["专管员"] ?? "—"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                              {importRows.length > 50 && (
                                <div className="p-2 text-center text-xs text-muted-foreground bg-muted/30">仅展示前 50 行，实际导入 {importRows.length} 行</div>
                              )}
                            </div>
                          )}
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setImportOpen(false)}>取消</Button>
                          <Button variant="hero" onClick={doImport} disabled={!importRows.length || importing}>
                            {importing ? "导入中…" : `确认导入 ${importRows.length} 行`}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                }
              />
              <p className="text-xs text-muted-foreground mt-2">将财政提供的"事前绩效评估项目汇总表"另存为 Excel 后上传，系统按表头自动识别字段并批量入库为本包项目。</p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="surface-card p-6">
                <SectionHeader eyebrow="BY UNIT · 按预算单位汇总" title="预算单位维度" icon={Building2} count={summaryByUnit.length} />
                {summaryByUnit.length === 0 ? <div className="text-sm text-muted-foreground py-4 text-center">暂无项目</div> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>预算单位</TableHead>
                      <TableHead className="text-right">项目数</TableHead>
                      <TableHead className="text-right">预算合计</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summaryByUnit.map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="font-medium">{k}</TableCell>
                          <TableCell className="text-right font-mono">{v.count}</TableCell>
                          <TableCell className="text-right font-mono text-cyan">¥{(v.budget / 10000).toFixed(1)}万</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              <Card className="surface-card p-6">
                <SectionHeader eyebrow="BY ATTRIBUTE · 按项目属性汇总" title="清单属性维度" icon={FolderKanban} count={summaryByAttr.length} />
                {summaryByAttr.length === 0 ? <div className="text-sm text-muted-foreground py-4 text-center">暂无项目</div> : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>清单属性</TableHead>
                      <TableHead className="text-right">项目数</TableHead>
                      <TableHead className="text-right">预算合计</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {summaryByAttr.map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="font-medium">{k}</TableCell>
                          <TableCell className="text-right font-mono">{v.count}</TableCell>
                          <TableCell className="text-right font-mono text-gold">¥{(v.budget / 10000).toFixed(1)}万</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            </div>

            <Card className="surface-card overflow-hidden p-0">
              <div className="px-6 py-3 border-b border-border bg-muted/30">
                <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">本包项目清单</div>
              </div>
              {inPackage.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">本包暂无项目，可使用上方"批量导入"或在"评估对象管理"中将项目归入此包</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>项目名称</TableHead>
                    <TableHead>预算单位</TableHead>
                    <TableHead className="text-right">预算(元)</TableHead>
                    <TableHead>清单属性</TableHead>
                    <TableHead>项目属性</TableHead>
                    <TableHead>专管员</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {inPackage.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.budget_unit ?? p.unit}</TableCell>
                        <TableCell className="text-right font-mono">{Number(p.budget).toLocaleString()}</TableCell>
                        <TableCell>{p.list_attribute ? <StatusPill tone="info" dot={false}>{p.list_attribute}</StatusPill> : "—"}</TableCell>
                        <TableCell>{p.project_attribute ? <StatusPill tone="gold" dot={false}>{p.project_attribute}</StatusPill> : "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{p.manager ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        )}
      </div>
      <ConfirmDialog />
    </>
  );
};

export default Packages;

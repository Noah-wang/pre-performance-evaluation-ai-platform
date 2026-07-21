import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, FileCode, Pencil, Search, ShieldAlert, Stamp, FileText } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, EmptyState, StatTile } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { clearTemplateCache } from "@/lib/templates";

interface DocTemplate {
  id: string;
  template_key: string;
  name: string;
  category: string;
  content: string;
  variables: string | null;
  enabled: boolean;
  notes: string | null;
  updated_at: string;
}

const CATEGORIES = [
  { v: "report", label: "评估报告" },
  { v: "expert", label: "专家文书" },
  { v: "plan", label: "工作方案" },
  { v: "red", label: "财政套红" },
  { v: "security", label: "水印/安全" },
  { v: "general", label: "通用" },
];

const FISCAL_TEMPLATE_PRESETS = [
  {
    key: "fiscal.attachment3.plan",
    name: "附件3 评估工作方案",
    category: "plan",
    variables: "{{project_name}}, {{unit}}, {{date}}",
    notes: "用于生成事前绩效评估工作方案的财政格式片段。",
    content: "北京市通州区财政支出项目事前绩效评估工作方案\n\n项目名称：{{project_name}}\n项目单位：{{unit}}\n评估时间：{{date}}\n\n一、评估目的\n二、评估对象和范围\n三、评估依据\n四、评估内容和方法\n五、工作组织及进度安排\n六、质量控制要求",
  },
  {
    key: "fiscal.attachment4.goal",
    name: "附件4 绩效目标审核表",
    category: "report",
    variables: "{{project_name}}, {{unit}}, {{budget}}",
    notes: "用于绩效目标审核和报告引用。",
    content: "项目名称：{{project_name}}\n项目单位：{{unit}}\n预算金额：{{budget}}\n\n一、总体目标审核意见\n二、产出指标审核意见\n三、效益指标审核意见\n四、满意度指标审核意见\n五、需补充完善事项",
  },
  {
    key: "fiscal.attachment8.expert",
    name: "附件8 专家组评估意见",
    category: "expert",
    variables: "{{project_name}}, {{expert_group}}, {{date}}",
    notes: "用于专家意见书和正式评估意见归集。",
    content: "财政支出项目事前绩效评估专家组意见\n\n项目名称：{{project_name}}\n专家组：{{expert_group}}\n评估日期：{{date}}\n\n一、项目基本情况\n二、专家评议情况\n三、主要问题\n四、评估结论\n五、意见建议\n\n专家签字：",
  },
  {
    key: "fiscal.attachment10.report",
    name: "附件10-1 事前绩效评估报告",
    category: "red",
    variables: "{{project_name}}, {{unit}}, {{department}}, {{date}}",
    notes: "用于正式评估报告封面、目录、正文和套红输出口径。",
    content: "财政支出项目事前绩效评估报告\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、问题及建议\n五、其他需要说明的问题\n\n评估机构：{{department}}\n日期：{{date}}",
  },
  {
    key: "fiscal.attachment10.report.submission",
    name: "附件10-1 事前绩效评估报告（送审稿）",
    category: "red",
    variables: "{{project_name}}, {{unit}}, {{department}}, {{date}}",
    notes: "用于内部流转或送审前校核，封面标题带“送审稿”。",
    content: "财政支出项目事前绩效评估报告（送审稿）\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、相关建议\n五、其他需要说明的问题\n六、附件\n\n评估机构：{{department}}\n日期：{{date}}",
  },
  {
    key: "fiscal.attachment10.report.review",
    name: "附件10-1 事前绩效评估报告（专家会后修订稿）",
    category: "red",
    variables: "{{project_name}}, {{unit}}, {{department}}, {{date}}",
    notes: "用于专家会后修订留痕，封面标题带“专家会后修订稿”。",
    content: "财政支出项目事前绩效评估报告（专家会后修订稿）\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、相关建议\n五、其他需要说明的问题\n六、附件\n\n评估机构：{{department}}\n日期：{{date}}",
  },
];

const empty = {
  template_key: "",
  name: "",
  category: "general",
  content: "",
  variables: "",
  enabled: true,
  notes: "",
};

const DocTemplates = () => {
  const { user } = useAuth();
  const { canAdmin, loading: authLoading } = usePermissions();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState<DocTemplate[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocTemplate | null>(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const { data, error } = await supabase
      .from("doc_templates")
      .select("*")
      .order("category", { ascending: true })
      .order("template_key", { ascending: true });
    if (error) return toast.error(error.message);
    setList((data as DocTemplate[]) ?? []);
  };
  useEffect(() => { if (canAdmin) load(); }, [canAdmin]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return list.filter(t => {
      if (cat !== "all" && t.category !== cat) return false;
      if (!kw) return true;
      return [t.template_key, t.name, t.content, t.notes].some(v => v?.toLowerCase().includes(kw));
    });
  }, [list, q, cat]);

  const reset = () => { setForm(empty); setEditing(null); };

  const openPreset = (preset: typeof FISCAL_TEMPLATE_PRESETS[number]) => {
    const existed = list.find((item) => item.template_key === preset.key);
    if (existed) {
      openEdit(existed);
      toast.info("该财政模板已存在，已打开编辑");
      return;
    }
    setEditing(null);
    setForm({
      template_key: preset.key,
      name: preset.name,
      category: preset.category,
      content: preset.content,
      variables: preset.variables,
      enabled: true,
      notes: preset.notes,
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.template_key.trim() || !form.name.trim()) return toast.error("模板键与名称必填");
    const payload: any = {
      template_key: form.template_key.trim(),
      name: form.name.trim(),
      category: form.category,
      content: form.content,
      variables: form.variables.trim() || null,
      enabled: form.enabled,
      notes: form.notes.trim() || null,
      updated_by: user.id,
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from("doc_templates").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("doc_templates").insert(payload));
    }
    if (error) return toast.error(error.message);
    toast.success(editing ? "已更新" : "已新增模板");
    clearTemplateCache();
    setOpen(false);
    reset();
    load();
  };

  const openEdit = (t: DocTemplate) => {
    setEditing(t);
    setForm({
      template_key: t.template_key,
      name: t.name,
      category: t.category,
      content: t.content,
      variables: t.variables ?? "",
      enabled: t.enabled,
      notes: t.notes ?? "",
    });
    setOpen(true);
  };

  const del = async (t: DocTemplate) => {
    if (!(await confirm({ title: `删除模板"${t.name}"？`, description: `模板键 ${t.template_key}，删除后导出代码将回退到内置默认值。`, destructive: true, confirmText: "删除" }))) return;
    const { error } = await supabase.from("doc_templates").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    clearTemplateCache();
    load();
    toast.success("已删除");
  };

  if (authLoading) return null;
  if (!canAdmin) {
    return (
      <Card className="surface-card p-12 text-center">
        <ShieldAlert className="h-12 w-12 mx-auto text-warning mb-4" />
        <h2 className="font-display text-xl mb-2">仅管理员可访问</h2>
        <p className="text-sm text-muted-foreground">如需在线维护文档模板，请联系系统管理员授予 admin 角色。</p>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="ADMIN · 22 · 在线模板管理"
        title="文档模板管理"
        subtitle="维护报告/专家文书/财政套红等导出文本片段 · 支持 {{变量}} 占位符 · 实时生效"
        actions={
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
            <DialogTrigger asChild>
              <Button variant="hero"><Plus className="h-4 w-4" />新增模板</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-display text-xl">{editing ? "编辑模板" : "新增模板"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>模板键 *</Label>
                    <Input value={form.template_key} onChange={e => setForm({ ...form, template_key: e.target.value })} maxLength={80} required disabled={!!editing} placeholder="report.intro" />
                  </div>
                  <div>
                    <Label>分类</Label>
                    <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>名称 *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} required /></div>
                <div>
                  <Label>内容 *</Label>
                  <Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={6} required placeholder="使用 {{project_name}}、{{user_email}} 等占位符" />
                </div>
                <div>
                  <Label>可用变量（逗号分隔）</Label>
                  <Input value={form.variables} onChange={e => setForm({ ...form, variables: e.target.value })} placeholder="{{project_name}}, {{date}}" maxLength={300} />
                </div>
                <div><Label>备注</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} /></div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  <Label className="cursor-pointer" onClick={() => setForm({ ...form, enabled: !form.enabled })}>启用</Label>
                </div>
                <DialogFooter><Button type="submit" variant="hero">{editing ? "更 新" : "保 存"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatTile label="TEMPLATES" value={list.length.toString().padStart(2, "0")} hint="模板总数" icon={FileCode} tone="info" />
        <StatTile label="ENABLED" value={list.filter(t => t.enabled).length.toString().padStart(2, "0")} hint="生效中" icon={FileCode} tone="success" />
        <StatTile label="CATEGORIES" value={new Set(list.map(t => t.category)).size.toString().padStart(2, "0")} hint="覆盖分类" icon={FileCode} tone="gold" />
        <StatTile label="FISCAL" value={list.filter(t => t.category === "red" || t.template_key.startsWith("fiscal.")).length.toString().padStart(2, "0")} hint="财政格式" icon={Stamp} tone="warning" />
      </div>

      <Card className="surface-card p-4 mb-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="section-eyebrow">FISCAL FORMAT · 财政附件模板</div>
            <p className="text-sm text-muted-foreground mt-1">
              对应附件 3 / 4 / 8 / 10-1，可作为报告、专家意见、工作方案和套红输出的在线维护入口。
            </p>
          </div>
          <StatusPill tone="gold" dot={false}>支持套红口径</StatusPill>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {FISCAL_TEMPLATE_PRESETS.map((preset) => {
            const existed = list.some((item) => item.template_key === preset.key);
            return (
              <button
                key={preset.key}
                onClick={() => openPreset(preset)}
                className="rounded-lg border border-border bg-muted/25 p-3 text-left transition hover:border-accent/50 hover:bg-accent/5"
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-accent" />
                  <span className="text-sm font-medium">{preset.name}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground truncate">{preset.key}</span>
                  <StatusPill tone={existed ? "success" : "neutral"} dot={false}>
                    {existed ? "已配置" : "可创建"}
                  </StatusPill>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="surface-card p-3 mb-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索模板键 / 名称 / 内容…" className="border-0 focus-visible:ring-0 px-0" />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.v} value={c.v}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      <Card className="surface-card overflow-hidden p-0">
        {filtered.length === 0 ? (
          <EmptyState icon={FileCode} title="暂无模板" hint="点击右上角『新增模板』开始建立文档片段" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                <TableHead className="font-mono text-[11px] uppercase">模板键</TableHead>
                <TableHead className="font-mono text-[11px] uppercase">名称</TableHead>
                <TableHead className="font-mono text-[11px] uppercase">分类</TableHead>
                <TableHead className="font-mono text-[11px] uppercase">内容预览</TableHead>
                <TableHead className="font-mono text-[11px] uppercase">状态</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(t => (
                <TableRow key={t.id} className="group hover:bg-accent/5">
                  <TableCell className="font-mono text-xs text-accent">{t.template_key}</TableCell>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell><StatusPill tone="gold" dot={false}>{CATEGORIES.find(c => c.v === t.category)?.label ?? t.category}</StatusPill></TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground truncate">{t.content}</TableCell>
                  <TableCell>
                    {t.enabled
                      ? <StatusPill tone="success" dot={false}>启用</StatusPill>
                      : <StatusPill tone="neutral" dot={false}>停用</StatusPill>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => del(t)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog />
    </div>
  );
};

export default DocTemplates;

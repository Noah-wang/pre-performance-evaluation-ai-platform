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
import { Plus, Trash2, ListTodo, Sparkles, CalendarClock, GripVertical, FileText, BookOpenCheck, Unlock } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, EmptyState } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";

interface Project { id: string; name: string; unit?: string | null; custom_fields?: unknown; }
interface RTask {
  id: string; project_id: string; report_id: string | null;
  category: string; title: string; detail: string | null;
  priority: "high" | "medium" | "low"; responsible: string | null;
  status: "todo" | "doing" | "done" | "blocked";
  due_date: string | null; completed_at: string | null;
  source: string; created_by: string; created_at: string;
}

const STATUS_COLS: { key: RTask["status"]; label: string; tone: "neutral" | "warning" | "success" | "danger" }[] = [
  { key: "todo", label: "待办", tone: "neutral" },
  { key: "doing", label: "进行中", tone: "warning" },
  { key: "blocked", label: "受阻", tone: "danger" },
  { key: "done", label: "已完成", tone: "success" },
];

const PRIORITY_META: Record<RTask["priority"], { label: string; tone: "danger" | "warning" | "neutral" }> = {
  high: { label: "高", tone: "danger" },
  medium: { label: "中", tone: "warning" },
  low: { label: "低", tone: "neutral" },
};

const PROBLEM_LIBRARY = [
  { name: "立项依据不充分", keywords: ["依据", "政策", "必要", "立项"], suggestion: "补充政策文件、部门职责、服务对象需求及历史实施依据。" },
  { name: "绩效目标不够量化", keywords: ["目标", "指标", "量化", "绩效"], suggestion: "细化数量、质量、时效、成本和效益指标，并明确年度目标值。" },
  { name: "预算测算依据不足", keywords: ["预算", "测算", "金额", "成本", "单价"], suggestion: "补充测算明细、取费标准、市场询价或同类项目对比依据。" },
  { name: "实施条件或进度风险", keywords: ["进度", "计划", "实施", "风险", "周期"], suggestion: "补充实施计划、里程碑、责任分工和风险应对安排。" },
  { name: "资料佐证不完整", keywords: ["资料", "证明", "附件", "缺少", "补充"], suggestion: "按指标逐项补充申报书、绩效目标表、预算测算材料和相关佐证文件。" },
];

const STATUS_LABEL: Record<RTask["status"], string> = {
  todo: "待办",
  doing: "进行中",
  blocked: "受阻",
  done: "已完成",
};

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
const parseRectificationMarkdown = (value: string | null | undefined) => {
  if (!value) return [];
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: Array<{ category: string; title: string; detail: string | null; priority: RTask["priority"] }> = [];
  let category = "AI 建议";
  let currentTitle = "";
  let detailLines: string[] = [];

  const pushCurrent = () => {
    if (!currentTitle) return;
    items.push({
      category,
      title: currentTitle,
      detail: detailLines.length ? detailLines.join(" ") : null,
      priority: "medium",
    });
    currentTitle = "";
    detailLines = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s*/.test(line)) {
      pushCurrent();
      category = line.replace(/^#{1,6}\s*/, "").trim() || category;
      continue;
    }
    if (/^(?:[-*]\s+|\d+[.、]\s*)/.test(line)) {
      pushCurrent();
      currentTitle = line.replace(/^(?:[-*]\s+|\d+[.、]\s*)/, "").trim();
      continue;
    }
    if (currentTitle) {
      detailLines.push(line);
    }
  }
  pushCurrent();
  return items.filter((item) => item.title);
};

const Rectifications = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<RTask[]>([]);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({
    category: "通用", title: "", detail: "", priority: "medium" as RTask["priority"],
    responsible: "", due_date: "",
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [planStatus, setPlanStatus] = useState<"draft" | "finalized">("draft");
  const [planSavedAt, setPlanSavedAt] = useState<string | null>(null);
  const [planFinalizedAt, setPlanFinalizedAt] = useState<string | null>(null);
  const [savingPlanState, setSavingPlanState] = useState(false);

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id,name,unit,custom_fields").order("created_at", { ascending: false });
    setProjects((data as Project[]) ?? []);
    if (data && data.length && !projectId) setProjectId(data[0].id);
  };

  const loadTasks = async () => {
    if (!projectId) return setTasks([]);
    const { data, error } = await supabase
      .from("rectification_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setTasks((data as RTask[]) ?? []);
  };

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { loadTasks(); /* eslint-disable-next-line */ }, [projectId]);
  useEffect(() => {
    const meta = (
      selectedProject?.custom_fields &&
      typeof selectedProject.custom_fields === "object" &&
      !Array.isArray(selectedProject.custom_fields)
        ? (selectedProject.custom_fields as Record<string, unknown>).rectification_plan_meta
        : null
    ) as Record<string, unknown> | null;
    setPlanStatus(meta?.status === "finalized" ? "finalized" : "draft");
    setPlanSavedAt(typeof meta?.saved_at === "string" ? meta.saved_at : null);
    setPlanFinalizedAt(typeof meta?.finalized_at === "string" ? meta.finalized_at : null);
  }, [projectId, projects]);

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !projectId) return;
    if (planStatus === "finalized") return toast.error("整改方案已定稿，请先转为草稿后再修改");
    if (!form.title.trim()) return toast.error("标题必填");
    const { error } = await supabase.from("rectification_tasks").insert({
      project_id: projectId,
      category: form.category || "通用",
      title: form.title.trim(),
      detail: form.detail.trim() || null,
      priority: form.priority,
      responsible: form.responsible.trim() || null,
      due_date: form.due_date || null,
      created_by: user.id,
      source: "manual",
    });
    if (error) return toast.error(error.message);
    toast.success("已添加");
    setOpen(false);
    setForm({ category: "通用", title: "", detail: "", priority: "medium", responsible: "", due_date: "" });
    loadTasks();
  };

  const updateStatus = async (t: RTask, status: RTask["status"]) => {
    if (planStatus === "finalized") return toast.error("整改方案已定稿，不能再修改任务状态");
    const patch: any = { status };
    if (status === "done") patch.completed_at = new Date().toISOString();
    else patch.completed_at = null;
    const { error } = await supabase.from("rectification_tasks").update(patch).eq("id", t.id);
    if (error) return toast.error(error.message);
    loadTasks();
  };

  const removeTask = async (t: RTask) => {
    if (planStatus === "finalized") return toast.error("整改方案已定稿，不能删除任务");
    if (!(await confirm({ title: "删除整改任务？", description: t.title, destructive: true }))) return;
    const { error } = await supabase.from("rectification_tasks").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("已删除");
    loadTasks();
  };

  const importFromReport = async () => {
    if (!user || !projectId) return;
    if (planStatus === "finalized") return toast.error("整改方案已定稿，不能再导入新任务");
    setImporting(true);
    try {
      const { data: reports } = await supabase
        .from("reports").select("id,ai_rectification,rectification")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      const r: any = (reports ?? []).find((item: any) => {
        const structuredList = Array.isArray(item?.ai_rectification) ? item.ai_rectification : [];
        const fallbackList = parseRectificationMarkdown(item?.rectification);
        return structuredList.length > 0 || fallbackList.length > 0;
      });
      const structuredList: any[] = Array.isArray(r?.ai_rectification) ? r.ai_rectification : [];
      const fallbackList = parseRectificationMarkdown(r?.rectification);
      const list: any[] = structuredList.length ? structuredList : fallbackList;
      if (!list.length) { toast.info("最近报告暂无 AI 整改建议"); return; }
      const existingKeys = new Set(tasks.map((task) => `${task.title}::${task.detail ?? ""}`));
      const rows = list
        .map((x) => ({
        project_id: projectId,
        report_id: r.id,
        category: x.category || "AI 建议",
        title: x.title || "未命名",
        detail: x.detail || null,
        priority: (["high", "medium", "low"].includes(x.priority) ? x.priority : "medium"),
        responsible: x.responsible || null,
        created_by: user.id,
        source: "ai_report",
      }))
        .filter((row) => !existingKeys.has(`${row.title}::${row.detail ?? ""}`));
      if (!rows.length) {
        toast.info("最近报告中的整改建议已全部导入");
        return;
      }
      const { error } = await supabase.from("rectification_tasks").insert(rows);
      if (error) throw error;
      toast.success(`已导入 ${rows.length} 条整改任务`);
      loadTasks();
    } catch (e: any) {
      toast.error(e?.message ?? "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const grouped = useMemo(() => {
    const m: Record<RTask["status"], RTask[]> = { todo: [], doing: [], blocked: [], done: [] };
    tasks.forEach(t => m[t.status]?.push(t));
    return m;
  }, [tasks]);

  const stats = useMemo(() => ({
    total: tasks.length,
    done: tasks.filter(t => t.status === "done").length,
    overdue: tasks.filter(t => t.status !== "done" && t.due_date && new Date(t.due_date) < new Date()).length,
  }), [tasks]);

  const selectedProject = projects.find((p) => p.id === projectId);

  const persistPlanState = async (status: "draft" | "finalized") => {
    if (!selectedProject) return;
    setSavingPlanState(true);
    try {
      const customFields = (
        selectedProject.custom_fields &&
        typeof selectedProject.custom_fields === "object" &&
        !Array.isArray(selectedProject.custom_fields)
          ? selectedProject.custom_fields as Record<string, unknown>
          : {}
      );
      const meta = {
        status,
        saved_at: new Date().toISOString(),
        finalized_at: status === "finalized" ? new Date().toISOString() : null,
      };
      const nextCustomFields = { ...customFields, rectification_plan_meta: meta };
      const { data, error } = await supabase
        .from("projects")
        .update({ custom_fields: nextCustomFields })
        .eq("id", selectedProject.id)
        .select("id,name,unit,custom_fields")
        .single();
      if (error) throw error;
      const nextProject = data as Project;
      setProjects((current) => current.map((item) => item.id === nextProject.id ? nextProject : item));
      setPlanStatus(status);
      setPlanSavedAt(meta.saved_at);
      setPlanFinalizedAt(meta.finalized_at);
      toast.success(status === "finalized" ? "整改方案已定稿并锁定" : "已取消锁定，整改方案恢复为草稿");
    } catch (error: any) {
      toast.error(error?.message ?? "保存整改方案状态失败");
    } finally {
      setSavingPlanState(false);
    }
  };

  const problemMatches = useMemo(() => {
    return PROBLEM_LIBRARY.map((item) => {
      const matchedTasks = tasks.filter((task) => {
        const haystack = `${task.category} ${task.title} ${task.detail ?? ""}`;
        return item.keywords.some((keyword) => haystack.includes(keyword));
      });
      return { ...item, matchedTasks };
    }).filter((item) => item.matchedTasks.length > 0);
  }, [tasks]);

  const handleDrop = async (status: RTask["status"]) => {
    if (!dragId) return;
    const t = tasks.find(x => x.id === dragId);
    setDragId(null);
    if (!t || t.status === status) return;
    await updateStatus(t, status);
  };

  const exportNotice = async () => {
    if (!selectedProject) return toast.error("请先选择项目");
    if (!tasks.length) return toast.error("当前项目暂无整改任务");
    const today = new Date().toLocaleDateString("zh-CN");
    const groupedText = STATUS_COLS.map((col) => {
      const list = grouped[col.key];
      if (!list.length) return "";
      const rows = list.map((task, index) => [
        `${index + 1}. ${task.title}`,
        `分类：${task.category}`,
        `责任人：${task.responsible || "待明确"}`,
        `完成期限：${task.due_date || "待明确"}`,
        `整改要求：${task.detail || "请根据评估意见补充完善相关材料和说明。"}`,
      ].join("\n")).join("\n\n");
      return `## ${col.label}\n\n${rows}`;
    }).filter(Boolean).join("\n\n");
    const libraryText = problemMatches.length
      ? problemMatches.map((item) => `- ${item.name}：涉及 ${item.matchedTasks.length} 项。整改建议：${item.suggestion}`).join("\n")
      : "- 暂未匹配到历史问题库条目，请结合评估报告人工复核。";
    const notice = [
      `# ${selectedProject.name}整改通知书`,
      `项目单位：${selectedProject.unit || "待补充"}`,
      `出具日期：${today}`,
      "",
      "根据财政支出项目事前绩效评估工作要求，现将评估过程中发现的问题及整改要求通知如下，请项目单位结合申报资料、预算测算依据和绩效目标设置情况，按期完成整改并反馈佐证材料。",
      "",
      "## 一、整改问题及任务分解",
      groupedText,
      "",
      "## 二、问题库匹配结果",
      libraryText,
      "",
      "## 三、整改闭环要求",
      "1. 对已明确责任人的事项，应按完成期限提交整改说明及附件材料。",
      "2. 对资料缺失、依据不足、预算测算不充分等问题，应逐项补充佐证文件。",
      "3. 完成整改后，由评估工作组复核并在系统中标记完成状态，形成闭环记录。",
    ].join("\n");
    const [{ createTextDocxBlob }, { saveAs }] = await Promise.all([
      import("@/lib/generatedDocx"),
      import("file-saver"),
    ]);
    const blob = await createTextDocxBlob("整改通知书", notice);
    saveAs(blob, `${safeFileName(selectedProject.name)}-整改通知书.docx`);
    toast.success("整改通知书已导出");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PHASE III · 09 · 整改追踪"
        title="整改任务看板"
        subtitle="评估发现的问题落地为可追踪、可勾选的整改任务"
        actions={
          <>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="选择项目" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={importFromReport} disabled={!projectId || importing}>
              <Sparkles className="h-4 w-4" /> {importing ? "导入中…" : "从 AI 报告导入"}
            </Button>
            <Button variant="outline" onClick={exportNotice} disabled={!projectId || !tasks.length}>
              <FileText className="h-4 w-4" /> 导出整改通知书
            </Button>
            <Button
              variant="outline"
              onClick={() => persistPlanState("draft")}
              disabled={!projectId || savingPlanState || planStatus === "finalized"}
              title={planStatus === "finalized" ? "整改方案已定稿，如需修改请先取消锁定" : undefined}
            >
              <BookOpenCheck className="h-4 w-4" /> 保存草稿
            </Button>
            {planStatus === "finalized" ? (
              <Button variant="outline" onClick={() => persistPlanState("draft")} disabled={!projectId || savingPlanState}>
                <Unlock className="h-4 w-4" /> 取消锁定
              </Button>
            ) : (
              <Button variant="hero" onClick={() => persistPlanState("finalized")} disabled={!projectId || savingPlanState || !tasks.length}>
                <BookOpenCheck className="h-4 w-4" /> 定稿锁定
              </Button>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="hero" disabled={!projectId || planStatus === "finalized"}>
                  <Plus className="h-4 w-4" /> 新增任务
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-display text-xl">新增整改任务</DialogTitle></DialogHeader>
                <form onSubmit={addTask} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>分类</Label>
                      <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                    </div>
                    <div>
                      <Label>优先级</Label>
                      <Select value={form.priority} onValueChange={(v: RTask["priority"]) => setForm({ ...form, priority: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">高</SelectItem>
                          <SelectItem value="medium">中</SelectItem>
                          <SelectItem value="low">低</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>标题 *</Label>
                    <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                  </div>
                  <div>
                    <Label>详情</Label>
                    <Textarea rows={3} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>责任人</Label>
                      <Input value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.target.value })} />
                    </div>
                    <div>
                      <Label>截止日期</Label>
                      <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                    </div>
                  </div>
                  <DialogFooter><Button type="submit" variant="hero">保存</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">任务总数</div><div className="font-display text-2xl tabular-nums mt-1">{stats.total}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">已完成</div><div className="font-display text-2xl tabular-nums mt-1 text-emerald-600">{stats.done}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">逾期未完</div><div className="font-display text-2xl tabular-nums mt-1 text-destructive">{stats.overdue}</div></Card>
      </div>

      <Card className="surface-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpenCheck className="h-4 w-4 text-accent" />
          <div className="font-display font-semibold">问题库匹配与整改闭环</div>
          <StatusPill tone={problemMatches.length ? "info" : "neutral"} dot={false} className="ml-auto">
            {problemMatches.length ? `命中 ${problemMatches.length} 类` : "待匹配"}
          </StatusPill>
        </div>
        {planStatus === "finalized" && (
          <div className="mb-3 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-muted-foreground">
            整改方案已定稿，任务内容和状态已锁定。
            {planFinalizedAt ? ` 定稿时间：${new Date(planFinalizedAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
          </div>
        )}
        {problemMatches.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {problemMatches.map((item) => (
              <div key={item.name} className="rounded-lg border border-border bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{item.name}</div>
                  <StatusPill tone="gold" dot={false}>{item.matchedTasks.length}项</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{item.suggestion}</p>
                <div className="mt-2 space-y-1">
                  {item.matchedTasks.slice(0, 3).map((task) => (
                    <div key={`${item.name}-${task.id}`} className="text-[11px] text-foreground/80 truncate">
                      {task.title} · {STATUS_LABEL[task.status]}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">从 AI 报告导入或新增整改任务后，系统会按常见问题库自动匹配问题类型、建议口径和闭环要求。</p>
        )}
      </Card>

      {!tasks.length ? (
        <EmptyState icon={ListTodo} title="暂无整改任务" hint="可手动新增，或从最近一份 AI 报告导入建议" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {STATUS_COLS.map(col => (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.key)}
              className="rounded-xl border border-border/60 bg-muted/30 p-3 min-h-[400px]"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusPill tone={col.tone}>{col.label}</StatusPill>
                  <span className="text-xs text-muted-foreground">{grouped[col.key].length}</span>
                </div>
              </div>
              <div className="space-y-2">
                {grouped[col.key].map(t => {
                  const overdue = t.status !== "done" && t.due_date && new Date(t.due_date) < new Date();
                  return (
                    <div
                      key={t.id}
                      draggable={planStatus !== "finalized"}
                      onDragStart={() => setDragId(t.id)}
                      className={`rounded-lg border border-border/60 bg-background p-3 transition-colors group ${
                        planStatus === "finalized" ? "cursor-default" : "cursor-grab active:cursor-grabbing hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <StatusPill tone={PRIORITY_META[t.priority].tone}>{PRIORITY_META[t.priority].label}</StatusPill>
                            <span className="text-[10px] text-muted-foreground font-mono">{t.category}</span>
                            {t.source === "ai_report" && <span className="text-[10px] text-primary">AI</span>}
                          </div>
                          <div className="text-sm font-medium mt-1 line-clamp-2">{t.title}</div>
                          {t.detail && <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{t.detail}</div>}
                          <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
                            <span>{t.responsible || "未指派"}</span>
                            {t.due_date && (
                              <span className={`flex items-center gap-1 ${overdue ? "text-destructive font-medium" : ""}`}>
                                <CalendarClock className="h-3 w-3" />{t.due_date}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Select value={t.status} onValueChange={(v: RTask["status"]) => updateStatus(t, v)} disabled={planStatus === "finalized"}>
                              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {STATUS_COLS.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeTask(t)} disabled={planStatus === "finalized"}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog />
    </div>
  );
};

export default Rectifications;

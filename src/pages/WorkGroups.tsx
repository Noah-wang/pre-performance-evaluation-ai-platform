import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { format, differenceInCalendarDays, parseISO, max as dMax, min as dMin } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Users, ListChecks, AlertTriangle, CheckCircle2, FolderOpen, Sparkles, CalendarDays, FileDown, FileText, Pencil, BarChart3, BookUser } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, EmptyState, SectionHeader, StatTile } from "@/components/ui-kit";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EvaluationPlanPanel } from "@/components/EvaluationPlanPanel";
import { MonthCalendar } from "@/components/MonthCalendar";
import { useConfirm } from "@/hooks/useConfirm";
import { useIsMobile } from "@/hooks/use-mobile";

interface Project {
  id: string; name: string;
  unit?: string | null; budget?: number | null;
  category?: string | null; description?: string | null;
  evaluation_system_id?: string | null;
}
interface WorkGroup { id: string; project_id: string; name: string; leader: string | null; formed_on: string; notes: string | null; }
interface Member { id: string; group_id: string; member_name: string; member_role: string; organization: string | null; contact: string | null; }
interface Task { id: string; group_id: string; title: string; assignee: string | null; start_date: string; end_date: string; completed_on: string | null; status: string; notes: string | null; }

const ROLE_META: Record<string, { label: string; tone: "info" | "neutral" | "gold" }> = {
  leader: { label: "组长", tone: "info" },
  member: { label: "成员", tone: "neutral" },
  expert: { label: "专家", tone: "gold" },
};
const STATUS_META: Record<string, { label: string; tone: "neutral" | "accent" | "success" }> = {
  todo: { label: "待办", tone: "neutral" },
  doing: { label: "进行中", tone: "accent" },
  done: { label: "已完成", tone: "success" },
};

const memberContact = (member: Member, fallbackEmail?: string | null) =>
  member.contact?.trim() || fallbackEmail || "—";

const DUE_SOON_DAYS = 3;

const groupSchema = z.object({
  project_id: z.string().uuid("请选择项目"),
  name: z.string().trim().min(1, "组名必填").max(100),
  leader: z.string().trim().max(50).optional(),
  formed_on: z.string().min(1, "组建日期必填"),
  notes: z.string().trim().max(500).optional(),
});
const memberSchema = z.object({
  member_name: z.string().trim().min(1, "姓名必填").max(50),
  member_role: z.enum(["leader", "member", "expert"]),
  organization: z.string().trim().max(200).optional(),
  contact: z.string().trim().max(100).optional(),
});
const taskSchema = z.object({
  title: z.string().trim().min(1, "任务名称必填").max(200),
  assignee: z.string().trim().max(50).optional(),
  start_date: z.string().min(1, "开始日期必填"),
  end_date: z.string().min(1, "结束日期必填"),
  status: z.enum(["todo", "doing", "done"]),
  notes: z.string().trim().max(500).optional(),
}).refine((d) => d.end_date >= d.start_date, { message: "结束日期不能早于开始日期", path: ["end_date"] });

const WorkGroups = () => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<WorkGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  const [gOpen, setGOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);
  const [tOpen, setTOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<WorkGroup | null>(null);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const [gForm, setGForm] = useState({ project_id: "", name: "", leader: "", formed_on: format(new Date(), "yyyy-MM-dd"), notes: "" });
  const [mForm, setMForm] = useState({ member_name: "", member_role: "member" as "leader" | "member" | "expert", organization: "", contact: "" });
  const [tForm, setTForm] = useState({ title: "", assignee: "", start_date: format(new Date(), "yyyy-MM-dd"), end_date: format(new Date(), "yyyy-MM-dd"), status: "todo" as "todo" | "doing" | "done", notes: "" });

  const { confirm, ConfirmDialog } = useConfirm();
  const loadAll = async () => {
    const [p, g, m, t] = await Promise.all([
      supabase.from("projects").select("id,name,unit,budget,category,description,evaluation_system_id").order("created_at", { ascending: false }),
      supabase.from("work_groups").select("*").order("created_at", { ascending: false }),
      supabase.from("work_group_members").select("*").order("created_at", { ascending: true }),
      supabase.from("work_tasks").select("*").order("start_date", { ascending: true }),
    ]);
    setProjects((p.data as Project[]) ?? []);
    const gs = (g.data as WorkGroup[]) ?? [];
    setGroups(gs);
    setMembers((m.data as Member[]) ?? []);
    setTasks((t.data as Task[]) ?? []);
    if (!activeId && gs.length) setActiveId(gs[0].id);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  const active = groups.find((g) => g.id === activeId);
  const activeMembers = members.filter((m) => m.group_id === activeId);
  const activeTasks = tasks.filter((t) => t.group_id === activeId);
  const activeProject = projects.find((p) => p.id === active?.project_id);

  const submitGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = groupSchema.safeParse(gForm);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    let data, error;
    if (editGroup) {
      ({ data, error } = await supabase.from("work_groups")
        .update(parsed.data as any)
        .eq("id", editGroup.id)
        .select().single());
    } else {
      ({ data, error } = await supabase.from("work_groups")
        .insert({ ...parsed.data, created_by: user.id } as any)
        .select().single());
    }
    if (error) return toast.error(error.message);
    toast.success(editGroup ? "工作组已更新" : "工作组已创建");
    setGOpen(false);
    setEditGroup(null);
    setGForm({ project_id: "", name: "", leader: "", formed_on: format(new Date(), "yyyy-MM-dd"), notes: "" });
    setActiveId(data.id);
    loadAll();
  };

  const openEditGroup = (group: WorkGroup) => {
    setEditGroup(group);
    setGForm({
      project_id: group.project_id,
      name: group.name,
      leader: group.leader ?? "",
      formed_on: group.formed_on,
      notes: group.notes ?? "",
    });
    setGOpen(true);
  };

  const delGroup = async (id: string) => {
    if (!(await confirm({ title: "确认删除该工作组？", description: "该工作组下的所有成员、任务、关联评估方案将一并删除，此操作不可撤销。", destructive: true, confirmText: "删除工作组" }))) return;
    const { error } = await supabase.from("work_groups").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("已删除"); if (activeId === id) setActiveId(""); loadAll(); }
  };

  const openAddMember = () => {
    setEditMember(null);
    setMForm({ member_name: "", member_role: "member", organization: "", contact: "" });
    setMOpen(true);
  };
  const openEditMember = (m: Member) => {
    setEditMember(m);
    setMForm({
      member_name: m.member_name,
      member_role: (m.member_role as any) ?? "member",
      organization: m.organization ?? "",
      contact: m.contact ?? "",
    });
    setMOpen(true);
  };
  const submitMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeId) return;
    const parsed = memberSchema.safeParse(mForm);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    let error;
    if (editMember) {
      ({ error } = await supabase.from("work_group_members").update(parsed.data as any).eq("id", editMember.id));
    } else {
      ({ error } = await supabase.from("work_group_members")
        .insert({ ...parsed.data, group_id: activeId, created_by: user.id } as any));
    }
    if (error) return toast.error(error.message);
    toast.success(editMember ? "成员已更新" : "成员已添加");
    setMOpen(false);
    setEditMember(null);
    setMForm({ member_name: "", member_role: "member", organization: "", contact: "" });
    loadAll();
  };
  const delMember = async (id: string) => {
    const { error } = await supabase.from("work_group_members").delete().eq("id", id);
    if (error) toast.error(error.message); else loadAll();
  };

  const openAddTask = () => {
    setEditTask(null);
    setTForm({ title: "", assignee: "", start_date: format(new Date(), "yyyy-MM-dd"), end_date: format(new Date(), "yyyy-MM-dd"), status: "todo", notes: "" });
    setTOpen(true);
  };
  const openEditTask = (t: Task) => {
    setEditTask(t);
    setTForm({
      title: t.title,
      assignee: t.assignee ?? "",
      start_date: t.start_date,
      end_date: t.end_date,
      status: (t.status as any) ?? "todo",
      notes: t.notes ?? "",
    });
    setTOpen(true);
  };
  const submitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeId) return;
    const parsed = taskSchema.safeParse(tForm);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    const payload: any = { ...parsed.data };
    if (parsed.data.status === "done") payload.completed_on = format(new Date(), "yyyy-MM-dd");
    else payload.completed_on = null;
    let error;
    if (editTask) {
      ({ error } = await supabase.from("work_tasks").update(payload).eq("id", editTask.id));
    } else {
      payload.group_id = activeId;
      payload.created_by = user.id;
      ({ error } = await supabase.from("work_tasks").insert(payload));
    }
    if (error) return toast.error(error.message);
    toast.success(editTask ? "任务已更新" : "任务已添加");
    setTOpen(false);
    setEditTask(null);
    setTForm({ title: "", assignee: "", start_date: format(new Date(), "yyyy-MM-dd"), end_date: format(new Date(), "yyyy-MM-dd"), status: "todo", notes: "" });
    loadAll();
  };
  const delTask = async (id: string) => {
    const { error } = await supabase.from("work_tasks").delete().eq("id", id);
    if (error) toast.error(error.message); else loadAll();
  };
  const toggleTaskDone = async (t: Task) => {
    const next = t.status === "done" ? "doing" : "done";
    const { error } = await supabase.from("work_tasks").update({
      status: next,
      completed_on: next === "done" ? format(new Date(), "yyyy-MM-dd") : null,
    }).eq("id", t.id);
    if (error) toast.error(error.message); else loadAll();
  };

  const gantt = useMemo(() => {
    if (!activeTasks.length) return null;
    const dates = activeTasks.flatMap((t) => [parseISO(t.start_date), parseISO(t.end_date)]);
    const start = dMin(dates);
    const end = dMax(dates);
    const total = Math.max(differenceInCalendarDays(end, start) + 1, 1);
    const today = new Date();
    const todayOffset = differenceInCalendarDays(today, start);
    const todayPct = todayOffset >= 0 && todayOffset <= total ? (todayOffset / total) * 100 : null;
    return { start, end, total, todayPct };
  }, [activeTasks]);

  const todayStart = new Date(new Date().toDateString());
  const isOverdue = (t: Task) => t.status !== "done" && parseISO(t.end_date) < todayStart;
  const isDueSoon = (t: Task) => {
    if (t.status === "done") return false;
    const end = parseISO(t.end_date);
    if (end < todayStart) return false;
    return differenceInCalendarDays(end, todayStart) <= DUE_SOON_DAYS;
  };
  const overdueCount = activeTasks.filter(isOverdue).length;
  const dueSoonCount = activeTasks.filter(isDueSoon).length;
  const allOverdueCount = tasks.filter(isOverdue).length;
  const allDueSoonCount = tasks.filter(isDueSoon).length;

  const groupOverview = useMemo(() => groups.map((group) => {
    const project = projects.find((item) => item.id === group.project_id);
    const groupTasks = tasks.filter((task) => task.group_id === group.id);
    const total = groupTasks.length;
    const done = groupTasks.filter((task) => task.status === "done").length;
    const overdue = groupTasks.filter(isOverdue).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      id: group.id,
      name: group.name,
      projectName: project?.name ?? "—",
      leader: group.leader ?? "—",
      taskCount: total,
      doneCount: done,
      overdueCount: overdue,
      progress,
    };
  }), [groups, projects, tasks]);

  const memberLoadRows = useMemo(() => {
    const rows = new Map<string, {
      key: string;
      name: string;
      organization: string;
      roles: Set<string>;
      groups: Set<string>;
      taskCount: number;
      activeTaskCount: number;
      overdueTaskCount: number;
    }>();
    members.forEach((member) => {
      const key = `${member.member_name}::${member.organization ?? ""}`;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          name: member.member_name,
          organization: member.organization ?? "—",
          roles: new Set<string>(),
          groups: new Set<string>(),
          taskCount: 0,
          activeTaskCount: 0,
          overdueTaskCount: 0,
        });
      }
      const entry = rows.get(key)!;
      entry.roles.add(member.member_role);
      entry.groups.add(groups.find((group) => group.id === member.group_id)?.name ?? "—");
    });
    tasks.forEach((task) => {
      if (!task.assignee) return;
      const matches = Array.from(rows.values()).filter((row) => row.name === task.assignee);
      matches.forEach((row) => {
        row.taskCount += 1;
        if (task.status !== "done") row.activeTaskCount += 1;
        if (isOverdue(task)) row.overdueTaskCount += 1;
      });
    });
    return Array.from(rows.values())
      .map((row) => ({
        ...row,
        roleLabel: Array.from(row.roles).map((role) => ROLE_META[role]?.label ?? role).join(" / "),
        groupLabel: Array.from(row.groups).join("、"),
      }))
      .sort((a, b) => b.activeTaskCount - a.activeTaskCount || b.taskCount - a.taskCount || a.name.localeCompare(b.name, "zh-Hans-CN"));
  }, [groups, members, tasks]);

  const loadSuggestions = useMemo(() => {
    if (memberLoadRows.length === 0) return [];
    const avgActive = memberLoadRows.reduce((sum, row) => sum + row.activeTaskCount, 0) / memberLoadRows.length;
    const result: string[] = [];
    memberLoadRows.forEach((row) => {
      if (row.activeTaskCount >= Math.max(3, Math.ceil(avgActive + 1))) {
        result.push(`建议优先为 ${row.name} 分流任务，当前在办 ${row.activeTaskCount} 项。`);
      } else if (row.activeTaskCount === 0 && row.taskCount === 0) {
        result.push(`可优先补充给 ${row.name} 新任务，目前尚未承担具体任务。`);
      }
      if (row.overdueTaskCount > 0) {
        result.push(`${row.name} 名下有 ${row.overdueTaskCount} 项超期任务，建议本周优先跟踪。`);
      }
    });
    return result.slice(0, 4);
  }, [memberLoadRows]);

  const priorityTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status !== "done")
      .map((task) => {
        const group = groups.find((item) => item.id === task.group_id);
        const project = group ? projects.find((item) => item.id === group.project_id) : null;
        return {
          ...task,
          groupName: group?.name ?? "未关联工作组",
          projectName: project?.name ?? "—",
          isOverdue: isOverdue(task),
          isDueSoon: isDueSoon(task),
        };
      })
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isDueSoon !== b.isDueSoon) return a.isDueSoon ? -1 : 1;
        return parseISO(a.end_date).getTime() - parseISO(b.end_date).getTime();
      })
      .slice(0, 4);
  }, [groups, projects, tasks]);

  return (
    <>
      <PageHeader
        eyebrow="PHASE I · 02 · 工作组"
        title="工作组与方案"
        subtitle="组建评估工作组 · 安排时间计划 · 超期自动预警"
        actions={
          <Dialog
            open={gOpen}
            onOpenChange={(o) => {
              setGOpen(o);
              if (!o) {
                setEditGroup(null);
                setGForm({ project_id: "", name: "", leader: "", formed_on: format(new Date(), "yyyy-MM-dd"), notes: "" });
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="hero" disabled={!projects.length}>
                <Plus className="h-4 w-4" /> 新建工作组
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-xl">{editGroup ? "编辑工作组" : "新建工作组"}</DialogTitle></DialogHeader>
              <form onSubmit={submitGroup} className="space-y-3">
                <div>
                  <Label>所属评估项目 *</Label>
                  <Select value={gForm.project_id} onValueChange={(v) => setGForm({ ...gForm, project_id: v })}>
                    <SelectTrigger><SelectValue placeholder="请选择项目…" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>组名 *</Label><Input value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} placeholder="例如：智慧安防项目评估工作组" required maxLength={100} /></div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><Label>组长</Label><Input value={gForm.leader} onChange={(e) => setGForm({ ...gForm, leader: e.target.value })} maxLength={50} /></div>
                  <div><Label>组建日期 *</Label><Input type="date" value={gForm.formed_on} onChange={(e) => setGForm({ ...gForm, formed_on: e.target.value })} required /></div>
                </div>
                <div><Label>备注</Label><Textarea rows={3} value={gForm.notes} onChange={(e) => setGForm({ ...gForm, notes: e.target.value })} maxLength={500} /></div>
                <DialogFooter><Button type="submit" variant="hero">{editGroup ? "更 新" : "保 存"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <EditPermissionNotice />

      {!projects.length && (
        <Card className="surface-card p-0 mb-6">
          <EmptyState
            icon={FolderOpen}
            title="尚未创建评估项目"
            hint="请先在『评估对象管理』中创建项目，然后回到此页面组建工作组"
          />
        </Card>
      )}

      <div className="mb-5 space-y-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="PARALLEL GROUPS" value={groups.length.toString().padStart(2, "0")} hint="并行评估工作组" icon={Users} tone="info" />
          <StatTile label="PARALLEL PROJECTS" value={new Set(groups.map((group) => group.project_id)).size.toString().padStart(2, "0")} hint="同步推进项目" icon={FolderOpen} tone="gold" />
          <StatTile label="OVERDUE TASKS" value={allOverdueCount.toString().padStart(2, "0")} hint="全部超期任务" icon={AlertTriangle} tone={allOverdueCount > 0 ? "danger" : "success"} />
          <StatTile label="DUE SOON" value={allDueSoonCount.toString().padStart(2, "0")} hint={`${DUE_SOON_DAYS} 天内到期`} icon={CalendarDays} tone={allDueSoonCount > 0 ? "warning" : "info"} />
          <StatTile label="ACTIVE MEMBERS" value={memberLoadRows.length.toString().padStart(2, "0")} hint="已纳入工作成员" icon={ListChecks} tone="success" />
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr] items-start">
          <Card className="surface-card">
            <CardContent className="p-4">
              <SectionHeader eyebrow="GLOBAL OVERVIEW · 全局总览" title="项目并行推进情况" count={groupOverview.length} icon={BarChart3} />
              {groupOverview.length === 0 ? (
                <div className="text-sm text-muted-foreground py-5 text-center">暂无工作组推进数据</div>
              ) : (
                <div className="grid max-h-[300px] gap-2 overflow-auto pr-1 sm:grid-cols-2">
                    {groupOverview.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border bg-card/60 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{item.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{item.projectName}</div>
                          </div>
                          <StatusPill tone={item.overdueCount > 0 ? "danger" : item.progress >= 70 ? "success" : "accent"} dot={false}>
                            {item.progress}%
                          </StatusPill>
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={item.overdueCount > 0 ? "h-full bg-destructive" : "h-full bg-accent"} style={{ width: `${item.progress}%` }} />
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono text-muted-foreground">
                          <span>任务 {item.taskCount}</span>
                          <span>完成 {item.doneCount}</span>
                          <span>超期 {item.overdueCount}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-card">
            <CardContent className="p-4">
              <SectionHeader eyebrow="LOAD BALANCE · 负载均衡" title="成员任务负载建议" count={memberLoadRows.length} icon={ListChecks} />
              {loadSuggestions.length > 0 && (
                <div className="mb-3 max-h-[72px] overflow-auto rounded-md border border-gold/30 bg-gold/8 p-2.5 text-xs leading-relaxed space-y-1">
                  {loadSuggestions.map((item, index) => (
                    <div key={`${item}-${index}`}>{item}</div>
                  ))}
                </div>
              )}
              {memberLoadRows.length === 0 ? (
                <div className="text-sm text-muted-foreground py-5 text-center">暂无成员负载数据</div>
              ) : (
                <div className="max-h-[168px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>成员</TableHead>
                        <TableHead>角色</TableHead>
                        <TableHead className="text-right">在办</TableHead>
                        <TableHead className="text-right">超期</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memberLoadRows.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[180px]">{row.groupLabel}</div>
                          </TableCell>
                          <TableCell>{row.roleLabel}</TableCell>
                          <TableCell className="text-right font-mono">{row.activeTaskCount}</TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={row.overdueTaskCount > 0 ? "text-destructive" : ""}>{row.overdueTaskCount}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_1fr]">
        {/* 左：工作组列表 */}
        <Card className="surface-card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">WORK GROUPS</div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">[{groups.length.toString().padStart(2, "0")}]</span>
          </div>
          <div className="divide-y divide-border max-h-[640px] overflow-auto">
            {groups.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">暂无工作组</div>
            ) : groups.map((g) => {
              const proj = projects.find((p) => p.id === g.project_id);
              const gTasks = tasks.filter((t) => t.group_id === g.id);
              const od = gTasks.filter((t) => t.status !== "done" && parseISO(t.end_date) < new Date(new Date().toDateString())).length;
              const isActive = activeId === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setActiveId(g.id)}
                  className={`group relative w-full text-left p-4 transition-all ${
                    isActive ? "bg-accent/8" : "hover:bg-accent/4"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-display font-semibold text-sm truncate ${isActive ? "text-accent" : "text-foreground"}`}>
                      {g.name}
                    </span>
                    {od > 0 && <StatusPill tone="danger" dot={false}>{od}超期</StatusPill>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">{proj?.name ?? "—"}</div>
                  <div className="text-[11px] font-mono text-muted-foreground/70 mt-1 tabular-nums">
                    {g.leader ?? "—"} · {g.formed_on}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 右：详情 */}
        <div className="space-y-6">
          {!active ? (
            <Card className="surface-card p-0">
              <EmptyState
                icon={Users}
                title="请选择工作组"
                hint="在左侧列表中选择一个工作组查看详情，或创建新的工作组"
              />
            </Card>
          ) : (
            <>
              <Card className="surface-card">
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="section-eyebrow mb-2">{activeProject?.name ?? "—"}</div>
                      <h3 className="font-display text-2xl font-bold text-foreground tracking-tight">{active.name}</h3>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground">
                        <span>组长 <span className="text-foreground">{active.leader ?? "—"}</span></span>
                        <span>·</span>
                        <span>组建于 <span className="text-foreground tabular-nums">{active.formed_on}</span></span>
                      </div>
                      {active.notes && <div className="text-sm text-foreground/80 mt-3 leading-relaxed">{active.notes}</div>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button variant="ghost" size="icon" onClick={() => openEditGroup(active)} className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!active || !activeProject) return;
                          const t = toast.loading("正在生成评估小组备案表 PDF…");
                          try {
                            const { downloadGroupRosterPdf } = await import("@/lib/groupRosterPdf");
                            await downloadGroupRosterPdf({
                              projectName: activeProject.name,
                              projectUnit: activeProject.unit,
                              groupName: active.name,
                              groupLeader: active.leader,
                              formedOn: active.formed_on,
                              notes: active.notes,
                              members: activeMembers,
                              tasks: activeTasks,
                            });
                            toast.success("评估小组备案表 PDF 已下载", { id: t });
                          } catch (e: any) {
                            toast.error("导出失败：" + (e?.message ?? ""), { id: t });
                          }
                        }}
                      >
                        <FileDown className="h-4 w-4" /> 导出评估小组备案表
                      </Button>
                      <Button
                        variant="hero"
                        size="sm"
                        onClick={async () => {
                          if (!active || !activeProject) return;
                          const { exportWorkPlan } = await import("@/lib/docxExport");
                          // 拉取该项目的方案正文（如果有）
                          const { data: plan } = await supabase
                            .from("evaluation_plans")
                            .select("content")
                            .eq("project_id", active.project_id)
                            .order("created_at", { ascending: false })
                            .limit(1).maybeSingle();
                          await exportWorkPlan({
                            projectName: activeProject.name,
                            unit: activeProject.unit,
                            groupName: active.name,
                            leader: active.leader ?? "",
                            members: activeMembers.map(m => ({
                              name: m.member_name, role: m.member_role,
                              org: m.organization ?? undefined, contact: memberContact(m, user?.email),
                            })),
                            tasks: activeTasks.map(t => ({
                              title: t.title, assignee: t.assignee ?? undefined,
                              start: t.start_date, end: t.end_date, status: t.status, notes: t.notes ?? undefined,
                            })),
                            planContent: (plan as any)?.content,
                            watermark: `${user?.email ?? ""} · ${new Date().toLocaleDateString("zh-CN")} · 内部评审`,
                          });
                          toast.success("已按附件 3 导出工作方案 Word");
                        }}
                      >
                        <FileText className="h-4 w-4" /> 工作方案 Word（附件 3）
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => delGroup(active.id)} className="h-8 w-8">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {(overdueCount > 0 || dueSoonCount > 0) && (
                    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                      {overdueCount > 0 && (
                        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1">
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                          <span className="text-sm font-medium text-destructive">已超期 {overdueCount} 项</span>
                        </div>
                      )}
                      {dueSoonCount > 0 && (
                        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1">
                          <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                          <span className="text-sm font-medium text-warning">临期 {dueSoonCount} 项（{DUE_SOON_DAYS} 天内）</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Tabs defaultValue="members" className="w-full">
                <TabsList className="flex h-auto w-full max-w-3xl flex-wrap justify-start">
                  <TabsTrigger value="members"><Users className="h-3.5 w-3.5 mr-1.5" />成员</TabsTrigger>
                  <TabsTrigger value="gantt"><ListChecks className="h-3.5 w-3.5 mr-1.5" />甘特</TabsTrigger>
                  <TabsTrigger value="calendar"><CalendarDays className="h-3.5 w-3.5 mr-1.5" />月历</TabsTrigger>
                  <TabsTrigger value="plan"><Sparkles className="h-3.5 w-3.5 mr-1.5" />方案·在线编辑</TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="mt-4">
                  {/* 成员 */}
                  <Card className="surface-card">
                    <CardContent className="p-6">
                      <SectionHeader
                        eyebrow="MEMBERS · 工作组成员"
                        title="成员名单"
                        count={activeMembers.length}
                        icon={Users}
                        actions={
                          <Button
                            size="sm"
                            variant="hero"
                            disabled={!activeProject}
                            onClick={() => {
                              const params = new URLSearchParams({
                                projectId: active.project_id,
                                groupId: active.id,
                                pick: "smart",
                              });
                              navigate(`/experts?${params.toString()}`);
                            }}
                          >
                            <BookUser className="h-4 w-4" /> 去专家库抽取
                          </Button>
                        }
                      />
                      <div className="mb-4 rounded-lg border border-accent/25 bg-accent/5 p-4 text-sm text-muted-foreground">
                        <div className="font-medium text-foreground">专家抽取统一在“专家库管理”完成</div>
                        <div className="mt-1">
                          点击上方按钮进入专家库，完成智能或人工抽取后，专家会自动保存回当前工作组成员名单。
                        </div>
                      </div>
                      {activeMembers.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-8 text-center">暂无成员，请前往专家库抽取专家</div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {activeMembers.map((m) => {
                            const meta = ROLE_META[m.member_role];
                            return (
                              <div key={m.id} className="group rounded-lg border border-border bg-gradient-to-br from-card to-muted/30 p-3 hover:border-accent/40 transition-all cursor-pointer" onClick={() => openEditMember(m)}>
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-display font-semibold text-foreground truncate">{m.member_name}</span>
                                  <div className="flex items-center gap-1">
                                    <StatusPill tone={meta.tone} dot={false}>{meta.label}</StatusPill>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditMember(m); }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                      title="编辑成员"
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-accent" />
                                    </button>
                                  </div>
                                </div>
                                <div className="text-xs text-muted-foreground mt-1 truncate">{m.organization ?? "—"}</div>
                                <div className="flex items-center justify-between mt-1 gap-2">
                                  <span className="text-xs font-mono text-muted-foreground/80 truncate">{memberContact(m, user?.email)}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); delMember(m.id); }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="gantt" className="mt-4">
                  {/* 甘特 */}
                  <Card className="surface-card">
                    <CardContent className="p-6">
                      <SectionHeader
                        eyebrow="GANTT · 任务计划"
                        title="任务甘特视图"
                        count={activeTasks.length}
                        icon={ListChecks}
                        actions={
                          <Button size="sm" variant="outline" onClick={openAddTask}>
                            <Plus className="h-4 w-4" /> 添加任务
                          </Button>
                        }
                      />

                      {activeTasks.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-12 text-center">暂无任务，请添加时间计划</div>
                      ) : (
                        <div className="space-y-2">
                          {isMobile ? (
                            <div className="space-y-3">
                              {activeTasks.map((t) => {
                                const overdue = isOverdue(t);
                                const dueSoon = !overdue && isDueSoon(t);
                                const done = t.status === "done";
                                const meta = STATUS_META[t.status];
                                return (
                                  <div
                                    key={t.id}
                                    className={`rounded-lg border p-3 ${
                                      overdue
                                        ? "border-destructive/30 bg-destructive/5"
                                        : dueSoon
                                          ? "border-warning/30 bg-warning/5"
                                          : "border-border bg-card/60"
                                    }`}
                                    onClick={() => openEditTask(t)}
                                  >
                                    <div className="flex items-start gap-2">
                                      <button onClick={(e) => { e.stopPropagation(); toggleTaskDone(t); }} className="shrink-0">
                                        <CheckCircle2 className={`h-4 w-4 transition-colors ${done ? "text-success" : "text-muted-foreground hover:text-accent"}`} />
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <div className={`text-sm font-medium break-words ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</div>
                                        <div className="mt-1 text-xs text-muted-foreground">{t.assignee || "未分配"}</div>
                                      </div>
                                      <StatusPill tone={meta.tone} dot={false}>{meta.label}</StatusPill>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                      <span>{t.start_date}</span>
                                      <span>至</span>
                                      <span>{t.end_date}</span>
                                      {overdue && <StatusPill tone="danger" dot={false}>已超期</StatusPill>}
                                      {dueSoon && <StatusPill tone="warning" dot={false}>临期</StatusPill>}
                                    </div>
                                    <div className="mt-3 flex justify-end gap-2">
                                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEditTask(t); }}>
                                        <Pencil className="h-3.5 w-3.5" />编辑
                                      </Button>
                                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); delTask(t.id); }} className="text-destructive">
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />删除
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <>
                              {gantt && (
                                <div className="relative ml-[280px] mr-4 h-6 border-b border-border text-[11px] font-mono text-muted-foreground tabular-nums">
                                  <span className="absolute left-0 top-0">{format(gantt.start, "yyyy-MM-dd")}</span>
                                  <span className="absolute right-0 top-0">{format(gantt.end, "yyyy-MM-dd")}</span>
                                  <span className="absolute left-1/2 -translate-x-1/2 top-0">共 {gantt.total} 天</span>
                                  {gantt.todayPct !== null && (
                                    <div className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: `${gantt.todayPct}%` }}>
                                      <span className="absolute -top-4 -translate-x-1/2 text-[10px] text-accent font-bold">今</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {activeTasks.map((t) => {
                                const overdue = isOverdue(t);
                                const dueSoon = !overdue && isDueSoon(t);
                                const done = t.status === "done";
                                const meta = STATUS_META[t.status];
                                let leftPct = 0, widthPct = 100;
                                if (gantt) {
                                  const ts = parseISO(t.start_date);
                                  const te = parseISO(t.end_date);
                                  leftPct = (differenceInCalendarDays(ts, gantt.start) / gantt.total) * 100;
                                  widthPct = Math.max(((differenceInCalendarDays(te, ts) + 1) / gantt.total) * 100, 1.5);
                                }
                                const barColor = done ? "bg-success" : overdue ? "bg-destructive" : dueSoon ? "bg-warning" : t.status === "doing" ? "bg-accent" : "bg-gold";
                                return (
                                  <div key={t.id} className={`group flex items-center gap-3 py-2 px-1 rounded-md transition-colors cursor-pointer ${overdue ? "bg-destructive/5" : dueSoon ? "bg-warning/5" : "hover:bg-accent/5"}`} onClick={() => openEditTask(t)}>
                                    <div className="w-[270px] shrink-0 pr-4 border-r border-border">
                                      <div className="flex items-center gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); toggleTaskDone(t); }} className="shrink-0">
                                          <CheckCircle2 className={`h-4 w-4 transition-colors ${done ? "text-success" : "text-muted-foreground hover:text-accent"}`} />
                                        </button>
                                        <span className={`font-medium text-sm truncate ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>{t.title}</span>
                                        {overdue && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                                        {dueSoon && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />}
                                      </div>
                                      <div className="text-[11px] font-mono text-muted-foreground mt-1 ml-6 flex items-center gap-1.5 tabular-nums">
                                        {t.assignee && <span>{t.assignee}</span>}
                                        <StatusPill tone={meta.tone} dot={false} className="!py-0 !px-1.5">{meta.label}</StatusPill>
                                        {dueSoon && <StatusPill tone="warning" dot={false} className="!py-0 !px-1.5">临期</StatusPill>}
                                        <span>{t.start_date}→{t.end_date}</span>
                                      </div>
                                    </div>
                                    <div className="flex-1 relative h-8">
                                      <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px bg-border" />
                                      <div
                                        className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md ${barColor} shadow-sm flex items-center px-2`}
                                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: "12px" }}
                                        title={`${t.start_date} → ${t.end_date}`}
                                      >
                                        <span className="text-[10px] text-primary-foreground font-medium font-mono truncate tabular-nums">
                                          {differenceInCalendarDays(parseISO(t.end_date), parseISO(t.start_date)) + 1}d
                                        </span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openEditTask(t); }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                                      title="编辑任务"
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-accent" />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); delTask(t.id); }} className="opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </button>
                                  </div>
                                );
                              })}

                              <div className="pt-4 mt-2 border-t border-border flex flex-wrap gap-4 text-[11px] font-mono text-muted-foreground">
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-gold rounded-sm" /> 待办</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-accent rounded-sm" /> 进行中</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-success rounded-sm" /> 已完成</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-warning rounded-sm" /> 临期（3天内）</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-destructive rounded-sm" /> 超期</span>
                                <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-accent" /> 今日</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="calendar" className="mt-4">
                  <Card className="surface-card">
                    <CardContent className="p-6">
                      <SectionHeader
                        eyebrow="CALENDAR · 月历视图"
                        title="任务月历"
                        count={activeTasks.length}
                        icon={CalendarDays}
                      />
                      {activeTasks.length === 0 ? (
                        <div className="text-sm text-muted-foreground py-12 text-center">
                          暂无任务，月历视图将在添加任务后显示
                        </div>
                      ) : (
                        <MonthCalendar
                          tasks={activeTasks}
                          onTaskClick={(t) => toast.info(t.title, {
                            description: `${t.start_date} → ${t.end_date}${t.assignee ? ` · ${t.assignee}` : ""}`,
                          })}
                        />
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="plan" className="mt-4">
                  {activeProject ? (
                    <div className="space-y-4">
                      <div className="rounded-md border border-accent/25 bg-accent/5 px-4 py-3 text-sm text-muted-foreground">
                        当前页支持工作方案在线编辑。进入方案卡片后，点击右上角“在线编辑”即可直接修改内容，保存后还能继续导出 Word。
                      </div>
                      <EvaluationPlanPanel
                        project={activeProject}
                        group={active}
                        members={activeMembers}
                        tasks={activeTasks}
                      />
                    </div>
                  ) : (
                    <Card className="surface-card p-0">
                      <EmptyState icon={Sparkles} title="项目信息缺失" hint="无法生成方案：请先确认本工作组关联的项目仍存在" />
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog />

      {/* 成员对话框（新增/编辑） */}
      <Dialog open={mOpen} onOpenChange={(o) => { setMOpen(o); if (!o) setEditMember(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-xl">{editMember ? "编辑成员" : "添加成员"}</DialogTitle></DialogHeader>
          <form onSubmit={submitMember} className="space-y-3">
            <div><Label>姓名 *</Label><Input value={mForm.member_name} onChange={(e) => setMForm({ ...mForm, member_name: e.target.value })} required maxLength={50} /></div>
            <div>
              <Label>角色 *</Label>
              <Select value={mForm.member_role} onValueChange={(v: any) => setMForm({ ...mForm, member_role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="leader">组长</SelectItem>
                  <SelectItem value="member">成员</SelectItem>
                  <SelectItem value="expert">专家</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>所属单位</Label><Input value={mForm.organization} onChange={(e) => setMForm({ ...mForm, organization: e.target.value })} maxLength={200} /></div>
            <div>
              <Label>联系方式（建议填写登录邮箱）</Label>
              <Input
                value={mForm.contact}
                onChange={(e) => setMForm({ ...mForm, contact: e.target.value })}
                placeholder="例如：name@example.com / 13800000000"
                maxLength={100}
              />
              <p className="mt-1 text-xs text-muted-foreground">填写成员登录邮箱后，系统可自动识别该成员可见的项目范围。</p>
            </div>
            <DialogFooter><Button type="submit" variant="hero">{editMember ? "更 新" : "保 存"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 任务对话框（新增/编辑） */}
      <Dialog open={tOpen} onOpenChange={(o) => { setTOpen(o); if (!o) setEditTask(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-xl">{editTask ? "编辑任务" : "添加任务"}</DialogTitle></DialogHeader>
          <form onSubmit={submitTask} className="space-y-3">
            <div><Label>任务名称 *</Label><Input value={tForm.title} onChange={(e) => setTForm({ ...tForm, title: e.target.value })} required maxLength={200} /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>负责人</Label><Input value={tForm.assignee} onChange={(e) => setTForm({ ...tForm, assignee: e.target.value })} maxLength={50} /></div>
              <div>
                <Label>状态</Label>
                <Select value={tForm.status} onValueChange={(v: any) => setTForm({ ...tForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">待办</SelectItem>
                    <SelectItem value="doing">进行中</SelectItem>
                    <SelectItem value="done">已完成</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label>开始日期 *</Label><Input type="date" value={tForm.start_date} onChange={(e) => setTForm({ ...tForm, start_date: e.target.value })} required /></div>
              <div><Label>结束日期 *</Label><Input type="date" value={tForm.end_date} onChange={(e) => setTForm({ ...tForm, end_date: e.target.value })} required /></div>
            </div>
            <div><Label>备注</Label><Textarea rows={2} value={tForm.notes} onChange={(e) => setTForm({ ...tForm, notes: e.target.value })} maxLength={500} /></div>
            <DialogFooter><Button type="submit" variant="hero">{editTask ? "更 新" : "保 存"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WorkGroups;

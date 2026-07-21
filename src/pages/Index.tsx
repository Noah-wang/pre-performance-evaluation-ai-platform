import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { WorkflowDiagram } from "@/components/WorkflowDiagram";
import { supabase } from "@/integrations/supabase/client";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  FolderKanban,
  BookUser,
  FileText,
  TrendingUp,
  ArrowUpRight,
  ListTodo,
  AlertTriangle,
  GitBranch,
  Sparkles,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from "recharts";
import { addDays, startOfMonth, endOfMonth, formatISO } from "date-fns";

const STATUS_LABELS: Record<string, string> = {
  preparing: "筹备",
  in_progress: "评估中",
  reviewing: "评审中",
  completed: "已完成",
  archived: "已归档",
};

const STATUS_COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--gold))", "hsl(var(--success))", "hsl(var(--muted-foreground))"];

const Index = () => {
  const isMobile = useIsMobile();
  const [stats, setStats] = useState({ projects: 0, experts: 0, reports: 0 });
  const [monthTasks, setMonthTasks] = useState({ total: 0, done: 0, pending: 0 });
  const [warnings, setWarnings] = useState({ overdue: 0, dueSoon: 0, missing: 0 });
  const [funnel, setFunnel] = useState<{ name: string; value: number }[]>([]);
  const [aiStats, setAiStats] = useState({ plans: 0, reports: 0, analyses: 0, total: 0 });
  const [budget, setBudget] = useState({ total: 0, count: 0 });
  const [conclusions, setConclusions] = useState({ support: 0, partial: 0, reject: 0, pending: 0 });

  useEffect(() => {
    (async () => {
      const today = new Date();
      const monthStart = formatISO(startOfMonth(today), { representation: "date" });
      const monthEnd = formatISO(endOfMonth(today), { representation: "date" });
      const todayStr = formatISO(today, { representation: "date" });
      const in7Days = formatISO(addDays(today, 7), { representation: "date" });

      const [
        { count: pCount },
        expertsRes,
        { count: rCount },
        { data: tasksMonth },
        { data: tasksOverdue },
        { data: tasksDueSoon },
        { count: missingMaterials },
        { data: allProjects },
        { count: planCount },
        { count: reportCount },
        { count: analysisCount },
      ] = await Promise.all([
        supabase.from("projects").select("*", { count: "exact", head: true }),
        supabase.rpc("get_experts_public"),
        supabase.from("reports").select("*", { count: "exact", head: true }),
        supabase
          .from("work_tasks")
          .select("id,status")
          .gte("end_date", monthStart)
          .lte("end_date", monthEnd),
        supabase
          .from("work_tasks")
          .select("id")
          .lt("end_date", todayStr)
          .neq("status", "done"),
        supabase
          .from("work_tasks")
          .select("id")
          .gte("end_date", todayStr)
          .lte("end_date", in7Days)
          .neq("status", "done"),
        supabase
          .from("materials")
          .select("*", { count: "exact", head: true })
          .eq("status", "missing"),
        supabase.from("projects").select("status,budget,conclusion"),
        supabase.from("evaluation_plans").select("*", { count: "exact", head: true }),
        supabase.from("reports").select("*", { count: "exact", head: true }),
        supabase.from("meeting_analyses").select("*", { count: "exact", head: true }),
      ]);

      setStats({ projects: pCount ?? 0, experts: expertsRes.data?.length ?? 0, reports: rCount ?? 0 });

      const total = tasksMonth?.length ?? 0;
      const done = tasksMonth?.filter((t) => t.status === "done").length ?? 0;
      setMonthTasks({ total, done, pending: total - done });

      setWarnings({
        overdue: tasksOverdue?.length ?? 0,
        dueSoon: tasksDueSoon?.length ?? 0,
        missing: missingMaterials ?? 0,
      });

      const counts: Record<string, number> = {};
      Object.keys(STATUS_LABELS).forEach((k) => (counts[k] = 0));
      (allProjects ?? []).forEach((p: any) => {
        if (p.status in counts) counts[p.status] += 1;
        else counts[p.status] = (counts[p.status] ?? 0) + 1;
      });
      setFunnel(
        Object.entries(STATUS_LABELS).map(([k, label]) => ({ name: label, value: counts[k] ?? 0 })),
      );

      const projList = (allProjects ?? []) as any[];
      const totalBudget = projList.reduce((s, p) => s + Number(p.budget || 0), 0);
      setBudget({ total: totalBudget, count: projList.length });
      const c = { support: 0, partial: 0, reject: 0, pending: 0 };
      projList.forEach((p) => {
        if (p.conclusion === "予以支持") c.support++;
        else if (p.conclusion === "部分支持") c.partial++;
        else if (p.conclusion === "不予支持") c.reject++;
        else c.pending++;
      });
      setConclusions(c);

      const p = planCount ?? 0;
      const r = reportCount ?? 0;
      const a = analysisCount ?? 0;
      setAiStats({ plans: p, reports: r, analyses: a, total: p + r + a });
    })();
  }, []);

  const cards = [
    {
      label: "在评项目",
      en: "Active Projects",
      value: stats.projects,
      icon: FolderKanban,
      hint: "评估对象总数",
      gradient: "from-cyan/10 to-accent/5",
      iconBg: "bg-gradient-cyan",
    },
    {
      label: "专家库人数",
      en: "Expert Pool",
      value: stats.experts,
      icon: BookUser,
      hint: "在册评审专家",
      gradient: "from-gold/10 to-warning/5",
      iconBg: "bg-gradient-gold",
    },
    {
      label: "评估报告",
      en: "Reports",
      value: stats.reports,
      icon: FileText,
      hint: "已生成报告",
      gradient: "from-primary/10 to-navy/5",
      iconBg: "bg-gradient-hero",
    },
  ];

  const totalWarnings = warnings.overdue + warnings.dueSoon + warnings.missing;
  const monthDoneRate = monthTasks.total > 0 ? Math.round((monthTasks.done / monthTasks.total) * 100) : 0;
  const funnelMax = Math.max(...funnel.map((item) => item.value), 1);

  return (
    <>
      <PageHeader
        eyebrow="DASHBOARD · 工作台"
        title="全流程绩效评估"
        subtitle="资政惠民 · 数字化事前绩效评估管理平台 — 覆盖三阶段十环节，AI 辅助报告生成与专家智能抽取"
      />

      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c, i) => (
          <Card
            key={c.label}
            className="surface-card group cursor-default animate-fade-in-up"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <CardContent className="p-6 relative overflow-hidden">
              <div
                className={`absolute -right-8 -top-8 w-32 h-32 rounded-full bg-gradient-to-br ${c.gradient} blur-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-500`}
              />
              <div className="relative flex items-start justify-between">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                    {c.en}
                  </div>
                  <div className="mt-2 font-display text-4xl font-bold leading-none tabular-nums text-foreground sm:text-5xl">
                    {c.value.toString().padStart(2, "0")}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{c.label}</span>
                    <span className="text-xs text-muted-foreground">· {c.hint}</span>
                  </div>
                </div>
                <div
                  className={`w-12 h-12 grid place-items-center rounded-xl ${c.iconBg} text-primary-foreground shadow-md group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}
                >
                  <c.icon className="h-5 w-5" />
                </div>
              </div>
              <div className="relative mt-5 pt-4 border-t border-border/60 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-success">
                  <TrendingUp className="h-3 w-3" /> Live
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 数据化四联卡 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {/* 1. 本月待办任务 */}
        <Link to="/work-groups" className="block group">
          <Card className="surface-card h-full animate-fade-in-up" style={{ animationDelay: "240ms" }}>
            <CardContent className="p-5 relative overflow-hidden h-full flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                    Monthly Tasks
                  </div>
                  <div className="text-sm font-medium text-foreground mt-1">本月待办任务</div>
                </div>
                <div className="w-10 h-10 grid place-items-center rounded-lg bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                  <ListTodo className="h-4 w-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold tabular-nums text-foreground">
                  {monthTasks.pending}
                </span>
                <span className="text-xs text-muted-foreground">/ {monthTasks.total} 总数</span>
              </div>
              <div className="mt-auto pt-3">
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-success to-primary transition-all duration-700"
                    style={{ width: `${monthDoneRate}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>已完成 {monthTasks.done}</span>
                  <span className="text-success">{monthDoneRate}%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* 2. 临期预警 */}
        <Link to="/work-groups" className="block group">
          <Card className="surface-card h-full animate-fade-in-up" style={{ animationDelay: "320ms" }}>
            <CardContent className="p-5 relative overflow-hidden h-full flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                    Warnings
                  </div>
                  <div className="text-sm font-medium text-foreground mt-1">临期与缺失预警</div>
                </div>
                <div
                  className={`w-10 h-10 grid place-items-center rounded-lg group-hover:scale-110 transition-transform ${
                    totalWarnings > 0
                      ? "bg-destructive/10 text-destructive animate-pulse"
                      : "bg-success/10 text-success"
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold tabular-nums text-foreground">
                  {totalWarnings}
                </span>
                <span className="text-xs text-muted-foreground">项需关注</span>
              </div>
              <div className="mt-auto pt-3 grid grid-cols-3 gap-1.5 text-[10px] font-mono">
                <div className="rounded-md bg-destructive/10 text-destructive p-1.5 text-center">
                  <div className="font-bold text-sm tabular-nums">{warnings.overdue}</div>
                  <div className="opacity-80">逾期</div>
                </div>
                <div className="rounded-md bg-warning/10 text-warning p-1.5 text-center">
                  <div className="font-bold text-sm tabular-nums">{warnings.dueSoon}</div>
                  <div className="opacity-80">7日内</div>
                </div>
                <div className="rounded-md bg-muted text-muted-foreground p-1.5 text-center">
                  <div className="font-bold text-sm tabular-nums">{warnings.missing}</div>
                  <div className="opacity-80">缺资料</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* 3. 项目阶段漏斗 */}
        <Card className="surface-card animate-fade-in-up md:col-span-2 xl:col-span-1" style={{ animationDelay: "400ms" }}>
          <CardContent className="p-5 relative overflow-hidden h-full flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Project Funnel
                </div>
                <div className="text-sm font-medium text-foreground mt-1">各阶段项目分布</div>
              </div>
              <div className="w-10 h-10 grid place-items-center rounded-lg bg-accent/10 text-accent">
                <GitBranch className="h-4 w-4" />
              </div>
            </div>
            {isMobile ? (
              <div className="mt-1 space-y-2.5">
                {funnel.map((item, i) => (
                  <div key={item.name} className="rounded-lg border border-border/60 bg-card/50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: STATUS_COLORS[i % STATUS_COLORS.length] }}
                        />
                        <span className="truncate text-sm text-foreground">{item.name}</span>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-muted-foreground">{item.value}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(item.value / funnelMax) * 100}%`,
                          backgroundColor: STATUS_COLORS[i % STATUS_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 min-h-[110px] -mx-2 -mb-1">
                <ResponsiveContainer width="100%" height={110}>
                  <BarChart data={funnel} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {funnel.map((_, i) => (
                        <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. AI 调用统计 */}
        <Card className="surface-card animate-fade-in-up" style={{ animationDelay: "480ms" }}>
          <CardContent className="p-5 relative overflow-hidden h-full flex flex-col">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  AI Invocations
                </div>
                <div className="text-sm font-medium text-foreground mt-1">AI 累计调用</div>
              </div>
              <div className="w-10 h-10 grid place-items-center rounded-lg bg-gradient-to-br from-accent to-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tabular-nums text-foreground">
                {aiStats.total}
              </span>
              <span className="text-xs text-muted-foreground">次</span>
            </div>
            <div className="mt-auto pt-3 space-y-1.5 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">评估方案</span>
                <span className="tabular-nums text-foreground">{aiStats.plans}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">评估报告</span>
                <span className="tabular-nums text-foreground">{aiStats.reports}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">会议分析</span>
                <span className="tabular-nums text-foreground">{aiStats.analyses}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 财务与结论 KPI */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <Card className="surface-card animate-fade-in-up" style={{ animationDelay: "560ms" }}>
          <CardContent className="p-5 flex flex-col h-full">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Total Budget</div>
                <div className="text-sm font-medium text-foreground mt-1">在评项目预算总额</div>
              </div>
              <div className="w-10 h-10 grid place-items-center rounded-lg bg-gradient-to-br from-gold to-warning text-primary-foreground">
                <Wallet className="h-4 w-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold tabular-nums text-foreground sm:text-4xl">
                ¥{(budget.total / 10000).toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">万元 · {budget.count} 个项目</span>
            </div>
            <div className="mt-auto pt-3 text-[11px] font-mono text-muted-foreground break-words">
              户均预算 ¥{budget.count > 0 ? (budget.total / budget.count / 10000).toFixed(2) : "0.00"} 万
            </div>
          </CardContent>
        </Card>

        <Card className="surface-card animate-fade-in-up" style={{ animationDelay: "640ms" }}>
          <CardContent className="p-5 flex flex-col h-full">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">Conclusions</div>
                <div className="text-sm font-medium text-foreground mt-1">评估结论分布</div>
              </div>
              <div className="w-10 h-10 grid place-items-center rounded-lg bg-success/10 text-success">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              {[
                { label: "予以支持", value: conclusions.support, cls: "bg-success/10 text-success" },
                { label: "部分支持", value: conclusions.partial, cls: "bg-warning/10 text-warning" },
                { label: "不予支持", value: conclusions.reject, cls: "bg-destructive/10 text-destructive" },
                { label: "待结论", value: conclusions.pending, cls: "bg-muted text-muted-foreground" },
              ].map((it) => (
                <div key={it.label} className={`rounded-md p-2 ${it.cls}`}>
                  <div className="font-display text-2xl font-bold tabular-nums">{it.value}</div>
                  <div className="text-[10px] mt-0.5">{it.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <WorkflowDiagram />
    </>
  );
};

export default Index;

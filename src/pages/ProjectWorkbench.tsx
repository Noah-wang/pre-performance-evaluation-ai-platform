import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusPill, StatTile, EmptyState } from "@/components/ui-kit";
import {
  ArrowLeft, ArrowRight, FolderKanban, Package, Building2, Coins, Users, FileSearch,
  ClipboardList, Award, FileText, Calendar, Sparkles, ExternalLink, Layers, BadgeDollarSign,
} from "lucide-react";
import { calcFee, formatYuan, normalizeFeeCalculation } from "@/lib/fee";
import { SmartMatchDialog } from "@/components/SmartMatchDialog";
import { CostAnalysisPanel } from "@/components/CostAnalysisPanel";
import { toast } from "sonner";

interface ProjectFull {
  id: string; name: string; unit: string; budget: number;
  category: string | null; description: string | null;
  status: string; fiscal_year: number;
  evaluation_system_id: string | null; package_id: string | null;
  budget_unit: string | null; manager: string | null;
  fee_calculation: unknown;
  custom_fields: unknown;
}

const STATUS_MAP: Record<string, { label: string; tone: "info" | "accent" | "success" | "neutral" }> = {
  preparing: { label: "准备中", tone: "info" },
  implementing: { label: "实施中", tone: "accent" },
  completed: { label: "已完成", tone: "success" },
  archived: { label: "已归档", tone: "neutral" },
};

const STATUS_ORDER = ["preparing", "implementing", "completed", "archived"];

interface TabCounts {
  materials: { total: number; missing: number };
  field: number;
  meetings: number;
  scores: { count: number; avg: number | null };
  reports: number;
  groups: number;
  systems: { name: string | null; indicators: number };
  pkgName: string | null;
}

const ProjectWorkbench = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [project, setProject] = useState<ProjectFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<TabCounts | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string>("");

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const { data: p, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (error || !p) {
      setLoading(false);
      toast.error("项目不存在或无权限访问");
      return;
    }
    setProject(p as any);

    const [mats, fr, mm, es, rep, gr, sys, pkg] = await Promise.all([
      supabase.from("materials").select("status", { count: "exact" }).eq("project_id", id),
      supabase.from("field_records").select("id", { count: "exact" }).eq("project_id", id),
      supabase.from("meeting_minutes").select("id", { count: "exact" }).eq("project_id", id),
      supabase.from("expert_scores").select("score,max_score").eq("project_id", id),
      supabase.from("reports").select("id", { count: "exact" }).eq("project_id", id),
      supabase.from("work_groups").select("id").eq("project_id", id),
      p.evaluation_system_id
        ? supabase.from("evaluation_systems").select("name,evaluation_indicators(count)").eq("id", p.evaluation_system_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      p.package_id
        ? supabase.from("evaluation_packages").select("name").eq("id", p.package_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    const matRows = (mats.data ?? []) as { status: string }[];
    const missing = matRows.filter((m) => m.status === "missing").length;
    const sc = (es.data ?? []) as { score: number; max_score: number }[];
    const totalMax = sc.reduce((s, x) => s + Number(x.max_score), 0);
    const totalScore = sc.reduce((s, x) => s + Number(x.score), 0);
    const avg = totalMax > 0 ? Math.round((totalScore / totalMax) * 10000) / 100 : null;
    const groups = (gr.data ?? []) as { id: string }[];
    if (!activeGroupId && groups.length) setActiveGroupId(groups[0].id);

    // indicators count via second query (nested aggregate not always returned)
    let indCount = 0;
    if (p.evaluation_system_id) {
      const { count } = await supabase.from("evaluation_indicators")
        .select("id", { count: "exact", head: true }).eq("system_id", p.evaluation_system_id);
      indCount = count ?? 0;
    }

    setCounts({
      materials: { total: mats.count ?? matRows.length, missing },
      field: fr.count ?? 0,
      meetings: mm.count ?? 0,
      scores: { count: sc.length, avg },
      reports: rep.count ?? 0,
      groups: groups.length,
      systems: { name: (sys.data as any)?.name ?? null, indicators: indCount },
      pkgName: (pkg.data as any)?.name ?? null,
    });

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const advance = async () => {
    if (!project) return;
    const idx = STATUS_ORDER.indexOf(project.status);
    if (idx < 0 || idx === STATUS_ORDER.length - 1) return;
    const next = STATUS_ORDER[idx + 1];
    const { error } = await supabase.from("projects").update({ status: next } as any).eq("id", project.id);
    if (error) return toast.error(error.message);
    toast.success(`已切换至「${STATUS_MAP[next]?.label}」`);
    load();
  };

  const fee = useMemo(() => {
    if (!project) return 0;
    return calcFee(project.budget, normalizeFeeCalculation(project.fee_calculation as any)).total;
  }, [project]);

  if (loading) return <div className="text-sm text-muted-foreground p-8">加载中…</div>;
  if (!project) return (
    <Card className="surface-card p-0">
      <EmptyState icon={FolderKanban} title="项目不存在" hint="可能已被删除或无权限访问"
        action={<Button variant="outline" onClick={() => nav("/projects")}><ArrowLeft className="h-4 w-4" />返回项目列表</Button>} />
    </Card>
  );

  const meta = STATUS_MAP[project.status] ?? { label: project.status, tone: "neutral" as const };
  const progress = ((STATUS_ORDER.indexOf(project.status) + 1) / STATUS_ORDER.length) * 100;
  const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(project.status) + 1];

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1">
            <Link to="/projects" className="hover:text-accent">评估对象</Link>
            <ArrowRight className="h-3 w-3" />
            <span className="text-foreground">{project.name}</span>
          </span> as any
        }
        title={project.name}
        subtitle={`${project.unit}${project.category ? ` · ${project.category}` : ""} · 财政年度 ${project.fiscal_year}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => nav("/projects")}>
              <ArrowLeft className="h-4 w-4" /> 返回列表
            </Button>
            {nextStatus && (
              <Button variant="hero" size="sm" onClick={advance}>
                推进至 {STATUS_MAP[nextStatus].label} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      {/* Project meta strip */}
      <Card className="surface-card mb-6">
        <CardContent className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_220px] gap-5 items-center">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">状态</div>
              <div className="mt-1 flex items-center gap-2">
                <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                {counts?.pkgName && (
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <Package className="h-3 w-3" />{counts.pkgName}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">预算 / 评估费</div>
              <div className="font-display text-xl font-bold text-foreground tabular-nums mt-1">
                {formatYuan(project.budget)}
                {fee > 0 && <span className="text-cyan text-sm ml-2">· 评估费 {formatYuan(fee)}</span>}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">负责人 / 预算单位</div>
              <div className="text-sm text-foreground mt-1 truncate">
                {project.manager ?? "—"}{project.budget_unit ? ` · ${project.budget_unit}` : ""}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">阶段进度</div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-gradient-to-r from-accent to-cyan" style={{ width: `${progress}%` }} />
              </div>
              <div className="text-[11px] font-mono text-muted-foreground mt-1 tabular-nums">{progress.toFixed(0)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI tiles */}
      {counts && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatTile label="MATERIALS" icon={FileSearch} tone={counts.materials.missing > 0 ? "warning" : "success"}
            value={`${counts.materials.total - counts.materials.missing}/${counts.materials.total || 0}`}
            hint={counts.materials.missing > 0 ? `${counts.materials.missing} 项缺失` : "已齐备"} />
          <StatTile label="FIELD VISITS" icon={ClipboardList} tone="info" value={String(counts.field).padStart(2, "0")} hint="现场调研记录" />
          <StatTile label="EXPERT SCORE" icon={Award} tone="gold"
            value={counts.scores.avg !== null ? `${counts.scores.avg}` : "—"}
            hint={`${counts.scores.count} 条打分`} />
          <StatTile label="REPORTS" icon={FileText} tone="accent" value={String(counts.reports).padStart(2, "0")} hint="报告版本" />
        </div>
      )}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4 md:grid-cols-8 max-w-5xl">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="materials">资料</TabsTrigger>
          <TabsTrigger value="cost">成本</TabsTrigger>
          <TabsTrigger value="indicators">指标</TabsTrigger>
          <TabsTrigger value="team">工作组</TabsTrigger>
          <TabsTrigger value="field">现场</TabsTrigger>
          <TabsTrigger value="scoring">打分</TabsTrigger>
          <TabsTrigger value="report">报告</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="surface-card">
            <CardContent className="p-6 space-y-4">
              <div>
                <div className="section-eyebrow mb-2">PROJECT BRIEF · 项目说明</div>
                <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-line">
                  {project.description || "（未填写说明）"}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 border-t border-border">
                <ModuleCard icon={Layers} title="评估指标体系"
                  desc={counts?.systems.name ?? "未关联"}
                  meta={counts?.systems.indicators ? `${counts.systems.indicators} 项指标` : "—"}
                  href="/evaluation-system" />
                <ModuleCard icon={Users} title="工作组与方案"
                  desc={counts ? `${counts.groups} 个工作组` : "—"}
                  meta="组员 · 任务 · 方案"
                  href="/work-groups" />
                <ModuleCard icon={Sparkles} title="专家智能匹配"
                  desc="基于专长 / 历史 / 回避自动推荐"
                  meta="点击立即匹配"
                  onClick={() => setSmartOpen(true)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="materials" className="mt-4">
          <ModuleTabPanel
            title="项目资料"
            icon={FileSearch}
            desc={counts ? `共 ${counts.materials.total} 项，${counts.materials.missing} 项待补齐` : ""}
            href="/materials"
          />
        </TabsContent>
        <TabsContent value="cost" className="mt-4">
          <CostAnalysisPanel project={project} onSaved={load} />
        </TabsContent>
        <TabsContent value="indicators" className="mt-4">
          <ModuleTabPanel
            title="评估指标体系"
            icon={Layers}
            desc={counts?.systems.name ? `已关联：${counts.systems.name} · ${counts.systems.indicators} 项指标` : "未关联体系，去配置"}
            href="/evaluation-system"
          />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <ModuleTabPanel
            title="工作组与任务计划"
            icon={Users}
            desc={counts ? `${counts.groups} 个工作组，可在内查看甘特、月历与方案` : ""}
            href="/work-groups"
            extra={
              <Button variant="hero" size="sm" onClick={() => setSmartOpen(true)}>
                <Sparkles className="h-4 w-4" /> 智能匹配专家
              </Button>
            }
          />
        </TabsContent>
        <TabsContent value="field" className="mt-4">
          <ModuleTabPanel
            title="现场调研记录"
            icon={ClipboardList}
            desc={counts ? `${counts.field} 条记录（含照片 · 录音 · 签名 · GPS）` : ""}
            href="/field-research"
          />
        </TabsContent>
        <TabsContent value="scoring" className="mt-4">
          <ModuleTabPanel
            title="专家打分"
            icon={Award}
            desc={counts ? `${counts.scores.count} 条打分${counts.scores.avg !== null ? ` · 平均 ${counts.scores.avg} 分` : ""}` : ""}
            href="/expert-scoring"
          />
        </TabsContent>
        <TabsContent value="report" className="mt-4">
          <ModuleTabPanel
            title="评估报告（AI）"
            icon={FileText}
            desc={counts ? `${counts.reports} 个报告版本，AI 自动引用专家打分汇总` : ""}
            href="/reports"
          />
        </TabsContent>
      </Tabs>

      <SmartMatchDialog
        open={smartOpen}
        onOpenChange={setSmartOpen}
        projectId={project.id}
        groupId={activeGroupId || undefined}
        onAdded={load}
      />
    </>
  );
};

const ModuleCard = ({ icon: Icon, title, desc, meta, href, onClick }: any) => {
  const inner = (
    <div className="rounded-lg border border-border p-4 hover:border-accent/40 hover:shadow-md transition-all cursor-pointer h-full">
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-accent" />
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="font-display font-semibold text-foreground mt-3">{title}</div>
      <div className="text-xs text-muted-foreground mt-1 truncate">{desc}</div>
      <div className="text-[11px] font-mono text-accent mt-2 tabular-nums">{meta}</div>
    </div>
  );
  if (onClick) return <button onClick={onClick} className="text-left">{inner}</button>;
  return <Link to={href}>{inner}</Link>;
};

const ModuleTabPanel = ({ title, icon: Icon, desc, href, extra }: any) => (
  <Card className="surface-card">
    <CardContent className="p-6 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-12 h-12 rounded-lg bg-accent/10 grid place-items-center text-accent border border-accent/20 shrink-0">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-lg font-bold text-foreground">{title}</div>
          <div className="text-sm text-muted-foreground mt-0.5">{desc}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <Link to={href}>
          <Button variant="outline" size="sm">
            进入模块 <ExternalLink className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </CardContent>
  </Card>
);

export default ProjectWorkbench;

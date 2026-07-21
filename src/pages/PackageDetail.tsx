import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Package, ArrowLeft, Download, Trash2, FolderKanban, Coins, Building2, Award,
  Search, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { StatusPill, StatTile, EmptyState, SectionHeader } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { getMissingReportColumn, REPORT_SUMMARY_SELECT, REPORT_SUMMARY_SELECT_FALLBACK } from "@/lib/reportSchemaCompat";

interface Pkg {
  id: string; code: string | null; name: string;
  fiscal_year: number; fiscal_dept: string | null;
  agent_org: string | null; manager: string | null; notes: string | null;
}
interface Project {
  id: string; name: string; unit: string;
  budget_unit: string | null; expense_dept: string | null; manager: string | null;
  budget: number; category: string | null;
  list_attribute: string | null; project_attribute: string | null;
  agent_org: string | null;
  description: string | null;
  status: string;
  fee_calculation: any;
}
interface Report {
  id: string;
  project_id: string;
  conclusion: string | null;
  unsupported_budget: number | null;
  supported_budget: number | null;
  summary_remark: string | null;
  created_at: string;
}

const LIST_ATTRS = ["政府购买服务", "重点建设", "公共服务"];
const PROJ_ATTRS = ["新增项目", "延续项目"];
type XlsxModule = typeof import("xlsx");

const safeFileName = (value: string) => value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
const conclusionTone = (value: string | null | undefined) =>
  value === "予以支持" ? "success" : value === "部分支持" ? "gold" : value === "不予支持" ? "danger" : "neutral";
const conclusionClassName = (value: string | null | undefined) =>
  value === "部分支持" ? "bg-amber-100 text-amber-900 border-amber-300" : undefined;

const PackageDetail = () => {
  const { id = "" } = useParams();
  const { confirm, ConfirmDialog } = useConfirm();
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [scoresMap, setScoresMap] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Record<string, Partial<Project>>>({});
  const [filters, setFilters] = useState({
    keyword: "",
    budgetUnit: "all",
    expenseDept: "all",
    listAttribute: "all",
    projectAttribute: "all",
    conclusion: "all",
  });

  const load = async () => {
    if (!id) {
      setPkg(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const reportPromise = supabase.from("reports")
        .select(REPORT_SUMMARY_SELECT)
        .order("created_at", { ascending: false });
      const [{ data: p }, { data: pj }, reportRes, { data: sc }] = await Promise.all([
        supabase.from("evaluation_packages").select("*").eq("id", id).single(),
        supabase.from("projects").select("*").eq("package_id", id),
        reportPromise,
        supabase.from("expert_scores").select("project_id,score,expert_name"),
      ]);
      let rp = reportRes.data as Report[] | null;
      if (reportRes.error && getMissingReportColumn(reportRes.error)) {
        const fallback = await supabase.from("reports")
          .select(REPORT_SUMMARY_SELECT_FALLBACK)
          .order("created_at", { ascending: false });
        rp = ((fallback.data as Array<Pick<Report, "id" | "project_id" | "conclusion" | "created_at">> | null) ?? []).map((item) => ({
          ...item,
          unsupported_budget: null,
          supported_budget: null,
          summary_remark: null,
        }));
      }
      setPkg((p as Pkg) ?? null);
      setProjects((pj as Project[]) ?? []);
      setReports((rp as Report[]) ?? []);
      const m: Record<string, Record<string, number>> = {};
      (sc as any[] | null)?.forEach(r => {
        m[r.project_id] ??= {};
        m[r.project_id][r.expert_name] = (m[r.project_id][r.expert_name] ?? 0) + Number(r.score);
      });
      const avg: Record<string, number> = {};
      Object.entries(m).forEach(([pid, byExp]) => {
        const vals = Object.values(byExp);
        avg[pid] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      });
      setScoresMap(avg);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const totalBudget = projects.reduce((s, p) => s + Number(p.budget || 0), 0);
  const completedCount = projects.filter(p => p.status === "completed" || p.status === "archived").length;
  const unitCount = useMemo(() => new Set(projects.map(p => p.budget_unit ?? p.unit)).size, [projects]);
  const avgScore = useMemo(() => {
    const vals = projects.map(p => scoresMap[p.id]).filter(Boolean);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [projects, scoresMap]);
  const latestReportMap = useMemo(() => {
    const map = new Map<string, Report>();
    reports.forEach((report) => {
      if (!map.has(report.project_id)) map.set(report.project_id, report);
    });
    return map;
  }, [reports]);

  const conclusionOf = (pid: string) =>
    latestReportMap.get(pid)?.conclusion ?? "";
  const unsupportedOf = (pid: string) => latestReportMap.get(pid)?.unsupported_budget ?? null;
  const supportedOf = (pid: string) => latestReportMap.get(pid)?.supported_budget ?? null;
  const remarkOf = (project: Project) =>
    latestReportMap.get(project.id)?.summary_remark?.trim() || project.description?.trim() || "";
  const toWan = (value: number | null | undefined) => value === null || value === undefined ? null : Number(value) / 10000;

  const filterOptions = useMemo(() => ({
    budgetUnits: Array.from(new Set(projects.map((p) => p.budget_unit ?? p.unit).filter(Boolean))).sort(),
    expenseDepts: Array.from(new Set(projects.map((p) => p.expense_dept).filter(Boolean) as string[])).sort(),
    listAttributes: Array.from(new Set(projects.map((p) => p.list_attribute).filter(Boolean) as string[])).sort(),
    projectAttributes: Array.from(new Set(projects.map((p) => p.project_attribute).filter(Boolean) as string[])).sort(),
  }), [projects]);

  const filteredProjects = useMemo(() => {
    const keyword = filters.keyword.trim().toLowerCase();
    return projects.filter((p) => {
      const conclusion = latestReportMap.get(p.id)?.conclusion ?? "未出结论";
      if (filters.budgetUnit !== "all" && (p.budget_unit ?? p.unit) !== filters.budgetUnit) return false;
      if (filters.expenseDept !== "all" && (p.expense_dept ?? "—") !== filters.expenseDept) return false;
      if (filters.listAttribute !== "all" && (p.list_attribute ?? "—") !== filters.listAttribute) return false;
      if (filters.projectAttribute !== "all" && (p.project_attribute ?? "—") !== filters.projectAttribute) return false;
      if (filters.conclusion !== "all" && conclusion !== filters.conclusion) return false;
      if (!keyword) return true;
      return [
        p.name,
        p.budget_unit,
        p.unit,
        p.expense_dept,
        p.manager,
        p.agent_org,
        p.list_attribute,
        p.project_attribute,
        p.category,
        conclusion,
      ].some((value) => (value ?? "").toLowerCase().includes(keyword));
    });
  }, [filters, latestReportMap, projects]);
  const displayProjects = useMemo(() => (
    [...filteredProjects].sort((a, b) => {
      const dept = (a.expense_dept ?? "").localeCompare(b.expense_dept ?? "", "zh-Hans-CN");
      if (dept !== 0) return dept;
      const unit = (a.budget_unit ?? a.unit ?? "").localeCompare(b.budget_unit ?? b.unit ?? "", "zh-Hans-CN");
      if (unit !== 0) return unit;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    })
  ), [filteredProjects]);

  const allFilteredSelected = filteredProjects.length > 0 && filteredProjects.every((p) => selected.has(p.id));

  const toggle = (pid: string) => {
    const s = new Set(selected);
    s.has(pid) ? s.delete(pid) : s.add(pid);
    setSelected(s);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    if (allFilteredSelected) {
      filteredProjects.forEach((p) => next.delete(p.id));
    } else {
      filteredProjects.forEach((p) => next.add(p.id));
    }
    setSelected(next);
  };

  const startEdit = (p: Project) => {
    setEditing((current) => ({ ...current, [p.id]: {
      name: p.name, budget_unit: p.budget_unit ?? "", expense_dept: p.expense_dept ?? "",
      manager: p.manager ?? "", agent_org: p.agent_org ?? "",
      list_attribute: p.list_attribute ?? "",
      project_attribute: p.project_attribute ?? "",
      budget: p.budget,
    }}));
  };
  const updateEditingField = (pid: string, patch: Partial<Project>) => {
    setEditing((current) => ({
      ...current,
      [pid]: {
        ...(current[pid] ?? {}),
        ...patch,
      },
    }));
  };
  const saveEdit = async (pid: string) => {
    const e = editing[pid];
    if (!e) return;
    const { error } = await supabase.from("projects").update({
      name: e.name,
      budget_unit: e.budget_unit || null,
      expense_dept: e.expense_dept || null,
      manager: e.manager || null,
      agent_org: e.agent_org || null,
      list_attribute: e.list_attribute || null,
      project_attribute: e.project_attribute || null,
      budget: Number(e.budget) || 0,
    }).eq("id", pid);
    if (error) return toast.error(error.message);
    setProjects((current) => current.map((project) => project.id === pid ? {
      ...project,
      name: e.name ?? project.name,
      budget_unit: e.budget_unit || null,
      expense_dept: e.expense_dept || null,
      manager: e.manager || null,
      agent_org: e.agent_org || null,
      list_attribute: e.list_attribute || null,
      project_attribute: e.project_attribute || null,
      budget: Number(e.budget) || 0,
    } : project));
    toast.success("已保存");
    const next = { ...editing }; delete next[pid]; setEditing(next);
    load();
  };
  const cancelEdit = (pid: string) => {
    const next = { ...editing }; delete next[pid]; setEditing(next);
  };

  const batchDelete = async () => {
    if (!selected.size) return;
    if (!(await confirm({
      title: `从包中移除 ${selected.size} 个项目？`,
      description: "项目本身将被删除（连同其资料、打分、报告关联）。此操作不可撤销。",
      destructive: true, confirmText: "删除项目",
    }))) return;
    const ids = Array.from(selected);
    const { error } = await supabase.from("projects").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`已删除 ${ids.length} 个项目`);
    setSelected(new Set()); load();
  };

  const buildSheet = (
    XLSX: XlsxModule,
    rows: any[][],
    options: {
      mergeAcross: number;
      headerRow: number;
      colWidths: number[];
      autofilterCols: string;
    },
  ) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: options.mergeAcross } },
    ];
    ws["!cols"] = options.colWidths.map((wch) => ({ wch }));
    ws["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? 24 : index === options.headerRow ? 20 : 18 }));
    ws["!autofilter"] = { ref: `A${options.headerRow + 1}:${options.autofilterCols}${options.headerRow + 1}` };
    return ws;
  };

  const exportExcel = async () => {
    const exportProjects = displayProjects.length ? displayProjects : [...projects].sort((a, b) => {
      const dept = (a.expense_dept ?? "").localeCompare(b.expense_dept ?? "", "zh-Hans-CN");
      if (dept !== 0) return dept;
      const unit = (a.budget_unit ?? a.unit ?? "").localeCompare(b.budget_unit ?? b.unit ?? "", "zh-Hans-CN");
      if (unit !== 0) return unit;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    if (!exportProjects.length) return toast.error("无数据可导出");
    const XLSX = await import("xlsx");
    const exportBudget = exportProjects.reduce((s, p) => s + Number(p.budget || 0), 0);
    const filterLabels = [
      filters.keyword.trim() ? `关键词-${filters.keyword.trim()}` : "",
      filters.budgetUnit !== "all" ? `预算单位-${filters.budgetUnit}` : "",
      filters.expenseDept !== "all" ? `支出科室-${filters.expenseDept}` : "",
      filters.listAttribute !== "all" ? `清单属性-${filters.listAttribute}` : "",
      filters.projectAttribute !== "all" ? `项目属性-${filters.projectAttribute}` : "",
      filters.conclusion !== "all" ? `评估结论-${filters.conclusion}` : "",
    ].filter(Boolean);
    const exportScope = filterLabels.length ? filterLabels.join("、") : "全部项目";
    const sheetHeaders = [
      "序号", "中介机构", "支出科室", "预算单位", "项目名称", "金额(万元)",
      "项目清单属性", "项目属性", "专管员", "评估得分", "评估结论",
      "不予支持部分预算(万元)", "支持金额(万元)", "备注",
    ];
    const sheetRows = exportProjects.map((p, i) => [
      i + 1, p.agent_org ?? "", p.expense_dept ?? "", p.budget_unit ?? p.unit,
      p.name, (Number(p.budget) / 10000).toFixed(2),
      p.list_attribute ?? "", p.project_attribute ?? "", p.manager ?? "",
      scoresMap[p.id] ? scoresMap[p.id].toFixed(2) : "—",
      conclusionOf(p.id) || "未出结论",
      toWan(unsupportedOf(p.id))?.toFixed(2) ?? "—",
      toWan(supportedOf(p.id))?.toFixed(2) ?? "—",
      remarkOf(p) || "",
    ]);
    sheetRows.push([
      "合计",
      "",
      "",
      "",
      "",
      (exportBudget / 10000).toFixed(2),
      "",
      "",
      "",
      "",
      "",
      (exportProjects.reduce((sum, p) => sum + Number(unsupportedOf(p.id) || 0), 0) / 10000).toFixed(2),
      (exportProjects.reduce((sum, p) => sum + Number(supportedOf(p.id) || 0), 0) / 10000).toFixed(2),
      "",
    ] as any);

    const wb = XLSX.utils.book_new();
    const sheet = buildSheet(XLSX, [
      [`${pkg?.fiscal_year ?? ""}年部门预算事前绩效评估项目总表`],
      [`评估包：${pkg?.name ?? ""}    导出范围：${exportScope}`],
      [`填报说明：本表与当前页面汇总表保持一致，金额单位为万元。`],
      [],
      sheetHeaders, ...sheetRows,
    ], {
      mergeAcross: 13,
      headerRow: 4,
      colWidths: [8, 14, 14, 18, 38, 12, 16, 14, 12, 12, 14, 18, 14, 30],
      autofilterCols: "N",
    });
    XLSX.utils.book_append_sheet(wb, sheet, "评估包项目总表");

    const fileName = safeFileName(`${pkg?.name ?? "评估包"}_${exportScope}_汇总导出.xlsx`);
    const { saveAs } = await import("file-saver");
    const workbookBytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([workbookBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, fileName);
    toast.success(`已导出 1 张汇总表（范围：${exportScope}）`);
  };

  if (loading) {
    return (
      <Card className="surface-card p-0">
        <EmptyState icon={Package} title="正在加载评估包详情" hint="正在读取评估包、项目和结论汇总" />
        <div className="p-6"><Link to="/packages"><Button variant="outline"><ArrowLeft className="h-4 w-4" />返回列表</Button></Link></div>
      </Card>
    );
  }

  if (!pkg) {
    return (
      <Card className="surface-card p-0">
        <EmptyState icon={Package} title="未找到该评估包" hint="请返回评估包列表重新选择" />
        <div className="p-6"><Link to="/packages"><Button variant="outline"><ArrowLeft className="h-4 w-4" />返回列表</Button></Link></div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`PHASE I · 00 · 评估包 · ${pkg.code ?? "包详情"}`}
        title={pkg.name}
        subtitle={`${pkg.fiscal_year} 年度 · ${pkg.fiscal_dept ?? "—"} · 中介 ${pkg.agent_org ?? "—"} · 专管员 ${pkg.manager ?? "—"}`}
        actions={
          <>
            <Link to="/packages"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4" />返回列表</Button></Link>
            <Button variant="hero" size="sm" onClick={exportExcel}><Download className="h-4 w-4" />导出汇总 Excel</Button>
          </>
        }
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatTile label="PROJECTS" value={projects.length.toString().padStart(2, "0")} hint="包内项目数" icon={FolderKanban} tone="info" />
        <StatTile label="UNITS" value={unitCount.toString().padStart(2, "0")} hint="涉及预算单位" icon={Building2} tone="gold" />
        <StatTile label="BUDGET" value={`¥${(totalBudget / 10000).toFixed(1)}万`} hint="累计预算" icon={Coins} tone="success" />
        <StatTile label="AVG SCORE" value={avgScore > 0 ? avgScore.toFixed(1) : "—"} hint={`已完成 ${completedCount}/${projects.length}`} icon={Award} tone="accent" />
      </div>

      <Card className="surface-card p-5 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <SectionHeader
            eyebrow="FILTER · 多单位多项目分类管理"
            title="按预算单位 / 项目类别 / 结论筛选汇总"
            icon={SlidersHorizontal}
            count={filteredProjects.length}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilters({
              keyword: "",
              budgetUnit: "all",
              expenseDept: "all",
              listAttribute: "all",
              projectAttribute: "all",
              conclusion: "all",
            })}
          >
            重置筛选
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          <div className="xl:col-span-2">
            <Label className="text-xs text-muted-foreground">关键词</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.keyword}
                onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                placeholder="项目名称 / 单位 / 专管员 / 结论"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">预算单位</Label>
            <Select value={filters.budgetUnit} onValueChange={(value) => setFilters({ ...filters, budgetUnit: value })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部单位</SelectItem>
                {filterOptions.budgetUnits.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">支出科室</Label>
            <Select value={filters.expenseDept} onValueChange={(value) => setFilters({ ...filters, expenseDept: value })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部科室</SelectItem>
                {filterOptions.expenseDepts.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">清单属性</Label>
            <Select value={filters.listAttribute} onValueChange={(value) => setFilters({ ...filters, listAttribute: value })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部清单属性</SelectItem>
                {filterOptions.listAttributes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">项目属性</Label>
            <Select value={filters.projectAttribute} onValueChange={(value) => setFilters({ ...filters, projectAttribute: value })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部项目属性</SelectItem>
                {filterOptions.projectAttributes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">评估结论</Label>
            <Select value={filters.conclusion} onValueChange={(value) => setFilters({ ...filters, conclusion: value })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部结论</SelectItem>
                <SelectItem value="予以支持">予以支持</SelectItem>
                <SelectItem value="部分支持">部分支持</SelectItem>
                <SelectItem value="不予支持">不予支持</SelectItem>
                <SelectItem value="未出结论">未出结论</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="surface-card overflow-hidden p-0 mb-6">
        <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <FolderKanban className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 truncate text-sm font-semibold text-foreground">
              评估包汇总表 · 基础信息 + 评估结果 · 评估包项目总表 · 可编辑/批量删除
              <span className="ml-2 font-mono text-[11px] font-normal tracking-[0.12em] text-muted-foreground">
                [{displayProjects.length.toString().padStart(2, "0")}]
              </span>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={batchDelete} disabled={!selected.size}>
            <Trash2 className="h-4 w-4 text-destructive" />删除选中（{selected.size}）
          </Button>
        </div>
        {displayProjects.length === 0 ? (
          <EmptyState icon={FolderKanban} title="本包暂无项目" hint="可在评估包列表使用『从 Excel 导入』" />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1720px] text-[13px] [&_th]:h-11 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:leading-none [&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-4 [&_td]:text-[13px] [&_td]:leading-5">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead className="w-14">序号</TableHead>
                  <TableHead className="min-w-[110px]">中介机构</TableHead>
                  <TableHead className="min-w-[110px]">支出科室</TableHead>
                  <TableHead className="min-w-[150px]">预算单位</TableHead>
                  <TableHead className="min-w-[220px]">项目名称</TableHead>
                  <TableHead className="min-w-[110px] text-right">金额(万)</TableHead>
                  <TableHead className="min-w-[130px]">清单属性</TableHead>
                  <TableHead className="min-w-[130px]">项目属性</TableHead>
                  <TableHead className="min-w-[100px]">专管员</TableHead>
                  <TableHead className="min-w-[100px] text-right">评估得分</TableHead>
                  <TableHead className="min-w-[110px]">评估结论</TableHead>
                  <TableHead className="min-w-[125px] text-right">不予支持(万)</TableHead>
                  <TableHead className="min-w-[125px] text-right">支持金额(万)</TableHead>
                  <TableHead className="min-w-[180px]">备注</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayProjects.map((p, i) => {
                  const isEditing = !!editing[p.id];
                  const e = editing[p.id] ?? {};
                  const score = scoresMap[p.id];
                  const concl = conclusionOf(p.id);
                  const unsupportedWan = toWan(unsupportedOf(p.id));
                  const supportedWan = toWan(supportedOf(p.id));
                  return (
                    <TableRow key={p.id} className={isEditing ? "[&>td]:py-2" : undefined}>
                      <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} /></TableCell>
                      <TableCell className="font-mono text-[13px]">{i + 1}</TableCell>
                      {isEditing ? (
                        <>
                          <TableCell className="min-w-[120px]"><Input value={e.agent_org as string ?? ""} onChange={ev => updateEditingField(p.id, { agent_org: ev.target.value })} className="h-8 min-w-[110px] px-2 py-1 text-[13px]" placeholder="-" /></TableCell>
                          <TableCell className="min-w-[120px]"><Input value={e.expense_dept as string ?? ""} onChange={ev => updateEditingField(p.id, { expense_dept: ev.target.value })} className="h-8 min-w-[110px] px-2 py-1 text-[13px]" placeholder="-" /></TableCell>
                          <TableCell className="min-w-[140px]"><Input value={e.budget_unit as string ?? ""} onChange={ev => updateEditingField(p.id, { budget_unit: ev.target.value })} className="h-8 min-w-[130px] px-2 py-1 text-[13px]" placeholder="-" /></TableCell>
                          <TableCell className="min-w-[220px]"><Input value={e.name as string ?? ""} onChange={ev => updateEditingField(p.id, { name: ev.target.value })} className="h-8 min-w-[210px] px-2 py-1 text-[13px]" /></TableCell>
                          <TableCell className="min-w-[110px]"><Input type="number" value={(Number(e.budget) || 0) / 10000} onChange={ev => updateEditingField(p.id, { budget: Number(ev.target.value) * 10000 })} className="h-8 min-w-[100px] px-2 py-1 text-right text-[13px]" /></TableCell>
                          <TableCell>
                            <Select value={(e.list_attribute as string) || "none"} onValueChange={v => updateEditingField(p.id, { list_attribute: v === "none" ? "" : v })}>
                              <SelectTrigger className="h-8 px-2 py-1 text-[13px]"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="none">—</SelectItem>{LIST_ATTRS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select value={(e.project_attribute as string) || "none"} onValueChange={v => updateEditingField(p.id, { project_attribute: v === "none" ? "" : v })}>
                              <SelectTrigger className="h-8 px-2 py-1 text-[13px]"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="none">—</SelectItem>{PROJ_ATTRS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="min-w-[110px]"><Input value={e.manager as string ?? ""} onChange={ev => updateEditingField(p.id, { manager: ev.target.value })} className="h-8 min-w-[100px] px-2 py-1 text-[13px]" placeholder="-" /></TableCell>
                          <TableCell className="text-right font-mono">{score ? score.toFixed(1) : "—"}</TableCell>
                          <TableCell>
                            {concl ? (
                              <StatusPill tone={conclusionTone(concl)} className={conclusionClassName(concl)} dot={false}>{concl}</StatusPill>
                            ) : <span className="text-[13px] text-muted-foreground">未出结论</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono">{unsupportedWan !== null ? unsupportedWan.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right font-mono">{supportedWan !== null ? supportedWan.toFixed(2) : "—"}</TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal break-words text-[13px] text-muted-foreground">{remarkOf(p) || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex flex-nowrap gap-1">
                              <Button size="sm" variant="hero" className="h-8 px-2 text-xs" onClick={() => saveEdit(p.id)}>保存</Button>
                              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => cancelEdit(p.id)}>取消</Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-[13px] text-muted-foreground">{p.agent_org ?? "—"}</TableCell>
                          <TableCell className="text-[13px]">{p.expense_dept ?? "—"}</TableCell>
                          <TableCell className="text-[13px]">{p.budget_unit ?? p.unit}</TableCell>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right font-mono">{(Number(p.budget) / 10000).toFixed(2)}</TableCell>
                          <TableCell>{p.list_attribute ? <StatusPill tone="info" dot={false}>{p.list_attribute}</StatusPill> : "—"}</TableCell>
                          <TableCell>{p.project_attribute ? <StatusPill tone="gold" dot={false}>{p.project_attribute}</StatusPill> : "—"}</TableCell>
                          <TableCell className="text-[13px]">{p.manager ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {score ? <span className={score >= 80 ? "text-success" : score >= 60 ? "text-gold" : "text-destructive"}>{score.toFixed(1)}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            {concl ? (
                              <StatusPill tone={conclusionTone(concl)} className={conclusionClassName(concl)} dot={false}>{concl}</StatusPill>
                            ) : <span className="text-[13px] text-muted-foreground">未出结论</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono">{unsupportedWan !== null ? unsupportedWan.toFixed(2) : "—"}</TableCell>
                          <TableCell className="text-right font-mono">{supportedWan !== null ? supportedWan.toFixed(2) : "—"}</TableCell>
                          <TableCell className="max-w-[220px] whitespace-normal break-words text-[13px] text-muted-foreground">{remarkOf(p) || "—"}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>编辑</Button>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      <ConfirmDialog />
    </>
  );
};

export default PackageDetail;

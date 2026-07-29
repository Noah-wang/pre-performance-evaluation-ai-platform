import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, ClipboardEdit, Upload, Download, FileSpreadsheet, Users2, FileText, Files } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, StatTile, EmptyState, SectionHeader } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { buildEconomicOpinion } from "@/lib/economicAnalysis";
import { safeStorageFileName } from "@/lib/storagePath";
import { downloadBlobFromUrl } from "@/lib/downloadFile";
import { parseExpertScoreSheetRows, ParsedExpertScoreSheet } from "@/lib/expertScoreSheet";

interface Project {
  id: string;
  name: string;
  evaluation_system_id: string | null;
  unit: string;
  budget: number;
  category: string | null;
  budget_unit: string | null;
  expense_dept: string | null;
  agent_org: string | null;
  custom_fields: unknown;
}
interface Indicator {
  id: string; system_id: string; parent_id: string | null;
  level: number; code: string | null; name: string; weight: number;
}
interface Score {
  id: string; project_id: string; indicator_id: string;
  expert_name: string; expert_type: string | null;
  score: number; max_score: number; deduct_reason: string | null;
}
interface Sheet {
  id: string; project_id: string; expert_name: string; expert_type: string | null;
  file_path: string; file_name: string | null; total_score: number | null;
  parsed_status: string; notes: string | null; created_at: string;
  parsed_payload?: unknown;
}

const ExpertScoring = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);

  // 在线打分
  const [scoreOpen, setScoreOpen] = useState(false);
  const [sForm, setSForm] = useState({
    expert_name: "", expert_type: "business" as "business" | "management" | "finance",
    rows: [] as { indicator_id: string; max_score: number | ""; score: number | ""; deduct_reason: string }[],
  });

  // 上传打分表
  const [upOpen, setUpOpen] = useState(false);
  const [upForm, setUpForm] = useState({
    expert_name: "", expert_type: "business" as "business" | "management" | "finance",
    total_score: "", file: null as File | null, notes: "",
  });
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({
    conclusion: "",
    groupLeader: "",
    supervisingDepartment: "",
    evaluationOrg: "北京市通州区财政局",
    thirdPartyOrg: "",
    comments: "",
  });

  const loadProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id,name,evaluation_system_id,unit,budget,category,budget_unit,expense_dept,agent_org,custom_fields")
      .order("created_at", { ascending: false });
    setProjects((data as Project[]) ?? []);
    if (!activeId && data && data.length) setActiveId(data[0].id);
  };

  const loadDetail = async (pid: string) => {
    const proj = projects.find(p => p.id === pid);
    if (proj?.evaluation_system_id) {
      const { data: ind } = await supabase.from("evaluation_indicators")
        .select("*").eq("system_id", proj.evaluation_system_id)
        .order("sort_order", { ascending: true });
      setIndicators((ind as Indicator[]) ?? []);
    } else {
      setIndicators([]);
    }
    const [{ data: sc }, { data: sh }] = await Promise.all([
      supabase.from("expert_scores").select("*").eq("project_id", pid),
      supabase.from("expert_score_sheets").select("*").eq("project_id", pid).order("created_at", { ascending: false }),
    ]);
    setScores((sc as Score[]) ?? []);
    setSheets((sh as Sheet[]) ?? []);
  };

  useEffect(() => { loadProjects(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (activeId) loadDetail(activeId); }, [activeId, projects.length]);

  const active = projects.find(p => p.id === activeId);
  const topIndicators = useMemo(() => indicators.filter(i => i.level === 1), [indicators]);
  // 计算每个指标的子树叶子集合，用于将叶子分汇总到一级
  const leavesOf = (id: string): Indicator[] => {
    const direct = indicators.filter(i => i.parent_id === id);
    if (!direct.length) return [{ ...(indicators.find(i => i.id === id)!) }];
    return direct.flatMap(c => leavesOf(c.id));
  };

  const openScoring = () => {
    if (!topIndicators.length) {
      toast.error("该项目未关联评估指标体系，请先到「评估对象管理」关联体系");
      return;
    }
    setSForm({
      expert_name: "", expert_type: "business",
      rows: topIndicators.map(i => ({
        indicator_id: i.id, max_score: Number(i.weight) || 0, score: 0, deduct_reason: "",
      })),
    });
    setScoreOpen(true);
  };

  const submitScores = async () => {
    if (!user || !activeId) return;
    if (!sForm.expert_name.trim()) return toast.error("请填写专家姓名");
    const payload = sForm.rows
      .filter(r => r.indicator_id)
      .map(r => ({
        project_id: activeId,
        indicator_id: r.indicator_id,
        expert_name: sForm.expert_name.trim(),
        expert_type: sForm.expert_type,
        score: Number(r.score) || 0,
        max_score: Number(r.max_score) || 0,
        deduct_reason: r.deduct_reason.trim() || null,
        created_by: user.id,
      }));
    // 用 upsert 行为：先删除该专家旧打分，再插入
    await supabase.from("expert_scores").delete()
      .eq("project_id", activeId).eq("expert_name", sForm.expert_name.trim());
    const { error } = await supabase.from("expert_scores").insert(payload as any);
    if (error) return toast.error(error.message);
    toast.success(`已录入 ${sForm.expert_name} 的打分（${payload.length} 项）`);
    setScoreOpen(false);
    loadDetail(activeId);
  };

  const delExpertScores = async (name: string) => {
    if (!(await confirm({ title: `删除"${name}"的全部打分？`, destructive: true, confirmText: "删除" }))) return;
    await supabase.from("expert_scores").delete()
      .eq("project_id", activeId).eq("expert_name", name);
    loadDetail(activeId);
  };

  // 上传打分表
  const uploadSheet = async () => {
    if (!user || !activeId) return;
    if (!upForm.expert_name.trim() || !upForm.file) return toast.error("请填写姓名并选择文件");
    try {
      const isExcel = /\.xlsx?$/i.test(upForm.file.name);
      let parsedSheet: ParsedExpertScoreSheet | null = null;
      if (isExcel) {
        if (!topIndicators.length) throw new Error("当前项目未关联一级指标，无法导入专家得分");
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await upForm.file.arrayBuffer(), { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const table = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", blankrows: false }) as unknown[][];
        parsedSheet = parseExpertScoreSheetRows(table, topIndicators);
      }

      const path = `${user.id}/${activeId}/${Date.now()}_${safeStorageFileName(upForm.file.name || "score-sheet")}`;
      const up = await supabase.storage.from("expert-sheets").upload(path, upForm.file);
      if (up.error) throw up.error;
      const totalScore = parsedSheet?.totalScore ?? (upForm.total_score ? Number(upForm.total_score) : null);
      const { data: sheetRecord, error } = await supabase.from("expert_score_sheets").insert({
        project_id: activeId,
        expert_name: upForm.expert_name.trim(),
        expert_type: upForm.expert_type,
        file_path: path,
        file_name: upForm.file.name,
        parsed_status: parsedSheet ? "parsed" : "pending",
        parsed_payload: parsedSheet ? parsedSheet.rows : null,
        total_score: totalScore,
        notes: upForm.notes.trim() || null,
        created_by: user.id,
      } as any).select("id").single();
      if (error) {
        await supabase.storage.from("expert-sheets").remove([path]);
        throw error;
      }

      if (parsedSheet) {
        const expertName = upForm.expert_name.trim();
        const { error: deleteError } = await supabase.from("expert_scores").delete()
          .eq("project_id", activeId).eq("expert_name", expertName);
        if (deleteError) {
          await supabase.from("expert_score_sheets").delete().eq("id", sheetRecord.id);
          await supabase.storage.from("expert-sheets").remove([path]);
          throw deleteError;
        }
        const scorePayload = parsedSheet.rows.map((row) => ({
          project_id: activeId,
          indicator_id: row.indicatorId,
          expert_name: expertName,
          expert_type: upForm.expert_type,
          score: row.score,
          max_score: row.maxScore,
          deduct_reason: row.deductReason || null,
          created_by: user.id,
        }));
        const { error: scoreError } = await supabase.from("expert_scores").insert(scorePayload as any);
        if (scoreError) {
          await supabase.from("expert_score_sheets").delete().eq("id", sheetRecord.id);
          await supabase.storage.from("expert-sheets").remove([path]);
          throw scoreError;
        }
      }

      toast.success(parsedSheet
        ? `打分表已导入，识别 ${parsedSheet.rows.length} 项得分，合计 ${parsedSheet.totalScore.toFixed(1)} 分`
        : "打分表已上传归档");
      setUpOpen(false);
      setUpForm({ expert_name: "", expert_type: "business", total_score: "", file: null, notes: "" });
      loadDetail(activeId);
    } catch (e: any) {
      toast.error(e?.message ?? "上传失败");
    }
  };

  const downloadSheet = async (s: Sheet) => {
    const { data } = await supabase.storage.from("expert-sheets").createSignedUrl(s.file_path, 600);
    if (!data?.signedUrl) return toast.error("下载链接生成失败");
    try {
      await downloadBlobFromUrl(data.signedUrl, s.file_name, "专家打分表");
    } catch (e: any) {
      toast.error(e?.message ?? "下载失败");
    }
  };

  const delSheet = async (s: Sheet) => {
    if (!(await confirm({ title: `删除"${s.expert_name}"的打分表？`, destructive: true, confirmText: "删除" }))) return;
    await supabase.storage.from("expert-sheets").remove([s.file_path]);
    await supabase.from("expert_score_sheets").delete().eq("id", s.id);
    if (s.parsed_status === "parsed" || Array.isArray(s.parsed_payload)) {
      await supabase.from("expert_scores").delete()
        .eq("project_id", activeId)
        .eq("expert_name", s.expert_name);
    }
    loadDetail(activeId);
  };

  // 汇总：优先读取一级指标直接得分，并兼容旧版按叶子指标保存的数据。
  const scoreRows = useMemo<Score[]>(() => {
    const merged = [...scores];
    const existing = new Set(scores.map((score) => `${score.expert_name}::${score.indicator_id}`));
    sheets.forEach((sheet) => {
      const payload = Array.isArray(sheet.parsed_payload)
        ? sheet.parsed_payload as Partial<ParsedExpertScoreSheet["rows"][number]>[]
        : [];
      payload.forEach((row) => {
        const indicatorId = String(row.indicatorId ?? "");
        if (!indicatorId || row.score === undefined || row.score === null) return;
        const key = `${sheet.expert_name}::${indicatorId}`;
        if (existing.has(key)) return;
        existing.add(key);
        merged.push({
          id: `sheet-${sheet.id}-${indicatorId}`,
          project_id: sheet.project_id,
          indicator_id: indicatorId,
          expert_name: sheet.expert_name,
          expert_type: sheet.expert_type,
          score: Number(row.score) || 0,
          max_score: Number(row.maxScore) || 0,
          deduct_reason: String(row.deductReason ?? "").trim() || null,
        });
      });
    });
    return merged;
  }, [scores, sheets]);
  const expertNames = useMemo(() => Array.from(new Set(scoreRows.map(s => s.expert_name))), [scoreRows]);
  const summary = useMemo(() => {
    return topIndicators.map(ind => {
      const leaves = leavesOf(ind.id);
      const leafIds = new Set(leaves.map(l => l.id));
      const indScores = scoreRows.filter(s => leafIds.has(s.indicator_id));
      const byExpert: Record<string, number> = {};
      const maxByExpert: Record<string, number> = {};
      expertNames.forEach(n => {
        const directScores = scoreRows.filter(s => s.expert_name === n && s.indicator_id === ind.id);
        const legacyScores = indScores.filter(s => s.expert_name === n);
        const usedScores = directScores.length ? directScores : legacyScores;
        if (usedScores.length) {
          byExpert[n] = usedScores.reduce((sum, item) => sum + Number(item.score), 0);
          maxByExpert[n] = usedScores.reduce((sum, item) => sum + Number(item.max_score), 0);
        }
      });
      const vals = Object.values(byExpert);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const maxVals = Object.values(maxByExpert);
      const maxScore = maxVals.length
        ? maxVals.reduce((sum, value) => sum + value, 0) / maxVals.length
        : Number(ind.weight) || 0;
      return { indicator: ind, avg, maxScore, byExpert };
    });
  }, [topIndicators, scoreRows, expertNames, indicators]);

  // 表格里每项平均分都按两位小数展示（8.666… 显示成 8.67）。合计若用原始值累加，
  // 就会出现"逐项相加 55.01、合计写 55.00"的对不上账。以显示值为准累加，
  // 保证表格自身可核对。
  const totalAvg = useMemo(
    () => summary.reduce((sum, row) => sum + Math.round(row.avg * 100) / 100, 0),
    [summary],
  );
  const scoredStats = useMemo(() => {
    const totals = new Map<string, number>();
    expertNames.forEach((name) => {
      totals.set(name, scoreRows.filter((score) => score.expert_name === name)
        .reduce((sum, item) => sum + Number(item.score), 0));
    });
    sheets.forEach((sheet) => {
      if (!totals.has(sheet.expert_name) && sheet.total_score !== null && Number.isFinite(Number(sheet.total_score))) {
        totals.set(sheet.expert_name, Number(sheet.total_score));
      }
    });
    const values = Array.from(totals.values());
    return {
      expertCount: totals.size,
      averageTotal: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    };
  }, [expertNames, scoreRows, sheets]);
  const totalPerExpert = useMemo(
    () => expertNames.map((name) => scoreRows.filter((s) => s.expert_name === name).reduce((sum, item) => sum + Number(item.score), 0)),
    [expertNames, scoreRows],
  );
  const inferredConclusion = useMemo(() => {
    const maxTotal = summary.reduce((sum, item) => sum + Number(item.maxScore), 0);
    if (!maxTotal) return "";
    if (totalAvg >= maxTotal * 0.85) return "予以支持";
    if (totalAvg >= maxTotal * 0.6) return "部分支持";
    return "不予支持";
  }, [summary, totalAvg]);

  useEffect(() => {
    if (!active) return;
    setGroupForm((prev) => ({
      ...prev,
      conclusion: prev.conclusion || inferredConclusion,
      supervisingDepartment: prev.supervisingDepartment || active.unit || active.budget_unit || "",
      thirdPartyOrg: prev.thirdPartyOrg || active.agent_org || "",
    }));
  }, [active, inferredConclusion]);

  const deductReasonSummary = useMemo(() => {
    const reasonMap = new Map<string, number>();
    scoreRows.forEach((score) => {
      const text = (score.deduct_reason ?? "").trim();
      if (!text) return;
      reasonMap.set(text, (reasonMap.get(text) ?? 0) + 1);
    });
    return Array.from(reasonMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([text, count]) => ({ text, count }));
  }, [scoreRows]);

  const weakestIndicators = useMemo(() => {
    return [...summary]
      .map((row) => {
        const max = Number(row.maxScore) || 0;
        const ratio = max > 0 ? row.avg / max : 0;
        return { ...row, ratio, gap: max - row.avg };
      })
      // 得分率同样按整数百分比展示：99.6% 会显示成"100%"，却因为 0.996 < 0.999
      // 仍被算作低分维度，出现"得分率 100% 的项列在低分维度里"。阈值与展示口径
      // 对齐——显示为 100% 的一律不算低分。
      .filter((row) => row.maxScore > 0 && row.gap > 0.01 && Math.round(row.ratio * 100) < 100)
      .sort((a, b) => a.ratio - b.ratio || b.gap - a.gap)
      .slice(0, 3);
  }, [summary]);
  const economicOpinion = useMemo(() => buildEconomicOpinion(active), [active]);

  const generateGroupComments = () => {
    if (!active || !summary.length) return "";
    const lines: string[] = [];
    const dimensions = ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"];
    dimensions.forEach((dimension, index) => {
      const row = summary.find((item) => item.indicator.name.includes(dimension.replace("项目", "")))
        ?? summary[index];
      const leafIds = row ? new Set([row.indicator.id, ...leavesOf(row.indicator.id).map((item) => item.id)]) : new Set<string>();
      const reasons = Array.from(new Set(
        scoreRows
          .filter((score) => leafIds.has(score.indicator_id))
          .map((score) => score.deduct_reason?.trim())
          .filter(Boolean) as string[],
      ));
      lines.push(`${index + 1}.${dimension}`);
      if (row) {
        lines.push(`该维度专家平均得分为 ${row.avg.toFixed(2)} 分，满分为 ${row.maxScore.toFixed(2).replace(/\.00$/, "")} 分。`);
      }
      if (index === 2 && economicOpinion) lines.push(economicOpinion);
      if (reasons.length) {
        lines.push(reasons.map((reason, reasonIndex) => `（${reasonIndex + 1}）${reason}`).join("\n"));
      } else if (index !== 2 || !economicOpinion) {
        lines.push("根据现有评分资料，专家未填写该维度的具体扣分理由，需结合会议意见进一步补充确认。");
      }
    });
    lines.push("总体意见：");
    lines.push(`专家组共 ${expertNames.length} 位专家参与打分，平均总分为 ${totalAvg.toFixed(2)} 分，综合评估结论为“${groupForm.conclusion || inferredConclusion || "待确定"}”。`);
    if ((groupForm.conclusion || inferredConclusion) === "不予支持") {
      lines.push("专家组认为，该项目在政策依据、实施条件、预算测算或绩效目标等方面仍存在较明显短板，建议项目单位补充论证、完善资料后再行申报。");
    } else if ((groupForm.conclusion || inferredConclusion) === "部分支持") {
      lines.push("专家组认为，该项目具备一定实施基础，但仍需围绕测算依据、绩效指标、进度安排和风险控制等内容进一步完善，建议按整改要求调整后实施。");
    } else if ((groupForm.conclusion || inferredConclusion) === "予以支持") {
      lines.push("专家组认为，该项目立项依据、实施路径与绩效目标总体较为清晰，建议在后续执行过程中继续强化过程监管与绩效跟踪。");
    }
    lines.push("其他问题和建议：");
    if (deductReasonSummary.length) {
      deductReasonSummary.forEach((item, index) => {
        lines.push(`${index + 1}.针对“${item.text}”问题，建议项目单位补充依据、明确整改措施并落实责任人员和完成时限。`);
      });
    } else {
      lines.push("1.建议项目单位结合专家意见进一步完善政策依据、实施方案、预算测算、绩效指标和风险控制措施。");
    }
    return lines.join("\n");
  };

  // 导出汇总 Excel
  const exportSummary = async () => {
    if (!summary.length || !active) return;
    const XLSX = await import("xlsx");
    const systemName = active.evaluation_system_id ? "已关联评估指标体系" : "未关联评估指标体系";
    const headers = ["指标编号", "指标名称", "分值", ...expertNames, "平均分"];
    const rows = summary.map(s => [
      s.indicator.code ?? "", s.indicator.name, Number(s.maxScore.toFixed(2)),
      ...expertNames.map(n => s.byExpert[n] ?? ""),
      Number(s.avg.toFixed(2)),
    ]);
    const totalRow = ["", "合计", Number(summary.reduce((sum, row) => sum + row.maxScore, 0).toFixed(2)),
      ...expertNames.map(n => scoreRows.filter(x => x.expert_name === n).reduce((a, b) => a + Number(b.score), 0)),
      Number(totalAvg.toFixed(2))];
    const infoRows = [
      [`${active.name} 专家打分汇总表`],
      [`项目名称：${active.name}`],
      [`项目单位：${active.unit || "—"}`, `主管部门：${active.budget_unit || active.expense_dept || active.unit || "—"}`],
      [`项目类别：${active.category || "—"}`, `预算金额：${Number(active.budget || 0).toLocaleString("zh-CN")} 元`],
      [`评估指标体系：${systemName}`, `已打分专家：${expertNames.length} 位`],
      [`导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`],
      [],
      headers,
      ...rows,
      totalRow,
    ];
    const ws = XLSX.utils.aoa_to_sheet(infoRows);
    const totalColumns = headers.length;
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, totalColumns - 1) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, totalColumns - 1) } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: Math.max(0, totalColumns - 1) } },
    ];
    ws["!cols"] = [
      { wch: 12 },
      { wch: 28 },
      { wch: 10 },
      ...expertNames.map(() => ({ wch: 14 })),
      { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "专家打分汇总表");
    XLSX.writeFile(wb, `${active?.name ?? "项目"}-专家打分汇总表.xlsx`);
    toast.success("专家打分汇总表已导出");
  };

  const exportBlankScoreSheet = async () => {
    if (!active) return;
    if (!topIndicators.length) {
      toast.error("请先关联评估指标体系，再下载空白打分表");
      return;
    }
    const XLSX = await import("xlsx");
    const maxTotal = topIndicators.reduce((sum, item) => sum + Number(item.weight), 0);
    const infoRows = [
      [`${active.name} 专家空白打分表`],
      [`项目名称：${active.name}`],
      [`项目单位：${active.unit || "—"}`, `主管部门：${active.budget_unit || active.expense_dept || active.unit || "—"}`],
      [`项目类别：${active.category || "—"}`, `预算金额：${Number(active.budget || 0).toLocaleString("zh-CN")} 元`],
      [`总分：${maxTotal}`, "专家姓名：", "专家类别：业务 / 管理 / 财务"],
      ["填写说明：请逐项填写专家评分与扣分理由；未扣分可留空扣分理由。"],
      [],
      ["序号", "指标编号", "一级指标", "分值", "专家评分", "扣分理由"],
      ...topIndicators.map((indicator, index) => ([
        index + 1,
        indicator.code ?? `#${index + 1}`,
        indicator.name,
        Number(indicator.weight) || 0,
        "",
        "",
      ])),
      ["", "", "合计", maxTotal, "", ""],
    ];
    const ws = XLSX.utils.aoa_to_sheet(infoRows);
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } },
    ];
    ws["!cols"] = [
      { wch: 8 },
      { wch: 12 },
      { wch: 28 },
      { wch: 10 },
      { wch: 12 },
      { wch: 48 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "专家空白打分表");
    XLSX.writeFile(wb, `${active.name}-专家空白打分表.xlsx`);
    toast.success("专家空白打分表已导出");
  };

  // 导出某位专家的意见书 Word（附件 8-1/8-2）
  const exportExpertOpinionDoc = async (name: string) => {
    if (!active) return;
    const { exportExpertOpinion } = await import("@/lib/docxExport");
    // 取项目预算/单位
    const { data: pj } = await supabase.from("projects")
      .select("name, unit, budget, category").eq("id", active.id).single();
    if (!pj) return toast.error("项目信息不全");
    const expScores = scoreRows.filter(s => s.expert_name === name);
    const rows = expScores.map(s => {
      const ind = indicators.find(i => i.id === s.indicator_id);
      return {
        indicator: ind ? `${ind.code ? "[" + ind.code + "] " : ""}${ind.name}` : s.indicator_id,
        maxScore: Number(s.max_score),
        score: Number(s.score),
        deductReason: s.deduct_reason ?? undefined,
      };
    });
    const totalScore = rows.reduce((a, b) => a + b.score, 0);
    const maxTotal = rows.reduce((a, b) => a + b.maxScore, 0);
    const conclusion = totalScore >= maxTotal * 0.85 ? "建议予以支持"
      : totalScore >= maxTotal * 0.6 ? "建议有条件支持（按整改意见执行后实施）"
      : "建议暂不支持，需重新论证";
    const isPolicy = /政策|法规|制度|意见|办法/.test(pj.category ?? "");
    await exportExpertOpinion({
      projectName: pj.name, unit: pj.unit, budget: Number(pj.budget),
      expertName: name, totalScore, maxTotal,
      scoreRows: rows, conclusion,
      kind: isPolicy ? "policy" : "project",
      watermark: `${user?.email ?? ""} · ${new Date().toLocaleDateString("zh-CN")} · 内部评审`,
    });
    toast.success(`已按附件 8-${isPolicy ? "2" : "1"}导出 ${name} 的意见书`);
  };

  const openGroupOpinion = () => {
    if (!active) return;
    if (!expertNames.length || !summary.length) return toast.error("请先录入至少 1 位专家打分");
    setGroupForm((prev) => ({
      ...prev,
      conclusion: prev.conclusion || inferredConclusion,
      supervisingDepartment: prev.supervisingDepartment || active.unit || active.budget_unit || "",
      thirdPartyOrg: prev.thirdPartyOrg || active.agent_org || "",
      comments: prev.comments || generateGroupComments(),
    }));
    setGroupOpen(true);
  };

  const exportGroupOpinionDoc = async () => {
    if (!active) return;
    if (!expertNames.length || !summary.length) return toast.error("暂无可汇总的专家打分");
    const { exportGroupOpinion } = await import("@/lib/docxExport");
    const exportRows = summary.map((row) => {
      const expertScores = expertNames.map((name) => row.byExpert[name] ?? 0);
      return {
        indicator: `${row.indicator.code ? `[${row.indicator.code}] ` : ""}${row.indicator.name}`,
        maxScore: Number(row.maxScore) || 0,
        expertScores,
        avgScore: expertScores.length
          ? expertScores.reduce((sum, score) => sum + score, 0) / expertScores.length
          : 0,
      };
    });
    await exportGroupOpinion({
      projectName: active.name,
      unit: active.unit,
      budget: Number(active.budget),
      category: active.category ?? undefined,
      expertNames,
      summaryRows: exportRows,
      totalPerExpert: totalPerExpert.map((value) => Number(value.toFixed(2))),
      totalAvg: Number(totalAvg.toFixed(2)),
      maxTotal: summary.reduce((sum, item) => sum + Number(item.maxScore), 0),
      conclusion: groupForm.conclusion || inferredConclusion || "待确定",
      groupComments: groupForm.comments.trim() || undefined,
      groupLeader: groupForm.groupLeader.trim() || undefined,
      supervisingDepartment: groupForm.supervisingDepartment.trim() || active.unit,
      evaluator: groupForm.evaluationOrg.trim() || "北京市通州区财政局",
      thirdPartyOrg: groupForm.thirdPartyOrg.trim() || active.agent_org || undefined,
      watermark: `${user?.email ?? ""} · ${new Date().toLocaleDateString("zh-CN")} · 内部评审`,
    });
    toast.success("专家组评估意见书已导出");
    setGroupOpen(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="PHASE II · 06A · 专家打分"
        title="专家打分与汇总"
        subtitle="支持系统在线打分 + Excel 打分表上传 · 自动归并扣分理由 · 生成正式专家组评估意见"
      />

      <EditPermissionNotice />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:gap-6">
        <Card className="surface-card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">PROJECTS</div>
          </div>
          {projects.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">暂无项目</div>
          ) : (
            <div className="divide-y divide-border max-h-[640px] overflow-auto">
              {projects.map(p => {
                const isActive = p.id === activeId;
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    className={`relative w-full text-left p-4 transition-all ${isActive ? "bg-accent/8" : "hover:bg-accent/4"}`}>
                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />}
                    <div className={`font-display font-semibold text-sm truncate ${isActive ? "text-accent" : "text-foreground"}`}>{p.name}</div>
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                      {p.evaluation_system_id ? "已关联指标" : "未关联指标"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {!active ? (
          <Card className="surface-card p-0">
            <EmptyState icon={ClipboardEdit} title="请选择项目" hint="为该项目录入或上传专家打分" />
          </Card>
        ) : (
          <div className="min-w-0 space-y-5">
            <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
              <StatTile label="EXPERTS" value={scoredStats.expertCount.toString().padStart(2, "0")} hint="已打分专家" icon={Users2} tone="info" />
              <StatTile label="INDICATORS" value={topIndicators.length.toString().padStart(2, "0")} hint="一级指标数" icon={ClipboardEdit} tone="accent" />
              <StatTile label="SHEETS" value={sheets.length.toString().padStart(2, "0")} hint="上传打分表" icon={FileSpreadsheet} tone="gold" />
              <StatTile label="AVG TOTAL" value={scoredStats.averageTotal.toFixed(1)} hint="平均总分" icon={ClipboardEdit} tone="success" />
            </div>

            <Card className="surface-card min-w-0 overflow-hidden p-4 sm:p-6">
              <SectionHeader
                eyebrow="ONLINE · 在线打分"
                title="系统内打分"
                icon={ClipboardEdit}
                actions={
                  <Button size="sm" variant="hero" onClick={openScoring}><Plus className="h-3.5 w-3.5" />录入专家打分</Button>
                }
              />
              {topIndicators.length > 0 && (
                <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-warning/35 bg-warning/10 p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-warning-foreground">TRACEBACK · 评分回溯</div>
                        <div className="font-display font-semibold text-foreground">低分维度定位</div>
                      </div>
                      <StatusPill tone="warning" dot={false}>{weakestIndicators.length}</StatusPill>
                    </div>
                    <div className="space-y-2">
                      {!expertNames.length ? (
                        <div className="rounded-md border border-dashed border-border bg-card/70 p-3 text-sm text-muted-foreground">
                          暂无专家打分，录入或上传打分表后将自动定位低分维度。
                        </div>
                      ) : weakestIndicators.length ? weakestIndicators.map((item) => (
                        <div key={item.indicator.id} className="rounded-md border border-border bg-card/70 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-accent">{item.indicator.code ?? "—"}</span>
                            <span className="font-medium text-foreground">{item.indicator.name}</span>
                            <StatusPill tone="gold" dot={false}>均分 {item.avg.toFixed(2)}</StatusPill>
                            <StatusPill tone={item.ratio < 0.6 ? "danger" : "warning"} dot={false}>得分率 {(item.ratio * 100).toFixed(0)}%</StatusPill>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                            <div className="h-full bg-warning" style={{ width: `${Math.max(0, Math.min(100, item.ratio * 100))}%` }} />
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-md border border-border bg-card/70 p-3 text-sm text-muted-foreground">
                          当前已录入指标均为满分，暂无低分维度。
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">DISPUTE · 争议点识别</div>
                        <div className="font-display font-semibold text-foreground">扣分理由聚类</div>
                      </div>
                      <StatusPill tone="danger" dot={false}>{deductReasonSummary.length}</StatusPill>
                    </div>
                    {!expertNames.length ? (
                      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                        暂无专家打分。录入或上传打分表后，系统会根据扣分理由自动归纳争议点。
                      </div>
                    ) : deductReasonSummary.length ? (
                      <div className="space-y-2">
                        {deductReasonSummary.map((item, index) => (
                          <div key={`${item.text}-${index}`} className="rounded-md border border-border bg-card/70 p-3 text-sm">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 font-mono text-xs text-destructive">#{index + 1}</span>
                              <span className="flex-1 text-foreground">{item.text}</span>
                              <StatusPill tone="neutral" dot={false}>{item.count} 次</StatusPill>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                        专家尚未填写扣分理由。录入在线评分时补充“扣分理由”后，系统会自动归纳争议点并写入专家组意见。
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!topIndicators.length ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  <div>先关联评估指标体系，才能进行专家打分和汇总。</div>
                  <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate("/projects")}>
                    现在去关联
                  </Button>
                </div>
              ) : (
                <div className="w-full overflow-x-auto overscroll-x-contain rounded-lg border border-border">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 top-0 z-20 min-w-[88px] whitespace-nowrap bg-muted/95 backdrop-blur shadow-[1px_0_0_hsl(var(--border))]">
                          指标编号
                        </TableHead>
                        <TableHead className="sticky left-[88px] top-0 z-20 min-w-[220px] whitespace-nowrap bg-muted/95 backdrop-blur shadow-[1px_0_0_hsl(var(--border))]">
                          一级指标
                        </TableHead>
                        <TableHead className="sticky top-0 z-10 text-right bg-muted/95 backdrop-blur">分值</TableHead>
                        {expertNames.map(n => (
                          <TableHead key={n} className="sticky top-0 z-10 min-w-[120px] whitespace-nowrap text-right bg-muted/95 backdrop-blur">
                            <div className="flex items-center justify-end gap-1">
                              {n}
                              <button onClick={() => delExpertScores(n)} className="opacity-50 hover:opacity-100">
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="sticky top-0 z-10 text-right text-cyan bg-muted/95 backdrop-blur">平均分</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.map((row, i) => (
                        <TableRow key={row.indicator.id}>
                          <TableCell className="sticky left-0 z-10 min-w-[88px] whitespace-nowrap bg-card font-mono text-xs shadow-[1px_0_0_hsl(var(--border))]">
                            {row.indicator.code ?? `#${i + 1}`}
                          </TableCell>
                          <TableCell className="sticky left-[88px] z-10 min-w-[220px] bg-card font-medium shadow-[1px_0_0_hsl(var(--border))]">
                            {row.indicator.name}
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.maxScore.toFixed(2).replace(/\.00$/, "")}</TableCell>
                          {expertNames.map(n => (
                            <TableCell key={n} className="text-right font-mono">
                              {row.byExpert[n] ?? <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-cyan font-semibold">{row.avg.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      {expertNames.length > 0 && (
                        <TableRow className="bg-muted/40 font-bold">
                          <TableCell className="sticky left-0 z-10 min-w-[88px] whitespace-nowrap bg-muted/95 shadow-[1px_0_0_hsl(var(--border))]">—</TableCell>
                          <TableCell className="sticky left-[88px] z-10 min-w-[220px] bg-muted/95 shadow-[1px_0_0_hsl(var(--border))]">合计</TableCell>
                          <TableCell className="text-right font-mono">{summary.reduce((sum, row) => sum + row.maxScore, 0).toFixed(2).replace(/\.00$/, "")}</TableCell>
                          {expertNames.map(n => (
                            <TableCell key={n} className="text-right font-mono">
                              {scoreRows.filter(s => s.expert_name === n).reduce((a, b) => a + Number(b.score), 0).toFixed(1)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-cyan">{totalAvg.toFixed(2)}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
              {expertNames.length > 0 && (
                <div className="mt-4 flex justify-end gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={exportSummary}>
                    <Download className="h-3.5 w-3.5" />导出汇总表 Excel
                  </Button>
                  <Button variant="hero" size="sm" onClick={openGroupOpinion}>
                    <Files className="h-3.5 w-3.5" />导出专家组评估意见
                  </Button>
                  {expertNames.map(n => (
                    <Button key={n} variant="ghost" size="sm" onClick={() => exportExpertOpinionDoc(n)}>
                      <FileText className="h-3.5 w-3.5" />{n} · 意见书 Word
                    </Button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="surface-card min-w-0 overflow-hidden p-4 sm:p-6">
              <SectionHeader
                eyebrow="UPLOAD · 打分表上传"
                title="上传专家打分表"
                count={sheets.length}
                icon={Upload}
                actions={
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={exportBlankScoreSheet}>
                      <Download className="h-3.5 w-3.5" />下载空白打分表
                    </Button>
                    <Dialog open={upOpen} onOpenChange={setUpOpen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline"><Upload className="h-3.5 w-3.5" />上传打分表</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle className="font-display text-xl">上传专家打分表</DialogTitle>
                          <DialogDescription>支持 Excel/Word/PDF；专家线下填写后由组长统一上传归档</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div><Label>专家姓名 *</Label><Input value={upForm.expert_name} onChange={e => setUpForm({ ...upForm, expert_name: e.target.value })} /></div>
                            <div>
                              <Label>类别</Label>
                              <Select value={upForm.expert_type} onValueChange={(v: any) => setUpForm({ ...upForm, expert_type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="business">业务专家</SelectItem>
                                  <SelectItem value="management">管理专家</SelectItem>
                                  <SelectItem value="finance">财务专家</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div><Label>总分（可选）</Label><Input type="number" value={upForm.total_score} onChange={e => setUpForm({ ...upForm, total_score: e.target.value })} placeholder="如填写则计入汇总" /></div>
                          <div><Label>打分表文件 *</Label><Input type="file" accept=".xlsx,.xls,.doc,.docx,.pdf" onChange={e => setUpForm({ ...upForm, file: e.target.files?.[0] ?? null })} /></div>
                          <div><Label>备注</Label><Textarea rows={2} value={upForm.notes} onChange={e => setUpForm({ ...upForm, notes: e.target.value })} /></div>
                        </div>
                        <DialogFooter>
                          <Button variant="hero" onClick={uploadSheet}>上传</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                }
              />
              {sheets.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">暂无上传的打分表</div>
              ) : (
                <div className="w-full overflow-x-auto overscroll-x-contain rounded-lg border border-border">
                  <Table className="min-w-[760px]">
                    <TableHeader><TableRow>
                      <TableHead>专家</TableHead>
                      <TableHead>类别</TableHead>
                      <TableHead>文件名</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">总分</TableHead>
                      <TableHead>上传时间</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {sheets.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.expert_name}</TableCell>
                          <TableCell><StatusPill tone="info" dot={false}>{s.expert_type ?? "—"}</StatusPill></TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{s.file_name ?? "—"}</TableCell>
                          <TableCell>
                            <StatusPill tone={s.parsed_status === "parsed" ? "success" : "warning"} dot={false}>
                              {s.parsed_status === "parsed" ? "已汇入总表" : "仅归档"}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="text-right font-mono">{s.total_score ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{new Date(s.created_at).toLocaleString("zh-CN", { hour12: false })}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadSheet(s)}><Download className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => delSheet(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* 在线打分对话框 */}
      <Dialog open={scoreOpen} onOpenChange={setScoreOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">录入专家打分</DialogTitle>
            <DialogDescription>录入后将覆盖该专家在本项目的旧打分</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><Label>专家姓名 *</Label><Input value={sForm.expert_name} onChange={e => setSForm({ ...sForm, expert_name: e.target.value })} /></div>
            <div>
              <Label>类别</Label>
              <Select value={sForm.expert_type} onValueChange={(v: any) => setSForm({ ...sForm, expert_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">业务专家</SelectItem>
                  <SelectItem value="management">管理专家</SelectItem>
                  <SelectItem value="finance">财务专家</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>指标</TableHead>
              <TableHead className="w-32 text-right">分值</TableHead>
              <TableHead className="w-32 text-right">得分</TableHead>
              <TableHead>扣分理由</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {sForm.rows.map((r, i) => {
                const ind = topIndicators.find(x => x.id === r.indicator_id);
                return (
                  <TableRow key={r.indicator_id}>
                    <TableCell><span className="text-xs font-mono mr-1">{ind?.code}</span>{ind?.name}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} step="0.1" value={r.max_score}
                        onChange={e => {
                          const raw = e.target.value;
                          const maxScore = raw === "" ? "" : Math.max(0, Number(raw) || 0);
                          const currentScore = r.score === "" ? "" : Number(r.score) || 0;
                          const nextScore = maxScore !== "" && currentScore !== "" ? Math.min(currentScore, maxScore) : currentScore;
                          const next = [...sForm.rows];
                          next[i] = { ...r, max_score: maxScore, score: nextScore };
                          setSForm({ ...sForm, rows: next });
                        }}
                        className="h-9 min-w-[96px] text-right font-mono text-sm" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} max={r.max_score || undefined} step="0.1" value={r.score}
                        onChange={e => {
                          const raw = e.target.value;
                          const numeric = raw === "" ? "" : Math.max(0, Number(raw) || 0);
                          const maxScore = Number(r.max_score) || 0;
                          const v = numeric !== "" && maxScore > 0 ? Math.min(numeric, maxScore) : numeric;
                          const next = [...sForm.rows]; next[i] = { ...r, score: v };
                          setSForm({ ...sForm, rows: next });
                        }}
                        className="h-9 min-w-[96px] text-right font-mono text-sm" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.deduct_reason}
                        onChange={e => {
                          const next = [...sForm.rows]; next[i] = { ...r, deduct_reason: e.target.value };
                          setSForm({ ...sForm, rows: next });
                        }}
                        placeholder="如：政策依据不充分"
                        className="h-8" />
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-bold">
                <TableCell>合计</TableCell>
                <TableCell className="text-right font-mono">{sForm.rows.reduce((a, b) => a + Number(b.max_score || 0), 0)}</TableCell>
                <TableCell className="text-right font-mono text-cyan">{sForm.rows.reduce((a, b) => a + Number(b.score || 0), 0)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setScoreOpen(false)}>取消</Button>
            <Button variant="hero" onClick={submitScores}>保存打分</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">导出专家组评估意见书</DialogTitle>
            <DialogDescription>按专家组汇总平均分生成正式 Word 文书，可补充总体意见和组长信息。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>评估结论</Label>
                <Select value={groupForm.conclusion || inferredConclusion || "none"} onValueChange={(value) => setGroupForm({ ...groupForm, conclusion: value === "none" ? "" : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">待确定</SelectItem>
                    <SelectItem value="予以支持">予以支持</SelectItem>
                    <SelectItem value="部分支持">部分支持</SelectItem>
                    <SelectItem value="不予支持">不予支持</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>专家组组长</Label>
                <Input value={groupForm.groupLeader} onChange={(e) => setGroupForm({ ...groupForm, groupLeader: e.target.value })} placeholder="如：张三" />
              </div>
              <div>
                <Label>评估机构</Label>
                <Input value={groupForm.evaluationOrg} onChange={(e) => setGroupForm({ ...groupForm, evaluationOrg: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>主管部门</Label>
                <Input value={groupForm.supervisingDepartment} onChange={(e) => setGroupForm({ ...groupForm, supervisingDepartment: e.target.value })} />
              </div>
              <div>
                <Label>第三方机构</Label>
                <Input value={groupForm.thirdPartyOrg} onChange={(e) => setGroupForm({ ...groupForm, thirdPartyOrg: e.target.value })} placeholder="如：北京数圣会计师事务所有限公司" />
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info" dot={false}>专家 {expertNames.length} 位</StatusPill>
                <StatusPill tone="gold" dot={false}>一级指标 {topIndicators.length} 项</StatusPill>
                <StatusPill tone="success" dot={false}>平均总分 {totalAvg.toFixed(2)}</StatusPill>
                <StatusPill tone="neutral" dot={false}>系统建议结论 {inferredConclusion || "待确定"}</StatusPill>
              </div>
            </div>
            <div>
              <Label>专家组总体意见</Label>
              <Textarea
                rows={8}
                value={groupForm.comments}
                onChange={(e) => setGroupForm({ ...groupForm, comments: e.target.value })}
                placeholder="请填写专家组分项意见、总体判断、后续建议等。未填写时系统会导出占位文本。"
              />
              <div className="mt-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setGroupForm((prev) => ({ ...prev, comments: generateGroupComments() }))}>
                  自动归纳意见
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupOpen(false)}>取消</Button>
            <Button variant="hero" onClick={exportGroupOpinionDoc}>导出 Word</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  );
};

export default ExpertScoring;

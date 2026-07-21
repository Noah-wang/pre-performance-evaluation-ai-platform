import { useEffect, useMemo, useRef, useState } from "react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Sparkles, Loader2, Trash2, FileText, Briefcase, Wallet, ShieldCheck, Copy, ScrollText, Upload, Download, Files, UserSquare2, FileArchive, Target, ListChecks, Highlighter, Link2, Save, Pencil, X, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { StatusPill, EmptyState, SectionHeader } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { MarkdownView } from "@/components/MarkdownView";
import { MeetingSpeechAssistant } from "@/components/MeetingSpeechAssistant";
import { safeStorageFileName } from "@/lib/storagePath";
import { downloadBlobFromUrl } from "@/lib/downloadFile";

interface ProjectDetail {
  id: string;
  name: string;
  unit: string;
  budget: number;
  category: string | null;
  budget_unit: string | null;
  agent_org: string | null;
  evaluation_system_id: string | null;
  custom_fields: unknown;
}
interface Indicator {
  id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  name: string;
  weight: number;
}
interface Score {
  expert_name: string;
  indicator_id: string;
  score: number;
  deduct_reason?: string | null;
}
interface Minute {
  id: string; project_id: string; title: string; meeting_date: string; content: string; created_by: string;
}
interface Opinion { expert: string; opinion: string; risk: string; suggestion: string; }
interface Analysis {
  id: string; minute_id: string;
  opinions: { business?: Opinion[]; management?: Opinion[]; finance?: Opinion[] };
  summary: string | null;
  created_at: string;
}
interface MeetingFile {
  id: string;
  minute_id: string;
  project_id: string;
  file_kind: string;
  expert_name: string | null;
  file_name: string;
  file_path: string;
  notes: string | null;
  created_at: string;
}

const CATEGORIES = [
  { key: "business", label: "业务专家", icon: Briefcase, tone: "info" as const, dot: "bg-accent" },
  { key: "management", label: "管理专家", icon: ShieldCheck, tone: "gold" as const, dot: "bg-gold" },
  { key: "finance", label: "财务专家", icon: Wallet, tone: "success" as const, dot: "bg-success" },
] as const;

const cleanMeetingLine = (line: string) =>
  line
    .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "")
    .replace(/^(主持人|[^：:]{1,12}(?:老师|专家|主管|主任|组长)?)[：:]\s*/, "")
    .trim();

const isIndicatorHeadingOnly = (line: string) =>
  /^(\d+[.、]\s*)?项目?(必要性|可行性|经济性|效率性|效益性)$/.test(line.trim());

const looksLikeActionItem = (line: string) => {
  const clean = cleanMeetingLine(line);
  if (clean.length < 12) return false;
  if (/[?？]$/.test(clean) || /哪些|什么|是否|有没有|为什么|怎么看/.test(clean)) return false;
  return /(建议|需|需要|应|请|后续|下一步).*(补充|完善|明确|优化|核实|增加|建立|制定|提交|提供|落实|整改|跟进|说明|测算|论证|材料|机制|依据)/.test(clean);
};

const Meetings = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [minutes, setMinutes] = useState<Minute[]>([]);
  const [active, setActive] = useState<Minute | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<Analysis[]>([]);
  const [open, setOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [exportingFormal, setExportingFormal] = useState(false);
  const [editingMinute, setEditingMinute] = useState(false);
  const [savingMinute, setSavingMinute] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [files, setFiles] = useState<MeetingFile[]>([]);
  const [meetingIndicators, setMeetingIndicators] = useState<Indicator[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    file_kind: "expert_opinion",
    expert_name: "",
    notes: "",
    file: null as File | null,
  });
  const meetingFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    project_id: "", title: "", meeting_date: format(new Date(), "yyyy-MM-dd"), content: "",
  });
  const [minuteDraft, setMinuteDraft] = useState({
    title: "",
    meeting_date: format(new Date(), "yyyy-MM-dd"),
    content: "",
  });
  const [summaryDraft, setSummaryDraft] = useState("");

  const loadProjects = async () => {
    const { data } = await supabase.from("projects")
      .select("id,name,unit,budget,category,budget_unit,agent_org,evaluation_system_id,custom_fields")
      .order("created_at", { ascending: false });
    setProjects((data as ProjectDetail[]) ?? []);
    if (data && data.length && !form.project_id) setForm(f => ({ ...f, project_id: data[0].id }));
  };
  const loadMinutes = async () => {
    const { data, error } = await supabase.from("meeting_minutes").select("*").order("meeting_date", { ascending: false });
    if (error) toast.error(error.message);
    else { setMinutes((data as Minute[]) ?? []); if (data && data.length && !active) setActive(data[0] as Minute); }
  };
  const loadAnalysis = async (minuteId: string) => {
    const { data } = await supabase.from("meeting_analyses").select("*")
      .eq("minute_id", minuteId).order("created_at", { ascending: false });
    const list = (data as Analysis[]) ?? [];
    setAnalysisHistory(list);
    setAnalysis(list[0] ?? null);
  };
  const loadFiles = async (minuteId: string) => {
    const { data, error } = await supabase.from("meeting_files")
      .select("*")
      .eq("minute_id", minuteId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setFiles((data as MeetingFile[]) ?? []);
  };
  const activeProject = active ? projects.find((project) => project.id === active.project_id) ?? null : null;

  useEffect(() => { loadProjects(); loadMinutes(); }, []);
  useEffect(() => {
    if (active) {
      loadAnalysis(active.id);
      loadFiles(active.id);
      setMinuteDraft({
        title: active.title,
        meeting_date: active.meeting_date,
        content: active.content,
      });
      setEditingMinute(false);
    } else {
      setAnalysis(null);
      setAnalysisHistory([]);
      setFiles([]);
    }
  }, [active?.id]);

  useEffect(() => {
    setSummaryDraft(analysis?.summary ?? "");
    setEditingSummary(false);
  }, [analysis?.id]);

  useEffect(() => {
    (async () => {
      if (!activeProject?.evaluation_system_id) {
        setMeetingIndicators([]);
        return;
      }
      const { data } = await supabase.from("evaluation_indicators")
        .select("id,parent_id,level,code,name,weight")
        .eq("system_id", activeProject.evaluation_system_id)
        .order("sort_order", { ascending: true });
      setMeetingIndicators((data as Indicator[]) ?? []);
    })();
  }, [activeProject]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.project_id || !form.title.trim() || !form.content.trim()) return toast.error("请填写完整");
    const { data, error } = await supabase.from("meeting_minutes").insert({
      project_id: form.project_id, title: form.title.trim(),
      meeting_date: form.meeting_date, content: form.content.trim(), created_by: user.id,
    }).select().single();
    if (error) toast.error(error.message);
    else {
      toast.success("纪要已保存");
      setOpen(false);
      setForm({ ...form, title: "", content: "" });
      await loadMinutes();
      setActive(data as Minute);
    }
  };

  const removeMinute = async (m: Minute) => {
    if (!(await confirm({ title: `删除"${m.title}"？`, description: "纪要内容与对应的 AI 分析结果将一并删除，此操作不可撤销。", destructive: true, confirmText: "删除" }))) return;
    const { error } = await supabase.from("meeting_minutes").delete().eq("id", m.id);
    if (error) toast.error(error.message);
    else { setActive(null); loadMinutes(); }
  };

  const saveMinute = async () => {
    if (!active) return;
    if (!minuteDraft.title.trim() || !minuteDraft.content.trim()) {
      toast.error("会议主题和纪要原文不能为空");
      return;
    }
    setSavingMinute(true);
    const { data, error } = await supabase.from("meeting_minutes")
      .update({
        title: minuteDraft.title.trim(),
        meeting_date: minuteDraft.meeting_date,
        content: minuteDraft.content.trim(),
      } as any)
      .eq("id", active.id)
      .select()
      .single();
    setSavingMinute(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const next = data as Minute;
    setMinutes((prev) => prev.map((item) => item.id === next.id ? next : item));
    setActive(next);
    setEditingMinute(false);
    toast.success("会议纪要已更新");
  };

  const saveSummary = async () => {
    if (!analysis) return;
    setSavingSummary(true);
    const { data, error } = await supabase.from("meeting_analyses")
      .update({ summary: summaryDraft.trim() || null } as any)
      .eq("id", analysis.id)
      .select()
      .single();
    setSavingSummary(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const next = data as Analysis;
    setAnalysis(next);
    setAnalysisHistory((prev) => prev.map((item) => item.id === next.id ? next : item));
    setEditingSummary(false);
    toast.success("AI 分析稿已保存");
  };

  const removeAnalysis = async (item: Analysis) => {
    if (!(await confirm({
      title: "删除这份历史稿？",
      description: "删除后不可恢复，不会影响会议纪要原文。",
      destructive: true,
      confirmText: "删除历史稿",
    }))) return;
    const { error } = await supabase.from("meeting_analyses").delete().eq("id", item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    const nextHistory = analysisHistory.filter((historyItem) => historyItem.id !== item.id);
    setAnalysisHistory(nextHistory);
    if (analysis?.id === item.id) {
      setAnalysis(nextHistory[0] ?? null);
      setSummaryDraft(nextHistory[0]?.summary ?? "");
      setEditingSummary(false);
    }
    toast.success("历史稿已删除");
  };

  const analyze = async () => {
    if (!user || !active) return;
    setAnalyzing(true);
    try {
      const currentProject = projects.find(p => p.id === active.project_id);
      const projectName = currentProject?.name;
      const { data, error } = await supabase.functions.invoke("analyze-meeting", {
        body: { content: active.content, title: active.title, projectName },
      });
      if (error) {
        if (error.message?.includes("429")) toast.error("请求过于频繁，请稍后再试");
        else if (error.message?.includes("402")) toast.error("AI 额度不足，请充值");
        else toast.error(error.message ?? "AI 分析失败");
        return;
      }
      if (data?.error) { toast.error(data.error); return; }

      const { error: insErr } = await supabase.from("meeting_analyses").insert({
        minute_id: active.id,
        opinions: { business: data.business ?? [], management: data.management ?? [], finance: data.finance ?? [] },
        summary: data.summary ?? "",
        created_by: user.id,
      });
      if (insErr) toast.error(insErr.message);
      else {
        const injectedTags = [
          data?.injected?.materialSnippets > 0 && `资料×${data.injected.materialSnippets}`,
          data?.injected?.historicalReports > 0 && `历史×${data.injected.historicalReports}`,
          data?.injected?.goalTargets > 0 && `目标×${data.injected.goalTargets}`,
        ].filter(Boolean).join(" · ");
        toast.success(`AI 分析完成${injectedTags ? ` · 已注入 ${injectedTags}` : ""}`);
        loadAnalysis(active.id);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const copySummary = () => {
    if (!analysis?.summary) return;
    navigator.clipboard.writeText(analysis.summary);
    toast.success("专家组评估意见已复制");
  };

  const exportFormalOpinionDoc = async () => {
    if (!analysis || !active || !user) return toast.error("暂无可导出的正式意见内容");
    setExportingFormal(true);
    try {
      const [{ data: project }, { data: rawScores }] = await Promise.all([
        supabase.from("projects")
          .select("id,name,unit,budget,category,budget_unit,agent_org,evaluation_system_id")
          .eq("id", active.project_id)
          .single(),
        supabase.from("expert_scores")
          .select("expert_name,indicator_id,score,deduct_reason")
          .eq("project_id", active.project_id),
      ]);
      if (!project) throw new Error("未找到项目基础信息");
      if (!rawScores || rawScores.length === 0) {
        throw new Error("请先录入专家打分，再导出正式专家组评估意见书");
      }
      const scoreRows = rawScores as Score[];
      const { data: rawIndicators } = await supabase.from("evaluation_indicators")
        .select("id,parent_id,level,code,name,weight")
        .eq("system_id", (project as ProjectDetail).evaluation_system_id)
        .order("sort_order", { ascending: true });
      const indicators = (rawIndicators as Indicator[]) ?? [];
      if (!indicators.length) throw new Error("未找到对应指标体系，无法生成正式意见书");

      const expertNames = Array.from(new Set(scoreRows.map((item) => item.expert_name)));
      const indicatorMap = new Map(indicators.map((item) => [item.id, item]));
      const topIndicators = indicators.filter((item) => item.level === 1);
      const leavesOf = (id: string): Indicator[] => {
        const direct = indicators.filter((item) => item.parent_id === id);
        if (!direct.length) {
          const self = indicatorMap.get(id);
          return self ? [self] : [];
        }
        return direct.flatMap((child) => leavesOf(child.id));
      };
      const summaryIndicators = indicators.filter((item) => item.level <= 2);
      const summaryRows = summaryIndicators.map((indicator) => {
        const leafIds = new Set(leavesOf(indicator.id).map((leaf) => leaf.id));
        const expertScores = expertNames.map((name) =>
          scoreRows
            .filter((row) => row.expert_name === name && leafIds.has(row.indicator_id))
            .reduce((sum, row) => sum + Number(row.score), 0),
        );
        const total = expertScores.reduce((sum, value) => sum + value, 0);
        const avgScore = expertScores.length ? total / expertScores.length : 0;
        return {
          indicator: `${indicator.code ? `[${indicator.code}] ` : ""}${indicator.name}`,
          maxScore: Number(indicator.weight) || 0,
          expertScores,
          avgScore,
        };
      });
      const totalPerExpert = expertNames.map((name) =>
        scoreRows.filter((row) => row.expert_name === name).reduce((sum, row) => sum + Number(row.score), 0),
      );
      const totalAvg = totalPerExpert.length
        ? totalPerExpert.reduce((sum, value) => sum + value, 0) / totalPerExpert.length
        : 0;
      const maxTotal = topIndicators.reduce((sum, item) => sum + Number(item.weight || 0), 0);
      const conclusion = maxTotal > 0
        ? totalAvg >= maxTotal * 0.85
          ? "予以支持"
          : totalAvg >= maxTotal * 0.6
            ? "部分支持"
            : "不予支持"
        : "待确定";
      const groupComments = [
        analysis.summary?.trim() || "",
        ...Array.from(new Set(scoreRows.map((item) => item.deduct_reason?.trim()).filter(Boolean)))
          .map((reason) => `扣分理由：${reason}`),
        `会议归集情况：专家意见 ${fileStats.expert_opinion ?? 0} 份，打分表 ${fileStats.score_sheet ?? 0} 份，会议材料 ${fileStats.meeting_material ?? 0} 份。`,
      ].filter(Boolean).join("\n\n");
      const { exportGroupOpinion } = await import("@/lib/docxExport");
      await exportGroupOpinion({
        projectName: project.name,
        unit: project.unit,
        budget: Number(project.budget),
        category: project.category ?? undefined,
        expertNames,
        summaryRows,
        totalPerExpert: totalPerExpert.map((value) => Number(value.toFixed(2))),
        totalAvg: Number(totalAvg.toFixed(2)),
        maxTotal,
        conclusion,
        groupComments,
        supervisingDepartment: (project as ProjectDetail).budget_unit || project.unit,
        evaluator: "北京市通州区财政局",
        thirdPartyOrg: (project as ProjectDetail).agent_org || undefined,
        watermark: `${user.email ?? ""} · ${new Date().toLocaleDateString("zh-CN")} · 内部评审`,
      });
      toast.success("正式专家组评估意见书已导出");
    } catch (e: any) {
      toast.error(e?.message ?? "导出失败");
    } finally {
      setExportingFormal(false);
    }
  };

  const uploadFile = async () => {
    if (!user || !active || !uploadForm.file) return toast.error("请选择要上传的文件");
    setUploading(true);
    try {
      const safeName = safeStorageFileName(uploadForm.file.name || "meeting-file");
      const path = `${user.id}/${active.project_id}/meeting-files/${active.id}/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("project-materials")
        .upload(path, uploadForm.file, { upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from("meeting_files").insert({
        minute_id: active.id,
        project_id: active.project_id,
        file_kind: uploadForm.file_kind,
        expert_name: uploadForm.expert_name.trim() || null,
        file_name: uploadForm.file.name,
        file_path: path,
        notes: uploadForm.notes.trim() || null,
        created_by: user.id,
      } as any);
      if (error) throw error;
      toast.success("会议文件已上传");
      setUploadOpen(false);
      setUploadForm({ file_kind: "expert_opinion", expert_name: "", notes: "", file: null });
      if (meetingFileInputRef.current) meetingFileInputRef.current.value = "";
      loadFiles(active.id);
    } catch (e: any) {
      toast.error(e?.message ?? "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (file: MeetingFile) => {
    const { data, error } = await supabase.storage.from("project-materials").createSignedUrl(file.file_path, 600);
    if (error) return toast.error(error.message);
    try {
      await downloadBlobFromUrl(data.signedUrl, file.file_name, "会议材料");
    } catch (e: any) {
      toast.error(e?.message ?? "下载失败");
    }
  };

  const removeFile = async (file: MeetingFile) => {
    if (!(await confirm({
      title: `删除文件"${file.file_name}"？`,
      description: "对应的会议归集记录也会一并删除，此操作不可撤销。",
      destructive: true,
      confirmText: "删除文件",
    }))) return;
    await supabase.storage.from("project-materials").remove([file.file_path]);
    const { error } = await supabase.from("meeting_files").delete().eq("id", file.id);
    if (error) toast.error(error.message);
    else {
      toast.success("已删除");
      loadFiles(file.minute_id);
    }
  };

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? "—";
  const kindMeta: Record<string, { label: string; tone: "info" | "gold" | "success" | "neutral"; icon: typeof FileText }> = {
    expert_opinion: { label: "专家意见", tone: "info", icon: UserSquare2 },
    score_sheet: { label: "打分表", tone: "gold", icon: FileArchive },
    meeting_material: { label: "会议材料", tone: "success", icon: Files },
    other: { label: "其他", tone: "neutral", icon: FileText },
  };
  const fileStats = files.reduce<Record<string, number>>((acc, file) => {
    acc[file.file_kind] = (acc[file.file_kind] ?? 0) + 1;
    return acc;
  }, {});
  const analysisCorpus = useMemo(() => {
    if (!analysis) return "";
    const opinions = Object.values(analysis.opinions ?? {})
      .flat()
      .flatMap((item: any) => [item?.opinion, item?.risk, item?.suggestion])
      .filter(Boolean)
      .join("\n");
    return [active?.content, opinions, analysis.summary].filter(Boolean).join("\n");
  }, [active?.content, analysis]);
  const keywordHighlights = useMemo(() => {
    const keywords = ["必要性", "可行性", "经济性", "效率", "效益", "预算", "测算", "风险", "依据", "绩效", "成本", "节约", "进度"];
    return keywords
      .map((keyword) => ({ keyword, count: (analysisCorpus.match(new RegExp(keyword, "g")) ?? []).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [analysisCorpus]);
  const scorePointMatches = useMemo(() => {
    if (!analysisCorpus || !meetingIndicators.length) return [];
    return meetingIndicators
      .map((indicator) => {
        const terms = indicator.name.split(/[、,，/／（）()\s]+/).filter((term) => term.length >= 2);
        const hits = terms.filter((term) => analysisCorpus.includes(term));
        const scoreWords = ["不足", "缺少", "建议", "风险", "依据", "预算", "测算", "证明", "完善"];
        const sentences = Array.from(new Set(analysisCorpus
          .split(/[。！？\n]/)
          .map((line) => cleanMeetingLine(line))
          .filter((line) =>
            line.length >= 10 &&
            !isIndicatorHeadingOnly(line) &&
            line !== indicator.name &&
            !/^\d+[.、]\s*$/.test(line) &&
            (hits.some((term) => line.includes(term)) || scoreWords.some((word) => line.includes(word) && indicator.name.includes(word))),
          )))
          .slice(0, 3);
        return { indicator, hits, sentences };
      })
      .filter((item) => item.hits.length || item.sentences.length)
      .slice(0, 8);
  }, [analysisCorpus, meetingIndicators]);
  const actionItems = useMemo(() => {
    if (!analysisCorpus) return [];
    return Array.from(new Set(
      analysisCorpus
        .split(/[。！？\n]/)
        .map((line) => cleanMeetingLine(line))
        .filter(looksLikeActionItem)
        .slice(0, 8),
    ));
  }, [analysisCorpus]);
  const newMinuteDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="hero"><Plus className="h-4 w-4" />新增纪要</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-display text-xl">新增评估会议纪要</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>评估对象</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>会议日期</Label>
              <Input type="date" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>会议主题</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
          </div>
          <div>
            <Label>纪要原文</Label>
            <Textarea
              value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={12} maxLength={30000}
              placeholder="粘贴完整会议纪要文本（含每位专家发言）..."
              className="font-mono text-sm"
            />
            <div className="mt-1 text-xs font-mono text-muted-foreground text-right tabular-nums">{form.content.length}/30000</div>
          </div>
          <DialogFooter><Button type="submit" variant="hero">保存</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="max-w-full overflow-x-hidden">
      <PageHeader
        eyebrow="PHASE II · 06 · 评估会议"
        title="预评估与正式评估"
        subtitle="上传会议纪要与专家材料 · AI 归并业务 / 管理 / 财务意见 · 匹配评分指标"
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 gap-6 max-w-full overflow-x-hidden xl:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <Card className="surface-card overflow-hidden p-0 min-w-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">MEETING MINUTES</div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">[{minutes.length.toString().padStart(2, "0")}]</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
            {minutes.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">暂无纪要</div>}
            {minutes.map(m => {
              const isActive = active?.id === m.id;
              return (
                <button key={m.id} onClick={() => setActive(m)}
                  className={`group relative w-full text-left p-3 transition-all ${isActive ? "bg-accent/8" : "hover:bg-accent/4"}`}>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />
                  )}
                  <div className={`font-medium text-sm truncate ${isActive ? "text-accent" : "text-foreground"}`}>{m.title}</div>
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground tabular-nums">{m.meeting_date}</div>
                  <div className="mt-0.5 text-[11px] text-gold truncate">{projectName(m.project_id)}</div>
                </button>
              );
            })}
          </div>
        </Card>

        {!active && (
          <Card className="surface-card p-0 min-w-0">
            <EmptyState
              icon={ScrollText}
              title="请选择会议纪要"
              hint="在左侧列表中选择一份纪要查看详情，或新增评估会议纪要"
            />
          </Card>
        )}

        {active && (
          <div className="space-y-4 min-w-0 overflow-x-hidden">
            <Card className="surface-card p-5 min-w-0 overflow-hidden">
              <div className="flex items-start justify-between gap-4 flex-wrap border-b border-border pb-4 mb-4">
                <div className="min-w-0 flex-1">
                  <div className="section-eyebrow mb-2">{projectName(active.project_id)}</div>
                  <div className="flex items-center gap-2 text-foreground min-w-0">
                    <FileText className="h-5 w-5 text-accent shrink-0" />
                    <h2 className="font-display text-2xl font-bold tracking-tight truncate">{active.title}</h2>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill tone="neutral" dot={false}>会议日期 {active.meeting_date}</StatusPill>
                    <StatusPill tone="neutral" dot={false}>纪要 {active.content.length} 字</StatusPill>
                    <StatusPill tone="neutral" dot={false}>文件 {files.length}</StatusPill>
                    <StatusPill tone={analysis ? "success" : "warning"} dot={false}>{analysis ? "已分析" : "待分析"}</StatusPill>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  <Dialog
                    open={uploadOpen}
                    onOpenChange={(next) => {
                      setUploadOpen(next);
                      if (!next) {
                        setUploadForm({ file_kind: "expert_opinion", expert_name: "", notes: "", file: null });
                        if (meetingFileInputRef.current) meetingFileInputRef.current.value = "";
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline"><Upload className="h-4 w-4" />上传文件</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle className="font-display text-xl">上传会议相关文件</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <div>
                          <Label>文件类型</Label>
                          <Select value={uploadForm.file_kind} onValueChange={(v) => setUploadForm({ ...uploadForm, file_kind: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="expert_opinion">专家意见</SelectItem>
                              <SelectItem value="score_sheet">打分表</SelectItem>
                              <SelectItem value="meeting_material">会议材料</SelectItem>
                              <SelectItem value="other">其他</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>专家姓名（可选）</Label>
                          <Input
                            value={uploadForm.expert_name}
                            onChange={(e) => setUploadForm({ ...uploadForm, expert_name: e.target.value })}
                            placeholder="如为专家个人意见，可填写专家姓名"
                          />
                        </div>
                        <div><Label>说明（可选）</Label><Textarea rows={2} value={uploadForm.notes} onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })} /></div>
                        <div>
                          <Label>文件 *</Label>
                          <Input
                            ref={meetingFileInputRef}
                            className="hidden"
                            type="file"
                            accept=".doc,.docx,.xls,.xlsx,.pdf,.txt,.png,.jpg,.jpeg"
                            onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] ?? null })}
                          />
                          <div className="mt-1.5 flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => meetingFileInputRef.current?.click()}>
                              选择文件
                            </Button>
                            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                              {uploadForm.file ? uploadForm.file.name : "未选择文件"}
                            </span>
                            {uploadForm.file && (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setUploadForm({ ...uploadForm, file: null });
                                  if (meetingFileInputRef.current) meetingFileInputRef.current.value = "";
                                }}
                              >
                                清除
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="hero" onClick={uploadFile} disabled={uploading}>
                          {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />上传中…</> : <><Upload className="h-4 w-4" />上传</>}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  {newMinuteDialog}
                  <Button size="icon" variant="ghost" onClick={() => removeMinute(active)} className="h-10 w-10">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <Tabs defaultValue="pre" className="min-w-0">
                  <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start">
                    <TabsTrigger value="pre">预评估</TabsTrigger>
                  </TabsList>

                <TabsContent value="pre" className="mt-0 space-y-4">
                  <MeetingSpeechAssistant
                    meetingId={active.id}
                    projectId={active.project_id}
                    meetingTitle={minuteDraft.title || active.title}
                    initialContent={minuteDraft.content}
                    onAppendToMinute={(content) => {
                      setMinuteDraft((prev) => ({ ...prev, content }));
                      setEditingMinute(true);
                    }}
                  />
                  <div className="rounded-lg border border-border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="font-display font-semibold text-foreground">会议纪要原文</div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <StatusPill tone={editingMinute ? "warning" : "neutral"} dot={false}>
                          {editingMinute ? "编辑中" : "只读"}
                        </StatusPill>
                        {editingMinute ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setMinuteDraft({
                                title: active.title,
                                meeting_date: active.meeting_date,
                                content: active.content,
                              });
                              setEditingMinute(false);
                            }}>
                              <X className="h-3.5 w-3.5" />取消
                            </Button>
                            <Button size="sm" variant="hero" onClick={saveMinute} disabled={savingMinute}>
                              <Save className="h-3.5 w-3.5" />{savingMinute ? "保存中…" : "保存纪要"}
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setEditingMinute(true)}>
                            <Pencil className="h-3.5 w-3.5" />编辑纪要
                          </Button>
                        )}
                        <Button size="sm" variant="hero" onClick={analyze} disabled={analyzing}>
                          {analyzing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />分析中…</>
                            : <><Sparkles className="h-3.5 w-3.5" />AI 分析{analysis ? "（重跑）" : ""}</>}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label>会议主题</Label>
                          <Input
                            value={minuteDraft.title}
                            onChange={(e) => setMinuteDraft((prev) => ({ ...prev, title: e.target.value }))}
                            disabled={!editingMinute}
                          />
                        </div>
                        <div>
                          <Label>会议日期</Label>
                          <Input
                            type="date"
                            value={minuteDraft.meeting_date}
                            onChange={(e) => setMinuteDraft((prev) => ({ ...prev, meeting_date: e.target.value }))}
                            disabled={!editingMinute}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>纪要原文</Label>
                        <Textarea
                          value={minuteDraft.content}
                          onChange={(e) => setMinuteDraft((prev) => ({ ...prev, content: e.target.value }))}
                          rows={12}
                          disabled={!editingMinute}
                          className="mt-1.5 text-sm leading-7"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="font-display font-semibold text-foreground">预评估意见草稿</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {analysisHistory.length > 1 && (
                          <StatusPill tone="info" dot={false}>
                            <History className="h-3 w-3 mr-1" />共 {analysisHistory.length} 稿
                          </StatusPill>
                        )}
                        {analysis?.summary && !editingSummary && (
                          <Button size="sm" variant="outline" onClick={() => setEditingSummary(true)}>
                            <Pencil className="h-3.5 w-3.5" />编辑分析稿
                          </Button>
                        )}
                        {editingSummary && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setSummaryDraft(analysis?.summary ?? "");
                              setEditingSummary(false);
                            }}>
                              <X className="h-3.5 w-3.5" />取消
                            </Button>
                            <Button size="sm" variant="hero" onClick={saveSummary} disabled={savingSummary}>
                              <Save className="h-3.5 w-3.5" />{savingSummary ? "保存中…" : "保存分析稿"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="rounded-md bg-muted/30 p-4 text-sm leading-7 text-muted-foreground">
                        {editingSummary ? (
                          <Textarea
                            value={summaryDraft}
                            onChange={(e) => setSummaryDraft(e.target.value)}
                            rows={14}
                            className="text-sm leading-7"
                          />
                        ) : analysis?.summary ? (
                          <MarkdownView content={analysis.summary} className="font-display" />
                        ) : (
                          "点击右上角“AI 分析”后，系统会基于会议纪要和专家材料生成可用于预评估的意见要点。"
                        )}
                      </div>
                      <div className="rounded-md border border-border bg-background/70 p-3">
                        <div className="text-sm font-medium text-foreground">分析历史</div>
                        <div className="mt-3 space-y-2 max-h-[360px] overflow-auto">
                          {analysisHistory.length === 0 ? (
                            <div className="text-xs text-muted-foreground">暂无历史分析稿</div>
                          ) : analysisHistory.map((item, index) => {
                            const isActiveAnalysis = analysis?.id === item.id;
                            return (
                              <div
                                key={item.id}
                                className={`relative w-full rounded-md border px-3 py-2 pr-8 text-left text-xs transition ${
                                  isActiveAnalysis ? "border-accent bg-accent/5" : "border-border hover:border-accent/40"
                                }`}
                              >
                                <button
                                  type="button"
                                  className="absolute right-2 top-2 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeAnalysis(item);
                                  }}
                                  title="删除历史稿"
                                  aria-label="删除历史稿"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" onClick={() => setAnalysis(item)} className="block w-full text-left">
                                  <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-foreground">第 {analysisHistory.length - index} 稿</span>
                                  <span className="font-mono text-muted-foreground">{format(new Date(item.created_at), "MM-dd HH:mm")}</span>
                                  </div>
                                  <div className="mt-1 line-clamp-3 text-muted-foreground">
                                    {item.summary?.trim() || "该稿暂无摘要"}
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="formal" className="mt-0 hidden space-y-4">
                  {!analysis && !analyzing ? (
                    <EmptyState
                      icon={Sparkles}
                      title="尚未进行 AI 分析"
                      hint="点击右上角『AI 分析』按钮后，再归集专家意见、评分点和正式意见书。"
                    />
	                  ) : (
	                    <>
	                      <div className="rounded-lg border border-border bg-card/60 p-4">
	                        <div className="flex items-center gap-2 font-display font-semibold text-foreground">
	                          <Target className="h-4 w-4 text-accent" />会议意见与指标关联
                        </div>
                        {!activeProject?.evaluation_system_id ? (
                          <div className="mt-3 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                            <div>先关联评估指标体系，才能进行会议关键评分点抽取和指标匹配。</div>
                            <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate("/projects")}>
                              现在去关联
                            </Button>
                          </div>
                        ) : (
                        <>
                        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
                          <div className="rounded-md bg-muted/30 p-3">
                            <div className="flex items-center gap-2 font-medium text-sm text-foreground">
                              <Highlighter className="h-4 w-4 text-accent" />关键词
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {keywordHighlights.length ? keywordHighlights.map((item) => (
                                <StatusPill key={item.keyword} tone="info" dot={false}>{item.keyword} × {item.count}</StatusPill>
                              )) : <span className="text-xs text-muted-foreground">暂无可识别关键词</span>}
                            </div>
                          </div>
                          <div className="rounded-md bg-muted/30 p-3 lg:col-span-2">
                            <div className="flex items-center gap-2 font-medium text-sm text-foreground">
                              <ListChecks className="h-4 w-4 text-accent" />待跟进建议
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {actionItems.length ? actionItems.slice(0, 4).map((item, index) => (
                                <div key={`${item}-${index}`} className="rounded-md border border-border bg-card/70 px-3 py-2 text-sm leading-6">
                                  <span className="mr-2 font-mono text-xs text-accent">#{index + 1}</span>
                                  <span className="min-w-0 break-words">{item}</span>
                                </div>
                              )) : <div className="text-xs text-muted-foreground">暂无明确的待跟进建议；普通转写内容不会在这里生成任务。</div>}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {scorePointMatches.length ? scorePointMatches.map((item) => (
                            <details key={item.indicator.id} className="group rounded-md border border-border bg-muted/20">
                              <summary className="flex cursor-pointer list-none items-center gap-3 p-3 flex-wrap">
                                <Link2 className="h-4 w-4 text-accent shrink-0" />
                                <span className="font-mono text-xs text-accent w-12 shrink-0">{item.indicator.code ?? "—"}</span>
                                <span className="flex-1 min-w-[180px] font-medium text-sm text-foreground break-words">{item.indicator.name}</span>
                                <StatusPill tone="gold" dot={false}>权重 {item.indicator.weight}</StatusPill>
                                <StatusPill tone="info" dot={false}>命中 {item.hits.length || item.sentences.length}</StatusPill>
                              </summary>
                              <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground space-y-2">
                                {item.hits.length > 0 && <div>命中词：{item.hits.join("、")}</div>}
                                {item.sentences.map((sentence, index) => (
                                  <div key={index} className="rounded bg-card/70 px-3 py-2 text-foreground break-words">{sentence}</div>
                                ))}
                              </div>
                            </details>
                          )) : (
                            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                              尚未从会议纪要中识别出与指标名称直接对应的评分点。
                            </div>
	                          )}
	                        </div>
                          </>
                        )}
	                      </div>

	                      <details className="group rounded-lg border border-border bg-card/60">
	                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
	                          <div className="flex items-center gap-2">
	                            <Sparkles className="h-4 w-4 text-accent" />
	                            <span className="font-display font-semibold text-foreground">业务 / 管理 / 财务意见归集</span>
	                          </div>
	                          <span className="text-xs text-accent group-open:hidden">展开</span>
	                          <span className="hidden text-xs text-accent group-open:inline">收起</span>
	                        </summary>
	                        <div className="border-t border-border p-3 space-y-2">
	                          {CATEGORIES.map(cat => {
	                            const list = (analysis?.opinions[cat.key] ?? []) as Opinion[];
	                            const Icon = cat.icon;
	                            return (
	                              <details key={cat.key} className="group rounded-md border border-border bg-muted/20">
	                                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
	                                  <Icon className="h-4 w-4 text-accent shrink-0" />
	                                  <span className="font-medium text-sm text-foreground">{cat.label}</span>
	                                  <StatusPill tone={cat.tone} className="ml-auto" dot={false}>{list.length}</StatusPill>
	                                </summary>
	                                <div className="border-t border-border p-3">
	                                  {list.length === 0 ? (
	                                    <div className="text-xs text-muted-foreground py-2">无该类专家发言</div>
	                                  ) : (
	                                    <div className="space-y-2">
	                                      {list.map((o, i) => (
	                                        <div key={i} className="text-xs leading-6 break-words">
	                                          <span className="font-display font-bold text-foreground">{o.expert}</span>
	                                          <span className="text-muted-foreground"> · 观点：</span>{o.opinion}
	                                          <span className="text-muted-foreground"> · 风险：</span>{o.risk}
	                                          <span className="text-muted-foreground"> · 建议：</span>{o.suggestion}
	                                        </div>
	                                      ))}
	                                    </div>
	                                  )}
	                                </div>
	                              </details>
	                            );
	                          })}
	                        </div>
	                      </details>

	                    </>
                  )}
                </TabsContent>
              </Tabs>
            </Card>

          </div>
        )}
      </div>
      <ConfirmDialog />
    </div>
  );
};

export default Meetings;

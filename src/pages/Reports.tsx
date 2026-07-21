import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sparkles, Save, FileText, Archive as ArchiveIcon,
  AlertTriangle, Lightbulb, History, CheckCircle2, ListTodo, Share2, Wand2, Stamp, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill, EmptyState, SectionHeader } from "@/components/ui-kit";
import { MarkdownView } from "@/components/MarkdownView";
import { RichTextEditor } from "@/components/RichTextEditor";
import { plainTextToHtml, replacePlainTextInHtml, richTextToPlainText } from "@/lib/richText";
import { WatermarkOverlay } from "@/components/WatermarkOverlay";
import { RewriteBlockDialog } from "@/components/RewriteBlockDialog";
import { ShareLinkDialog } from "@/components/ShareLinkDialog";
import { buildEconomicAnalysis } from "@/lib/economicAnalysis";
import { exportEvaluationReport } from "@/lib/docxExport";
import { withReportWriteFallback } from "@/lib/reportSchemaCompat";
import { extractReportTocEntries } from "@/lib/reportToc";
import {
  reportDocumentPageClasses,
  reportDocumentPageInnerClasses,
} from "@/lib/documentStyles";
import { useConfirm } from "@/hooks/useConfirm";

interface Project {
  id: string;
  name: string;
  unit: string;
  budget: number;
  category: string | null;
  description: string | null;
  package_id: string | null;
  evaluation_system_id: string | null;
  budget_unit: string | null;
  expense_dept: string | null;
  agent_org: string | null;
  manager: string | null;
  list_attribute: string | null;
  project_attribute: string | null;
  fee_calculation: unknown;
  custom_fields: unknown;
}
interface Rectification { category: string; title: string; detail: string; priority: "high" | "medium" | "low"; responsible: string; }
interface Report {
  id: string; project_id: string; title: string; content: string | null;
  conclusion: string | null; status: string;
  ai_rectification: Rectification[] | null;
  rectification: string | null;
  supervising_department: string | null;
  evaluation_org: string | null;
  third_party_org: string | null;
  unsupported_budget: number | null;
  supported_budget: number | null;
  summary_remark: string | null;
  created_at: string;
}
interface RedlineTemplate {
  id: string;
  template_key: string;
  name: string;
  content: string;
  notes: string | null;
}
interface EvaluationIndicator {
  id: string;
  code: string | null;
  name: string;
  weight: number | null;
  level: number | null;
  sort_order: number | null;
}
interface ProofingSnapshot {
  content: string;
  supervisingDepartment: string;
  evaluationOrg: string;
  thirdPartyOrg: string;
  reportDate: string;
  selectedRedlineTemplateKey: string;
}
interface ReportsWorkspaceCache {
  pid: string;
  selectedRedlineTemplateKey: string;
  supervisingDepartment: string;
  evaluationOrg: string;
  thirdPartyOrg: string;
  reportDate: string;
  extra: string;
  activeTab: "report" | "rect";
  content: string;
  conclusion: string;
  unsupportedBudgetWan: string;
  supportedBudgetWan: string;
  summaryRemark: string;
  rects: Rectification[];
  currentReportId: string | null;
  adoptedKeys: string[];
  adoptedSavedAt: string | null;
}

const rectKey = (r: Rectification) => `${r.category}|${r.title}`;
const rectsToMarkdown = (list: Rectification[]) => {
  const grouped = list.reduce<Record<string, Rectification[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r); return acc;
  }, {});
  return Object.entries(grouped).map(([cat, items]) => {
    const body = items.map((r, i) =>
      `${i + 1}. **${r.title}** [优先级：${PRIORITY_META[r.priority].label}｜责任：${r.responsible}]\n   ${r.detail}`
    ).join("\n\n");
    return `## ${cat}\n\n${body}`;
  }).join("\n\n");
};

const CONCLUSIONS = ["予以支持", "部分支持", "不予支持"];
const REPORT_WORKSPACE_CACHE_KEY = "reports:workspace-state:v1";
const PRIORITY_META: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  high: { label: "高优先", tone: "danger" },
  medium: { label: "中优先", tone: "warning" },
  low: { label: "低优先", tone: "neutral" },
};
const DEFAULT_REPORT_DIMENSIONS = ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"];
const CN_SECTION_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const buildEvaluationContentSkeleton = (dimensions = DEFAULT_REPORT_DIMENSIONS) =>
  `三、评估内容与结论\n${dimensions
    .map((name, index) => `（${CN_SECTION_LABELS[index] ?? String(index + 1)}）${name}`)
    .join("\n")}\n（${CN_SECTION_LABELS[dimensions.length] ?? String(dimensions.length + 1)}）总体结论\n`;
const buildEvaluationContentPatterns = (dimensions = DEFAULT_REPORT_DIMENSIONS) => [
  /三、评估内容与结论/,
  ...dimensions.map((name) => new RegExp(`（[一二三四五六七八九十]+）\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)),
  /总体结论/,
];
const readReportsWorkspaceCache = (): Partial<ReportsWorkspaceCache> | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REPORT_WORKSPACE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportsWorkspaceCache>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
const REPORT_TEMPLATE_SECTIONS = [
  {
    id: "evaluation_target",
    label: "一、评估对象",
    patterns: [
      /一、评估对象/,
      /（一）项目绩效目标/,
      /1\.总体目标/,
      /2\.具体绩效指标/,
      /（1）产出数量指标/,
      /（2）产出质量指标/,
      /（3）产出进度指标/,
      /（4）产出成本指标/,
      /（5）经济效益/,
      /（6）社会效益指标/,
      /（7）环境效益指标/,
      /（8）可持续影响指标/,
      /（9）服务对象满意度指标/,
      /（二）项目资金总额/,
      /（三）项目概况/,
      /1\.项目背景/,
      /2\.项目主要内容/,
    ],
    skeleton: `一、评估对象
项目名称：
项目单位：
主管部门：
项目属性：
（一）项目绩效目标
1.总体目标
2.具体绩效指标
（1）产出数量指标
（2）产出质量指标
（3）产出进度指标
（4）产出成本指标
（5）经济效益
（6）社会效益指标
（7）环境效益指标
（8）可持续影响指标
（9）服务对象满意度指标
（二）项目资金总额
（三）项目概况
1.项目背景
2.项目主要内容
`,
    hint: "必须包含项目基本字段、绩效目标九类指标、资金总额、项目背景和主要内容。",
  },
  {
    id: "method",
    label: "二、评估方式和方法",
    patterns: [
      /二、评估方式和方法/,
      /（一）评估程序/,
      /（二）评估思路及方法/,
      /（三）评估方式/,
      /1\.项目基本情况现场调研/,
      /2\.查阅资料/,
      /3\.咨询专家/,
      /4\.召开专家预评估会/,
      /5\.召开正式专家会/,
    ],
    skeleton: `二、评估方式和方法
（一）评估程序
（二）评估思路及方法
（三）评估方式
1.项目基本情况现场调研
2.查阅资料
3.咨询专家
4.召开专家预评估会
5.召开正式专家会
`,
    hint: "必须依次说明评估程序、评估思路及方法，以及现场调研、资料查阅、专家咨询和两次会议。",
  },
  {
    id: "evaluation_content",
    label: "三、评估内容与结论",
    patterns: buildEvaluationContentPatterns(),
    skeleton: buildEvaluationContentSkeleton(),
    hint: "必须按当前项目关联的评估指标体系展开，并形成总体结论。",
  },
  {
    id: "suggestions",
    label: "四、相关建议",
    patterns: [/四、相关建议/],
    skeleton: `四、相关建议
1.针对政策依据和立项决策提出建议。
2.针对实施方案和管理制度提出建议。
3.针对预算测算、成本控制和资金监管提出建议。
4.针对绩效目标和指标体系提出建议。
`,
    hint: "建议必须与第三章发现的问题逐项对应，明确责任、补充资料或整改方向。",
  },
  {
    id: "notes",
    label: "五、其他需要说明的问题",
    patterns: [
      /五、其他需要说明的问题/,
      /本报告是评估机构根据/,
      /本报告仅为.*预算部门审核预算提供参考依据/,
    ],
    skeleton: `五、其他需要说明的问题
（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估，并结合现场调研情况，在专家组意见的基础上综合形成的。
（二）本报告仅为财政预算部门审核预算提供参考依据，不作其他用途。
`,
    hint: "保留报告形成依据和用途限制两项固定说明。",
  },
  {
    id: "attachments",
    label: "六、附件",
    patterns: [
      /六、附件/,
      /1\.事前绩效评估项目预期绩效报告/,
      /2\.绩效目标申报表/,
      /3\.事前绩效评估专家评估意见书/,
      /4\.专家组及工作组情况表/,
    ],
    skeleton: `六、附件
1.事前绩效评估项目预期绩效报告
2.绩效目标申报表
3.事前绩效评估专家评估意见书
4.专家组及工作组情况表
`,
    hint: "附件清单固定列示四项；没有对应文件时仍保留名称，并在归档前补齐。",
  },
] as const;
const STRICT_REPORT_INSTRUCTION = `必须严格按照以下目录和顺序生成，不得改名、合并、删减、增加或调整章节：

一、评估对象
项目名称：
项目单位：
主管部门：
项目属性：
（一）项目绩效目标
1.总体目标
2.具体绩效指标
（1）产出数量指标
（2）产出质量指标
（3）产出进度指标
（4）产出成本指标
（5）经济效益
（6）社会效益指标
（7）环境效益指标
（8）可持续影响指标
（9）服务对象满意度指标
（二）项目资金总额
（三）项目概况
1.项目背景
2.项目主要内容

二、评估方式和方法
（一）评估程序
（二）评估思路及方法
（三）评估方式
1.项目基本情况现场调研
2.查阅资料
3.咨询专家
4.召开专家预评估会
5.召开正式专家会

三、评估内容与结论
（一）按当前项目关联的评估指标体系逐项展开
（二）总体结论

四、相关建议

五、其他需要说明的问题
（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估，并结合现场调研情况，在专家组意见的基础上综合形成的。
（二）本报告仅为财政预算部门审核预算提供参考依据，不作其他用途。

六、附件
1.事前绩效评估项目预期绩效报告
2.绩效目标申报表
3.事前绩效评估专家评估意见书
4.专家组及工作组情况表

写作规则：
1. 只使用“一、”“（一）”“1.”“（1）”四级中文编号，不使用 Markdown # 标题。
2. 第三章必须以当前项目绑定的评估指标体系为准，不得使用默认“项目必要性、项目可行性、项目经济性、项目效率性、项目效益性”替代用户设置的指标。
3. 每个评估指标章节均采用“事实依据 - 发现的问题 - 分析判断 - 综上结论”的论证方式。
4. 有专家评分时，总体结论必须列示总平均分，并按当前一级指标逐项列示满分和平均得分。
5. 不得虚构政策文件、调研日期、会议日期、专家姓名、预算明细或指标值；资料不足时写明“根据现有资料无法确认”及需要补充的资料。
6. 第四章建议必须逐项对应第三章发现的问题。
7. 正文使用第三人称、客观中立的财政绩效评估语言。`;
const DEFAULT_EVALUATION_ORG = "北京市通州区财政局";
const BUILTIN_REDLINE_TEMPLATES: RedlineTemplate[] = [
  {
    id: "__builtin_report_template_standard__",
    template_key: "builtin.attachment10.report.standard",
    name: "标准版 · 附件 10-1 事前绩效评估报告",
    content: "财政支出项目事前绩效评估报告\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、相关建议\n五、其他需要说明的问题\n六、附件",
    notes: "标准正式版，适合常规事前绩效评估报告导出。",
  },
  {
    id: "__builtin_report_template_submission__",
    template_key: "builtin.attachment10.report.submission",
    name: "送审版 · 附件 10-1 事前绩效评估报告",
    content: "财政支出项目事前绩效评估报告（送审稿）\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、相关建议\n五、其他需要说明的问题\n六、附件",
    notes: "适合内部流转、送审前校核，封面会显示“送审稿”。",
  },
  {
    id: "__builtin_report_template_review__",
    template_key: "builtin.attachment10.report.review",
    name: "专家会后修订版 · 附件 10-1 事前绩效评估报告",
    content: "财政支出项目事前绩效评估报告（专家会后修订稿）\n\n封面\n目录\n一、评估对象\n二、评估方式和方法\n三、评估内容与结论\n四、相关建议\n五、其他需要说明的问题\n六、附件",
    notes: "适合专家会后修订留痕，封面会显示“专家会后修订稿”。",
  },
];
const getLocalDateInput = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getSectionPatterns = (section: (typeof REPORT_TEMPLATE_SECTIONS)[number], dimensions: string[]) =>
  section.id === "evaluation_content" ? buildEvaluationContentPatterns(dimensions) : section.patterns;

const getSectionSkeleton = (section: (typeof REPORT_TEMPLATE_SECTIONS)[number], dimensions: string[]) =>
  section.id === "evaluation_content" ? buildEvaluationContentSkeleton(dimensions) : section.skeleton;

const alignReportToTemplate = (input: string, dimensions = DEFAULT_REPORT_DIMENSIONS) => {
  const text = input.trim();
  if (!text) return text;
  const missingSections = REPORT_TEMPLATE_SECTIONS.filter((section) =>
    !getSectionPatterns(section, dimensions).every((pattern) => pattern.test(text))
  );
  if (!missingSections.length) return text;
  return `${text}\n\n${missingSections.map((section) => getSectionSkeleton(section, dimensions)).join("\n")}`.trim();
};

const extractTemplateCoverTitle = (template?: Pick<RedlineTemplate, "name" | "content"> | null) => {
  const titleLine = template?.content
    ?.split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line && !/^目录$/.test(line) && !/^封面$/.test(line) && /(报告|意见书|工作方案)/.test(line));
  return titleLine || "财政支出项目事前绩效评估报告";
};

const normalizeEditorContent = (value: string, dimensions = DEFAULT_REPORT_DIMENSIONS) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return plainTextToHtml(alignReportToTemplate(trimmed, dimensions));
};

const Reports = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const cachedWorkspace = useMemo(readReportsWorkspaceCache, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reportIndicators, setReportIndicators] = useState<EvaluationIndicator[]>([]);
  const [redlineTemplates, setRedlineTemplates] = useState<RedlineTemplate[]>([]);
  const [selectedRedlineTemplateKey, setSelectedRedlineTemplateKey] = useState(cachedWorkspace?.selectedRedlineTemplateKey ?? BUILTIN_REDLINE_TEMPLATES[0].template_key);
  const [pid, setPid] = useState<string>(cachedWorkspace?.pid ?? "");
  const [supervisingDepartment, setSupervisingDepartment] = useState(cachedWorkspace?.supervisingDepartment ?? "");
  const [evaluationOrg, setEvaluationOrg] = useState(cachedWorkspace?.evaluationOrg ?? DEFAULT_EVALUATION_ORG);
  const [thirdPartyOrg, setThirdPartyOrg] = useState(cachedWorkspace?.thirdPartyOrg ?? "");
  const [reportDate, setReportDate] = useState(cachedWorkspace?.reportDate ?? getLocalDateInput());
  const [extra, setExtra] = useState(cachedWorkspace?.extra ?? "");
  const [activeTab, setActiveTab] = useState<"report" | "rect">(cachedWorkspace?.activeTab ?? "report");
  const [content, setContent] = useState(cachedWorkspace?.content ?? "");
  const [conclusion, setConclusion] = useState<string>(cachedWorkspace?.conclusion ?? "");
  const [unsupportedBudgetWan, setUnsupportedBudgetWan] = useState(cachedWorkspace?.unsupportedBudgetWan ?? "");
  const [supportedBudgetWan, setSupportedBudgetWan] = useState(cachedWorkspace?.supportedBudgetWan ?? "");
  const [summaryRemark, setSummaryRemark] = useState(cachedWorkspace?.summaryRemark ?? "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rects, setRects] = useState<Rectification[]>(cachedWorkspace?.rects ?? []);
  const [generatingRect, setGeneratingRect] = useState(false);
  const [rectInjected, setRectInjected] = useState<{ plan: boolean; field_records_count: number; missing_present: boolean; indicator_count: number } | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [currentReportId, setCurrentReportId] = useState<string | null>(cachedWorkspace?.currentReportId ?? null);
  const [archiving, setArchiving] = useState(false);
  const [adopted, setAdopted] = useState<Set<string>>(new Set(cachedWorkspace?.adoptedKeys ?? []));
  const [adoptedSavedAt, setAdoptedSavedAt] = useState<string | null>(cachedWorkspace?.adoptedSavedAt ?? null);
  const [pushingTasks, setPushingTasks] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteBlock, setRewriteBlock] = useState("");
  const [selectedRewriteText, setSelectedRewriteText] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [proofing, setProofing] = useState(false);
  const [proofingSnapshot, setProofingSnapshot] = useState<ProofingSnapshot | null>(null);
  const reportPrintAreaRef = useRef<HTMLDivElement | null>(null);
  const rectViewportRef = useRef<HTMLDivElement | null>(null);
  const normalizedContent = useMemo(() => richTextToPlainText(content).replace(/\s+/g, ""), [content]);
  const tocEntries = useMemo(() => extractReportTocEntries(content), [content]);
  const fallbackTocEntries = useMemo(
    () => (content ? REPORT_TEMPLATE_SECTIONS.map((section) => ({ text: section.label, level: 1 as const })) : []),
    [content],
  );
  const resolvedTocEntries = tocEntries.length ? tocEntries : fallbackTocEntries;
  const formatWan = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "";
    const wan = Number(value) / 10000;
    if (!Number.isFinite(wan)) return "";
    return wan.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  };

  // 选中段落 → AI 重写
  const openRewriteForSelection = () => {
    const sel = window.getSelection?.()?.toString().trim() || selectedRewriteText.trim();
    if (sel && sel.length > 10) {
      setRewriteBlock(sel);
    } else {
      // 默认取首段
      const plainContent = richTextToPlainText(content);
      const para = (plainContent.split(/\n\n+/).find(p => p.trim().length > 20) ?? plainContent).trim();
      if (!para) return toast.error("请先生成报告或选中要重写的段落");
      setRewriteBlock(para);
    }
    setRewriteOpen(true);
  };

  const applyRewrite = (newText: string, sourceText = rewriteBlock) => {
    const targetText = sourceText.trim();
    if (!targetText) return false;
    const result = replacePlainTextInHtml(content, targetText, newText);
    if (!result.replaced) {
      toast.error("没有在正文中找到原段落，请重新选中要重写的段落");
      return false;
    }
    setContent(result.html);
    setSelectedRewriteText("");
    return true;
  };

  // 记录版本（保存或回滚时调用）
  const snapshotVersion = async (
    reportId: string,
    source: "manual" | "ai" | "restore",
    summary?: string,
    versionContent = content,
  ) => {
    if (!user) return;
    const { data: maxRow } = await supabase.from("report_versions")
      .select("version_no").eq("report_id", reportId)
      .order("version_no", { ascending: false }).limit(1).maybeSingle();
    const next = ((maxRow?.version_no as number) ?? 0) + 1;
    await supabase.from("report_versions").insert({
      report_id: reportId, version_no: next,
      title: project ? `${project.name} · 事前绩效评估报告` : "评估报告",
      content: versionContent, change_summary: summary ?? null, source, created_by: user.id,
    } as any);
  };

  const buildReportPayload = (
    reportContent: string,
    options?: { rectList?: Rectification[]; adoptedSet?: Set<string>; status?: "draft" | "finalized" },
  ) => {
    const rectList = options?.rectList ?? rects;
    const adoptedSet = options?.adoptedSet ?? adopted;
    const adoptedList = rectList.filter((r) => adoptedSet.has(rectKey(r)));
    const rectMd = adoptedList.length ? rectsToMarkdown(adoptedList) : null;
    const normalizedReportContent = alignReportToTemplate(reportContent, reportDimensions);
    return {
      project_id: project!.id,
      title: `${project!.name} · 事前绩效评估报告`,
      content: normalizedReportContent,
      conclusion: conclusion || null,
      ai_rectification: rectList.length ? (rectList as any) : null,
      rectification: rectMd,
      supervising_department: supervisingDepartment.trim() || null,
      evaluation_org: evaluationOrg.trim() || null,
      third_party_org: thirdPartyOrg.trim() || null,
      unsupported_budget: budgetSummary.unsupportedWan === null ? null : Number((budgetSummary.unsupportedWan * 10000).toFixed(2)),
      supported_budget: budgetSummary.supportedWan === null ? null : Number((budgetSummary.supportedWan * 10000).toFixed(2)),
      summary_remark: summaryRemark.trim() || null,
      status: options?.status ?? "draft",
    };
  };

  // 将已采纳的整改建议推送为工作任务（绑定项目下的第一个工作小组）
  const pushAdoptedToTasks = async () => {
    if (!user || !project) return;
    const adoptedList = rects.filter((r) => adopted.has(rectKey(r)));
    if (adoptedList.length === 0) return toast.error("请至少勾选一条整改建议");
    setPushingTasks(true);
    try {
      // 查找/创建工作小组
      let { data: groups } = await supabase
        .from("work_groups").select("id,name").eq("project_id", project.id).limit(1);
      let groupId = groups?.[0]?.id;
      if (!groupId) {
        const { data: ng, error: ngErr } = await supabase.from("work_groups").insert({
          project_id: project.id, name: `${project.name} 整改工作组`,
          leader: "", created_by: user.id,
        } as any).select().single();
        if (ngErr) throw ngErr;
        groupId = ng.id;
      }
      const today = new Date();
      const dayOf = (n: number) => {
        const d = new Date(today); d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
      };
      const offsetByPriority = (p: string) => p === "high" ? 7 : p === "medium" ? 14 : 30;
      const { data: existingWorkTasks } = await supabase
        .from("work_tasks")
        .select("title,notes")
        .eq("group_id", groupId);
      const { data: existingRectTasks } = await supabase
        .from("rectification_tasks")
        .select("title,detail")
        .eq("project_id", project.id);
      const existingWorkKeys = new Set((existingWorkTasks ?? []).map((item: any) => `${item.title}::${item.notes ?? ""}`));
      const existingRectKeys = new Set((existingRectTasks ?? []).map((item: any) => `${item.title}::${item.detail ?? ""}`));

      const workRows = adoptedList.map((r) => ({
        group_id: groupId,
        title: `[${r.category}] ${r.title}`,
        assignee: r.responsible || "",
        notes: r.detail,
        start_date: dayOf(0),
        end_date: dayOf(offsetByPriority(r.priority)),
        status: "todo",
        created_by: user.id,
      })).filter((row) => !existingWorkKeys.has(`${row.title}::${row.notes ?? ""}`));
      const rectRows = adoptedList.map((r) => ({
        project_id: project.id,
        report_id: currentReportId,
        category: r.category || "AI 建议",
        title: r.title || "未命名",
        detail: r.detail || null,
        priority: r.priority,
        responsible: r.responsible || null,
        status: "todo",
        due_date: dayOf(offsetByPriority(r.priority)),
        created_by: user.id,
        source: "ai_report",
      })).filter((row) => !existingRectKeys.has(`${row.title}::${row.detail ?? ""}`));

      if (!workRows.length && !rectRows.length) {
        toast.info("已选择的整改建议已全部同步，无需重复推送");
        return;
      }
      if (workRows.length) {
        const { error } = await supabase.from("work_tasks").insert(workRows as any);
        if (error) throw error;
      }
      if (rectRows.length) {
        const { error } = await supabase.from("rectification_tasks").insert(rectRows as any);
        if (error) throw error;
      }
      toast.success(`已同步 ${workRows.length} 条到工作任务，${rectRows.length} 条到整改任务`);
    } catch (e: any) {
      toast.error(e.message ?? "推送失败");
    } finally {
      setPushingTasks(false);
    }
  };

  useEffect(() => {
    supabase.from("projects").select("id,name,unit,budget,category,description,package_id,evaluation_system_id,budget_unit,expense_dept,agent_org,manager,list_attribute,project_attribute,fee_calculation,custom_fields")
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects((data as Project[]) ?? []));
  }, []);

  useEffect(() => {
    supabase
      .from("doc_templates")
      .select("id,template_key,name,content,notes")
      .eq("category", "red")
      .eq("enabled", true)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        const list = (data as RedlineTemplate[] | null) ?? [];
        setRedlineTemplates(list);
      });
  }, []);

  useEffect(() => {
    if (!pid) { setHistory([]); return; }
    supabase.from("reports").select("*").eq("project_id", pid)
      .order("created_at", { ascending: false })
      .then(({ data }) => setHistory((data as any) ?? []));
  }, [pid, currentReportId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: ReportsWorkspaceCache = {
      pid,
      selectedRedlineTemplateKey,
      supervisingDepartment,
      evaluationOrg,
      thirdPartyOrg,
      reportDate,
      extra,
      activeTab,
      content,
      conclusion,
      unsupportedBudgetWan,
      supportedBudgetWan,
      summaryRemark,
      rects,
      currentReportId,
      adoptedKeys: Array.from(adopted),
      adoptedSavedAt,
    };
    window.localStorage.setItem(REPORT_WORKSPACE_CACHE_KEY, JSON.stringify(payload));
  }, [
    activeTab,
    adopted,
    adoptedSavedAt,
    conclusion,
    content,
    currentReportId,
    evaluationOrg,
    extra,
    pid,
    rects,
    reportDate,
    selectedRedlineTemplateKey,
    summaryRemark,
    supervisingDepartment,
    supportedBudgetWan,
    thirdPartyOrg,
    unsupportedBudgetWan,
  ]);

  const project = projects.find((p) => p.id === pid);
  useEffect(() => {
    if (!project?.evaluation_system_id) {
      setReportIndicators([]);
      return;
    }
    supabase
      .from("evaluation_indicators")
      .select("id,code,name,weight,level,sort_order")
      .eq("system_id", project.evaluation_system_id)
      .order("sort_order", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          toast.error(`读取评估指标失败：${error.message}`);
          setReportIndicators([]);
          return;
        }
        setReportIndicators((data as EvaluationIndicator[] | null) ?? []);
      });
  }, [project?.evaluation_system_id]);
  const reportDimensions = useMemo(() => {
    const topLevel = reportIndicators
      .filter((indicator) => indicator.level === null || Number(indicator.level ?? 1) === 1)
      .map((indicator) => indicator.name.trim())
      .filter(Boolean);
    return topLevel.length ? topLevel : DEFAULT_REPORT_DIMENSIONS;
  }, [reportIndicators]);
  const reportIndicatorInstruction = useMemo(() => {
    if (!reportIndicators.length) return "";
    const topLevel = reportIndicators.filter((indicator) => indicator.level === null || Number(indicator.level ?? 1) === 1);
    if (!topLevel.length) return "";
    return [
      "当前项目已关联评估指标体系。第三章“评估内容与结论”必须严格按以下一级指标展开，不得替换为默认五项：",
      ...topLevel.map((indicator, index) =>
        `${index + 1}. ${indicator.code ? `[${indicator.code}] ` : ""}${indicator.name}${indicator.weight !== null && indicator.weight !== undefined ? `（权重 ${indicator.weight}）` : ""}`
      ),
    ].join("\n");
  }, [reportIndicators]);
  const availableRedlineTemplates = useMemo(
    () => [
      ...BUILTIN_REDLINE_TEMPLATES,
      ...redlineTemplates.filter((item) => !BUILTIN_REDLINE_TEMPLATES.some((builtin) => builtin.template_key === item.template_key)),
    ],
    [redlineTemplates],
  );
  const activeRedlineTemplate = useMemo(
    () => availableRedlineTemplates.find((item) => item.template_key === selectedRedlineTemplateKey) ?? BUILTIN_REDLINE_TEMPLATES[0],
    [availableRedlineTemplates, selectedRedlineTemplateKey],
  );
  const activeRedlineTitle = useMemo(
    () => extractTemplateCoverTitle(activeRedlineTemplate),
    [activeRedlineTemplate],
  );
  const currentReport = history.find((item) => item.id === currentReportId) ?? null;
  const isCurrentFinalized = currentReport?.status === "finalized";
  const projectRedlinePreferenceKey = useMemo(
    () => (pid ? `reports:redline-template:${pid}` : null),
    [pid],
  );
  const projectBudgetWan = useMemo(
    () => Number(project?.budget || 0) / 10000,
    [project],
  );
  useEffect(() => {
    if (!project) return;
    setSupervisingDepartment((prev) => prev || project.unit || project.budget_unit || "");
    setEvaluationOrg((prev) => prev || DEFAULT_EVALUATION_ORG);
    setThirdPartyOrg((prev) => prev || project.agent_org || "");
  }, [project]);
  const unsupportedBudgetWanNumber = unsupportedBudgetWan.trim() === "" ? null : Number(unsupportedBudgetWan);
  const supportedBudgetWanNumber = supportedBudgetWan.trim() === "" ? null : Number(supportedBudgetWan);
  const budgetSummary = useMemo(() => {
    if (!project) return { unsupportedWan: null as number | null, supportedWan: null as number | null };
    if (conclusion === "予以支持") {
      return { unsupportedWan: 0, supportedWan: projectBudgetWan };
    }
    if (conclusion === "不予支持") {
      return { unsupportedWan: projectBudgetWan, supportedWan: 0 };
    }
    if (conclusion === "部分支持") {
      if (unsupportedBudgetWanNumber !== null && Number.isFinite(unsupportedBudgetWanNumber)) {
        return {
          unsupportedWan: unsupportedBudgetWanNumber,
          supportedWan: Math.max(projectBudgetWan - unsupportedBudgetWanNumber, 0),
        };
      }
      if (supportedBudgetWanNumber !== null && Number.isFinite(supportedBudgetWanNumber)) {
        return {
          unsupportedWan: Math.max(projectBudgetWan - supportedBudgetWanNumber, 0),
          supportedWan: supportedBudgetWanNumber,
        };
      }
    }
    return { unsupportedWan: unsupportedBudgetWanNumber, supportedWan: supportedBudgetWanNumber };
  }, [conclusion, project, projectBudgetWan, supportedBudgetWanNumber, unsupportedBudgetWanNumber]);
  const budgetGapWan = useMemo(() => {
    if (!project || budgetSummary.unsupportedWan === null || budgetSummary.supportedWan === null) return null;
    return Number((projectBudgetWan - budgetSummary.unsupportedWan - budgetSummary.supportedWan).toFixed(2));
  }, [budgetSummary.supportedWan, budgetSummary.unsupportedWan, project, projectBudgetWan]);
  const coverRows = useMemo(() => {
    if (!project) return [];
    return [
      { label: "项目名称", value: project.name },
      { label: "项目单位", value: project.unit },
      { label: "主管部门", value: supervisingDepartment.trim() },
      { label: "评估机构", value: evaluationOrg.trim() },
      { label: "第三方机构", value: thirdPartyOrg.trim() },
    ].filter((row) => row.value);
  }, [evaluationOrg, project, supervisingDepartment, thirdPartyOrg]);
  const reportDateParts = useMemo(() => {
    const [year = "", month = "", day = ""] = reportDate.split("-");
    return { year, month: month.replace(/^0/, ""), day: day.replace(/^0/, "") };
  }, [reportDate]);
  const economicAnalysis = useMemo(
    () => buildEconomicAnalysis(project, projects),
    [project, projects],
  );
  const templateOutline = useMemo(
    () => activeRedlineTemplate.content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && line !== "封面" && line !== "目录"),
    [activeRedlineTemplate],
  );
  const proofingDirty = useMemo(() => {
    if (!proofingSnapshot) return false;
    return (
      proofingSnapshot.content !== content
      || proofingSnapshot.supervisingDepartment !== supervisingDepartment
      || proofingSnapshot.evaluationOrg !== evaluationOrg
      || proofingSnapshot.thirdPartyOrg !== thirdPartyOrg
      || proofingSnapshot.reportDate !== reportDate
      || proofingSnapshot.selectedRedlineTemplateKey !== selectedRedlineTemplateKey
    );
  }, [
    content,
    evaluationOrg,
    proofingSnapshot,
    reportDate,
    selectedRedlineTemplateKey,
    supervisingDepartment,
    thirdPartyOrg,
  ]);

  useEffect(() => {
    if (!projectRedlinePreferenceKey) return;
    const savedKey = window.localStorage.getItem(projectRedlinePreferenceKey);
    if (!savedKey) return;
    const matched = availableRedlineTemplates.some((item) => item.template_key === savedKey);
    if (matched) {
      setSelectedRedlineTemplateKey(savedKey);
      return;
    }
    window.localStorage.removeItem(projectRedlinePreferenceKey);
  }, [availableRedlineTemplates, projectRedlinePreferenceKey]);

  useEffect(() => {
    if (!projectRedlinePreferenceKey || !selectedRedlineTemplateKey) return;
    window.localStorage.setItem(projectRedlinePreferenceKey, selectedRedlineTemplateKey);
  }, [projectRedlinePreferenceKey, selectedRedlineTemplateKey]);

  const snapshotCurrentProofingState = (): ProofingSnapshot => ({
    content,
    supervisingDepartment,
    evaluationOrg,
    thirdPartyOrg,
    reportDate,
    selectedRedlineTemplateKey,
  });
  const clearProofingState = () => {
    setProofing(false);
    setProofingSnapshot(null);
  };
  const restoreProofingSnapshot = () => {
    if (!proofingSnapshot) return;
    setContent(proofingSnapshot.content);
    setSupervisingDepartment(proofingSnapshot.supervisingDepartment);
    setEvaluationOrg(proofingSnapshot.evaluationOrg);
    setThirdPartyOrg(proofingSnapshot.thirdPartyOrg);
    setReportDate(proofingSnapshot.reportDate);
    setSelectedRedlineTemplateKey(proofingSnapshot.selectedRedlineTemplateKey);
    toast.success("已撤销套红试印修改");
  };

  const templateAudit = useMemo(() => {
    const sectionChecks = REPORT_TEMPLATE_SECTIONS.map((section) => ({
      ...section,
      matched: getSectionPatterns(section, reportDimensions).every((pattern) => pattern.test(content)),
    }));
    return [
      {
        id: "cover",
        label: "封面要素",
        matched: Boolean(project?.name && project?.unit && project?.budget && conclusion),
        hint: "项目名称、项目单位、预算金额、评估结论建议在定稿版中完整呈现。",
      },
      {
        id: "facts",
        label: "事实依据",
        matched: normalizedContent.includes("预算") || normalizedContent.includes("金额") || normalizedContent.includes("指标"),
        hint: "正文中应体现预算金额、绩效指标、专家意见或调研结论等事实依据。",
      },
      ...sectionChecks,
    ];
  }, [conclusion, content, normalizedContent, project, reportDimensions]);
  const missingTemplateSections = templateAudit.filter((item) => !item.matched);
  const polishPrompt = useMemo(() => {
    if (!project) return "";
    const missingLabels = missingTemplateSections.map((item) => item.label).join("、") || "无缺失章节，请重点细化论证";
    return [
      `请按照“北京市通州区财政支出项目事前绩效评估报告”正式成果格式，对《${project.name}》报告进行定稿优化。`,
      `已知项目单位：${project.unit}；主管部门：${supervisingDepartment || project.unit}；评估机构：${evaluationOrg || DEFAULT_EVALUATION_ORG}；第三方机构：${thirdPartyOrg || "待补充"}；预算金额：${project.budget.toLocaleString()} 元；当前结论：${conclusion || "待确定"}。`,
      budgetSummary.unsupportedWan !== null || budgetSummary.supportedWan !== null
        ? `结论汇总口径：不予支持部分预算 ${budgetSummary.unsupportedWan?.toFixed(2) ?? "待补"} 万元；支持金额 ${budgetSummary.supportedWan?.toFixed(2) ?? "待补"} 万元。`
        : "结论汇总口径：请明确不予支持部分预算金额与支持金额，并保持与结论一致。",
      `请优先补足以下内容：${missingLabels}。`,
      reportIndicatorInstruction,
      "要求：",
      "1. 保留现有项目事实，不虚构数据。",
      `2. ${STRICT_REPORT_INSTRUCTION}`,
      "3. 对政策依据、预算测算、绩效目标、满意度、时间进度等薄弱处用正式评估语言细化。",
      "4. 若发现论证不足，请明确写出风险点、补充资料要求和后续整改建议。",
      economicAnalysis,
    ].join("\n");
  }, [budgetSummary.supportedWan, budgetSummary.unsupportedWan, conclusion, economicAnalysis, evaluationOrg, missingTemplateSections, project, reportIndicatorInstruction, supervisingDepartment, thirdPartyOrg]);

  const sourceTraceItems = useMemo(() => [
    { label: "项目基础信息", active: Boolean(project), detail: project ? `${project.unit} · ${project.budget.toLocaleString()} 元` : "未选择项目" },
    { label: "补充材料/专家意见", active: Boolean(extra.trim()), detail: extra.trim() ? "已纳入 AI 写作上下文" : "可在左侧补充" },
    { label: "经济性客观依据", active: Boolean(project), detail: "预算、同类项目和成本节约口径" },
    { label: "目录章节识别", active: resolvedTocEntries.length > 0, detail: resolvedTocEntries.length ? `识别 ${resolvedTocEntries.length} 个标题` : "生成后自动识别" },
    { label: "生成记录", active: history.length > 0, detail: history.length ? `${history.length} 份历史报告可复用` : "暂无记录" },
  ], [extra, history.length, project, resolvedTocEntries.length]);

  const appendPolishPrompt = () => {
    if (!polishPrompt) return;
    setExtra((prev) => prev.trim() ? `${prev.trim()}\n\n${polishPrompt}` : polishPrompt);
    toast.success("已将定稿提示语写入“补充材料 / 专家意见摘要”");
  };

  const openProofingPreview = () => {
    if (!content) return toast.error("请先生成报告正文");
    setProofingSnapshot(snapshotCurrentProofingState());
    setProofing(true);
    window.requestAnimationFrame(() => {
      reportPrintAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    toast.success("已进入套红试印工作台，可先微调并保存试印稿，再导出标准报告");
  };

  const resetDraft = () => {
    setCurrentReportId(null);
    setContent("");
    setConclusion("");
    setUnsupportedBudgetWan("");
    setSupportedBudgetWan("");
    setSummaryRemark("");
    setRects([]);
    setAdopted(new Set());
    setAdoptedSavedAt(null);
    clearProofingState();
  };

  const insertMissingTemplateSections = () => {
    if (!content) return toast.error("请先生成报告正文");
    const missingSections = REPORT_TEMPLATE_SECTIONS.filter((section) =>
      !getSectionPatterns(section, reportDimensions).every((pattern) => pattern.test(content))
    );
    if (!missingSections.length) {
      toast.success("标准章节已较完整，无需自动补齐");
      return;
    }
    const append = missingSections.map((section) => getSectionSkeleton(section, reportDimensions)).join("\n");
    setContent((prev) => `${prev.trim()}\n\n${append}`.trim());
    toast.success(`已补入 ${missingSections.length} 个标准章节骨架`);
  };

  const generate = async () => {
    if (!project) return toast.error("请先选择评估对象");
    setGenerating(true);
    clearProofingState();
    setContent(""); setRects([]); setCurrentReportId(null);
    setSupervisingDepartment(project.unit || "");
    setEvaluationOrg(DEFAULT_EVALUATION_ORG);
    setThirdPartyOrg(project.agent_org || "");
    setUnsupportedBudgetWan("");
    setSupportedBudgetWan("");
    setSummaryRemark("");
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-report`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          project,
          extra: [STRICT_REPORT_INSTRUCTION, reportIndicatorInstruction, economicAnalysis, extra.trim()].filter(Boolean).join("\n\n"),
        }),
      });
      if (res.status === 429) { toast.error("AI 调用过于频繁，请稍后重试"); setGenerating(false); return; }
      if (res.status === 402) { toast.error("AI 用量已耗尽"); setGenerating(false); return; }
      if (!res.ok || !res.body) throw new Error("AI 服务调用失败");
      const scoreInjected = res.headers.get("X-Score-Injected") === "1";
      const ragTags = [
        scoreInjected && "评分",
        Number(res.headers.get("X-Rag-Overview") || 0) > 0 && `资料全景×${res.headers.get("X-Rag-Overview")}`,
        Number(res.headers.get("X-Rag-Priority-Chunks") || 0) > 0 && `重点片段×${res.headers.get("X-Rag-Priority-Chunks")}`,
        Number(res.headers.get("X-Rag-Indexed") || 0) > 0 && `新索引×${res.headers.get("X-Rag-Indexed")}`,
        Number(res.headers.get("X-Rag-Knowledge") || 0) > 0 && `文件库×${res.headers.get("X-Rag-Knowledge")}`,
        Number(res.headers.get("X-Rag-Materials") || 0) > 0 && `资料×${res.headers.get("X-Rag-Materials")}`,
        Number(res.headers.get("X-Rag-History") || 0) > 0 && `历史×${res.headers.get("X-Rag-History")}`,
        Number(res.headers.get("X-Rag-Goals") || 0) > 0 && `目标×${res.headers.get("X-Rag-Goals")}`,
      ].filter(Boolean).join(" · ");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      let sawDoneSignal = false;
      let acc = "";
      let streamError: Error | null = null;
      try {
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) !== -1) {
            let line = buf.slice(0, idx);
            buf = buf.slice(idx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (json === "[DONE]") {
              sawDoneSignal = true;
              done = true;
              break;
            }
            try {
              const p = JSON.parse(json);
              const c = p.choices?.[0]?.delta?.content;
              if (c) { acc += c; setContent(acc); }
            } catch {
              buf = line + "\n" + buf;
              break;
            }
          }
        }
      } catch (error) {
        streamError = error instanceof Error ? error : new Error("网络连接中断");
      }
      if (!acc.trim()) throw streamError ?? new Error("AI 未返回报告内容");
      const generatedHtml = normalizeEditorContent(acc, reportDimensions);
      const generatedPlain = richTextToPlainText(generatedHtml);
      const looksComplete = ["四、相关建议", "五、其他需要说明的问题", "六、附件"]
        .every((section) => generatedPlain.includes(section));
      setContent(generatedHtml);
      if (user) {
        const { data, error } = await withReportWriteFallback(
          (payload) => supabase.from("reports").insert(payload as any).select().single(),
          {
            ...buildReportPayload(generatedHtml, { rectList: [], adoptedSet: new Set(), status: "draft" }),
            created_by: user.id,
            status: "draft",
          },
        );
        if (error) throw error;
        setCurrentReportId(data.id);
        await snapshotVersion(data.id, "ai", streamError || !looksComplete || !sawDoneSignal ? "AI 生成中断后自动保存" : "AI 初次生成", generatedHtml);
      }
      if (streamError || !looksComplete || !sawDoneSignal) {
        toast.warning(`报告已保存为草稿，但生成可能未完整${ragTags ? ` · 已注入 ${ragTags}` : ""}，可继续编辑或重新生成`);
      } else {
        toast.success(`报告生成完成${ragTags ? ` · 已注入 ${ragTags}` : ""} · 已自动记录，可直接继续编辑`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const generateRect = async () => {
    if (!content || !project) return toast.error("请先生成报告正文");
    setGeneratingRect(true);
    setRectInjected(null);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-rectification`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          projectId: project.id,
          reportContent: richTextToPlainText(content),
          projectName: project.name,
          conclusion,
        }),
      });
      if (res.status === 429) { toast.error("AI 调用过于频繁"); return; }
      if (res.status === 402) { toast.error("AI 用量已耗尽"); return; }
      if (!res.ok) throw new Error("生成失败");
      const data = await res.json();
      const items: Rectification[] = data.items ?? [];
      setRects(items);
      const nextAdopted = new Set(items.map(rectKey));
      setAdopted(nextAdopted); // 默认全选采纳
      setAdoptedSavedAt(null);
      setRectInjected(data.injected ?? null);
      if (user) {
        const status = currentReport?.status === "finalized" ? "finalized" : "draft";
        if (currentReportId) {
          const { error } = await withReportWriteFallback(
            (payload) => supabase.from("reports")
              .update(payload as any)
              .eq("id", currentReportId),
            buildReportPayload(content, { rectList: items, adoptedSet: nextAdopted, status }),
          );
          if (error) throw error;
          setHistory((prev) => prev.map((item) => (
            item.id === currentReportId
              ? {
                ...item,
                ai_rectification: items,
                rectification: rectsToMarkdown(items),
                status,
              }
              : item
          )));
        } else {
          const { data: created, error } = await withReportWriteFallback(
            (payload) => supabase.from("reports").insert(payload as any).select("id,status").single(),
            {
              ...buildReportPayload(content, { rectList: items, adoptedSet: nextAdopted, status }),
              created_by: user.id,
            },
          );
          if (error) throw error;
          if (created?.id) setCurrentReportId(created.id);
        }
      }
      const inj = data.injected;
      const tags = [
        inj?.plan && "方案",
        inj?.field_records_count > 0 && `调研×${inj.field_records_count}`,
        inj?.missing_present && "缺漏",
        inj?.indicator_count > 0 && `指标×${inj.indicator_count}`,
        inj?.rag_materials > 0 && `资料×${inj.rag_materials}`,
        inj?.rag_history > 0 && `历史×${inj.rag_history}`,
        inj?.rag_goals > 0 && `目标×${inj.rag_goals}`,
      ].filter(Boolean).join(" · ");
      toast.success(`生成 ${data.items?.length ?? 0} 条整改建议${tags ? ` · 已注入 ${tags}` : ""} · 已同步到报告记录`);
    } catch (e: any) {
      toast.error(e.message ?? "生成失败");
    } finally {
      setGeneratingRect(false);
    }
  };

  const save = async (
    targetStatus: "draft" | "finalized" = "draft",
    options?: {
      keepProofing?: boolean;
      versionSummary?: string;
      successMessage?: string;
    },
  ) => {
    if (!user || !project || !content) return;
    if (targetStatus === "finalized" && !conclusion) return toast.error("请先选择评估结论后再定稿");
    setSaving(true);
    const adoptedList = rects.filter((r) => adopted.has(rectKey(r)));
    const rectMd = adoptedList.length ? rectsToMarkdown(adoptedList) : null;
    const normalizedContent = normalizeEditorContent(content, reportDimensions);
    let data: { id: string } | null = null;
    let error: any = null;
    if (currentReportId) {
      const res = await withReportWriteFallback(
        (payload) => supabase.from("reports")
          .update(payload as any)
          .eq("id", currentReportId)
          .select("id")
          .single(),
        buildReportPayload(normalizedContent, { status: targetStatus }),
      );
      data = res.data as any;
      error = res.error;
    } else {
      const res = await withReportWriteFallback(
        (payload) => supabase.from("reports").insert(payload as any).select("id").single(),
        {
          ...buildReportPayload(normalizedContent, { status: targetStatus }),
          created_by: user.id,
        },
      );
      data = res.data as any;
      error = res.error;
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setContent(normalizedContent);
    setCurrentReportId(data!.id);
    if (rectMd) setAdoptedSavedAt(new Date().toLocaleTimeString());
    await snapshotVersion(
      data!.id,
      "manual",
      options?.versionSummary ?? (
        targetStatus === "finalized"
          ? "定稿锁定"
          : currentReportId ? "手动保存更新" : "保存报告"
      ),
      normalizedContent,
    );
    setHistory((prev) => prev.map((item) => item.id === data!.id ? { ...item, status: targetStatus } as Report : item));
    if (options?.keepProofing) {
      setProofingSnapshot({
        content: normalizedContent,
        supervisingDepartment,
        evaluationOrg,
        thirdPartyOrg,
        reportDate,
        selectedRedlineTemplateKey,
      });
      setProofing(true);
    } else if (targetStatus === "finalized") {
      clearProofingState();
    }
    toast.success(
      `${options?.successMessage ?? (targetStatus === "finalized" ? "报告已定稿并锁定" : "报告草稿已保存")}${adoptedList.length ? ` · 已记录 ${adoptedList.length} 条整改` : ""}`,
    );
  };

  const loadReport = (r: Report) => {
    setContent(normalizeEditorContent(r.content ?? "", reportDimensions));
    setConclusion(r.conclusion ?? "");
    setSupervisingDepartment(r.supervising_department ?? project?.unit ?? "");
    setEvaluationOrg(r.evaluation_org ?? DEFAULT_EVALUATION_ORG);
    setThirdPartyOrg(r.third_party_org ?? project?.agent_org ?? "");
    setUnsupportedBudgetWan(formatWan(r.unsupported_budget));
    setSupportedBudgetWan(formatWan(r.supported_budget));
    setSummaryRemark(r.summary_remark ?? "");
    setReportDate(getLocalDateInput(new Date(r.created_at)));
    const list = (r.ai_rectification as Rectification[]) ?? [];
    setRects(list);
    // 还原已采纳：rectification 字段中能匹配到的视为已采纳，否则若有 rectification 则全部视作已采纳
    if (r.rectification && list.length) {
      const adoptedKeys = new Set<string>();
      list.forEach((it) => {
        if (r.rectification!.includes(it.title)) adoptedKeys.add(rectKey(it));
      });
      setAdopted(adoptedKeys.size ? adoptedKeys : new Set(list.map(rectKey)));
      setAdoptedSavedAt("已记录");
    } else {
      setAdopted(new Set(list.map(rectKey)));
      setAdoptedSavedAt(null);
    }
    setCurrentReportId(r.id);
    clearProofingState();
    toast.info(`已载入 ${new Date(r.created_at).toLocaleDateString()} 报告`);
  };

  const deleteReportRecord = async (report: Report) => {
    if (!(await confirm({
      title: "删除这条生成记录？",
      description: "会删除该报告正文、历史记录、分享链接和相关留痕。删除后不可恢复。",
      confirmText: "删除记录",
      destructive: true,
    }))) {
      return;
    }

    const steps: Array<Promise<{ error: { message: string } | null }>> = [
      supabase.from("share_links").delete().eq("report_id", report.id),
      supabase.from("report_versions").delete().eq("report_id", report.id),
      supabase.from("archived_projects").delete().eq("report_id", report.id),
      supabase.from("rectification_tasks").delete().eq("report_id", report.id),
    ];

    const results = await Promise.allSettled(steps);
    const cleanupError = results.find(
      (item) => item.status === "fulfilled" && item.value.error,
    );
    if (cleanupError && cleanupError.status === "fulfilled") {
      toast.warning(`部分关联记录删除失败：${cleanupError.value.error?.message}`);
    }

    const { error } = await supabase.from("reports").delete().eq("id", report.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    setHistory((prev) => prev.filter((item) => item.id !== report.id));
    if (currentReportId === report.id) {
      resetDraft();
    }
    toast.success("生成记录已删除");
  };

  const exportStandardReport = async () => {
    if (!project || !content) return toast.error("请先生成报告");
    if (proofing && proofingDirty) {
      toast.info("检测到套红试印中仍有未保存修改，本次将按当前预览内容直接导出");
    }
    const normalizedReport = alignReportToTemplate(content, reportDimensions);
    setContent(normalizedReport);
    await exportEvaluationReport({
      projectName: project.name,
      unit: project.unit,
      budget: project.budget,
      category: project.category ?? undefined,
      supervisingDepartment: supervisingDepartment || project.unit,
      evaluator: evaluationOrg || undefined,
      thirdPartyOrg: thirdPartyOrg || undefined,
      reportContent: normalizedReport,
      redlineTemplateName: activeRedlineTemplate.name,
      redlineTemplateContent: activeRedlineTemplate.content,
      conclusion,
      unsupportedBudget: budgetSummary.unsupportedWan ?? undefined,
      supportedBudget: budgetSummary.supportedWan ?? undefined,
      summaryRemark: summaryRemark || undefined,
      totalScore: undefined,
      maxScore: undefined,
      date: reportDate,
    });
    toast.success("标准评估报告已导出");
  };

  const archive = async () => {
    if (!user || !project || !currentReportId) return toast.error("请先保存报告");
    if (!conclusion) return toast.error("请先选择评估结论");
    setArchiving(true);
    const { error } = await supabase.from("archived_projects").insert({
      project_id: project.id,
      report_id: currentReportId,
      project_snapshot: project as any,
      conclusion,
      archived_by: user.id,
      archive_note: `经评估结论：${conclusion}`,
    } as any);
    setArchiving(false);
    if (error) toast.error(error.message);
    else toast.success("已归入项目库");
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow="PHASE III · 07 · AI 报告"
          title="评估报告 · AI 撰写"
          subtitle="AI 自动撰写报告 · 生成整改建议 · 统一导出标准报告并归档"
          className="mb-0"
        />

        <EditPermissionNotice />

        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* 左侧：控制台 */}
          <Card className="surface-card min-w-0">
            <CardContent className="p-5">
              <Tabs defaultValue="basic" className="min-w-0">
                <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl bg-muted/55 p-1">
                  <TabsTrigger value="basic" className="px-2 text-xs">对象</TabsTrigger>
                  <TabsTrigger value="cover" className="px-2 text-xs">封面</TabsTrigger>
                  <TabsTrigger value="actions" className="px-2 text-xs">工具</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="mt-4 space-y-5">
            <div>
              <div className="section-eyebrow mb-3">① TARGET · 评估对象</div>
              <Select value={pid} onValueChange={(value) => {
                setPid(value);
                setCurrentReportId(null);
                setContent("");
                setConclusion("");
                const selectedProject = projects.find((item) => item.id === value);
                setSupervisingDepartment(selectedProject?.unit ?? "");
                setEvaluationOrg(DEFAULT_EVALUATION_ORG);
                setThirdPartyOrg(selectedProject?.agent_org ?? "");
                setReportDate(getLocalDateInput());
                setUnsupportedBudgetWan("");
                setSupportedBudgetWan("");
                setSummaryRemark("");
                setRects([]);
                setAdopted(new Set());
                setAdoptedSavedAt(null);
                clearProofingState();
              }}>
                <SelectTrigger><SelectValue placeholder="请选择项目…" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} — {p.unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {project && (
                <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                  <div className="flex justify-between"><span className="font-mono uppercase tracking-wider text-muted-foreground">单位</span><span className="text-foreground truncate ml-2">{project.unit}</span></div>
                  <div className="flex justify-between"><span className="font-mono uppercase tracking-wider text-muted-foreground">预算</span><span className="font-mono tabular-nums text-accent font-bold">¥{project.budget.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="font-mono uppercase tracking-wider text-muted-foreground">类别</span><span className="text-foreground">{project.category ?? "—"}</span></div>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">补充材料 / 专家意见摘要</Label>
              <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={5} maxLength={5000}
                disabled={isCurrentFinalized}
                placeholder="调研发现、专家组意见、绩效指标要点…" className="mt-1.5" />
            </div>

            <div>
              <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">评估结论</Label>
              <Select value={conclusion} onValueChange={setConclusion} disabled={isCurrentFinalized}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="待确定…" /></SelectTrigger>
                <SelectContent>
                  {CONCLUSIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
                </TabsContent>

                <TabsContent value="cover" className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-muted/25 p-4 space-y-3">
              <div className="section-eyebrow">② COVER · 封面信息</div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">套红模板</Label>
                  <Select value={selectedRedlineTemplateKey} onValueChange={setSelectedRedlineTemplateKey}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="请选择模板" /></SelectTrigger>
                    <SelectContent>
                      {availableRedlineTemplates.map((template) => (
                        <SelectItem key={template.template_key} value={template.template_key}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    当前封面标题：{activeRedlineTitle}
                  </p>
                  {activeRedlineTemplate.notes && (
                    <p className="mt-1 text-[11px] text-muted-foreground">{activeRedlineTemplate.notes}</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">主管部门</Label>
                  <Input value={supervisingDepartment} onChange={(e) => setSupervisingDepartment(e.target.value)} disabled={isCurrentFinalized} className="mt-1.5" placeholder="如：北京市通州区园林绿化局" />
                </div>
                <div>
                  <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">评估时间</Label>
                  <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} disabled={isCurrentFinalized} className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">评估机构</Label>
                  <Input value={evaluationOrg} onChange={(e) => setEvaluationOrg(e.target.value)} disabled={isCurrentFinalized} className="mt-1.5" placeholder={DEFAULT_EVALUATION_ORG} />
                </div>
                <div>
                  <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">第三方机构</Label>
                  <Input value={thirdPartyOrg} onChange={(e) => setThirdPartyOrg(e.target.value)} disabled={isCurrentFinalized} className="mt-1.5" placeholder="如：北京数圣会计师事务所有限公司" />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/25 p-4 space-y-3">
              <div className="section-eyebrow">②A SUMMARY · 结论汇总口径</div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="min-w-0">
                  <Label className="flex min-h-9 items-end text-xs font-mono tracking-wider uppercase leading-tight text-muted-foreground">
                    不予支持部分预算（万元）
                  </Label>
                  <Input
                    value={unsupportedBudgetWan}
                    onChange={(e) => setUnsupportedBudgetWan(e.target.value)}
                    disabled={isCurrentFinalized}
                    placeholder={conclusion === "不予支持" && project ? projectBudgetWan.toFixed(2) : "如 11.60"}
                    className="mt-1.5"
                  />
                </div>
                <div className="min-w-0">
                  <Label className="flex min-h-9 items-end text-xs font-mono tracking-wider uppercase leading-tight text-muted-foreground">
                    支持金额（万元）
                  </Label>
                  <Input
                    value={supportedBudgetWan}
                    onChange={(e) => setSupportedBudgetWan(e.target.value)}
                    disabled={isCurrentFinalized}
                    placeholder={conclusion === "予以支持" && project ? projectBudgetWan.toFixed(2) : "如 188.40"}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">备注</Label>
                <Textarea
                  value={summaryRemark}
                  onChange={(e) => setSummaryRemark(e.target.value)}
                  disabled={isCurrentFinalized}
                  rows={3}
                  maxLength={1000}
                  className="mt-1.5"
                  placeholder="如：条件成熟后另行追加；项目预算金额为 650 万元；需补充政策依据后再行申报。"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {project && <StatusPill tone="neutral" dot={false}>项目预算 {projectBudgetWan.toFixed(2)} 万元</StatusPill>}
                {budgetSummary.unsupportedWan !== null && (
                  <StatusPill tone="danger" dot={false}>不予支持 {budgetSummary.unsupportedWan.toFixed(2)} 万元</StatusPill>
                )}
                {budgetSummary.supportedWan !== null && (
                  <StatusPill tone="success" dot={false}>支持 {budgetSummary.supportedWan.toFixed(2)} 万元</StatusPill>
                )}
                {budgetGapWan !== null && Math.abs(budgetGapWan) > 0.01 && (
                  <StatusPill tone="warning" dot={false}>与项目预算差额 {budgetGapWan.toFixed(2)} 万元</StatusPill>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                提示：选择“予以支持 / 不予支持”后，可直接沿用项目预算自动换算；“部分支持”时填任一金额即可由系统推算另一项。
              </p>
            </div>
            <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
              <Button variant="hero" onClick={generate} disabled={!project || generating} className="w-full justify-center">
                <Sparkles className="h-4 w-4" />
                {generating ? "AI 撰写中…" : "AI 一键生成报告"}
              </Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                确认封面信息、结论口径后生成报告；生成后可在右侧正文继续编辑。
              </p>
            </div>
                </TabsContent>

                <TabsContent value="actions" className="mt-4 space-y-4">
              {isCurrentFinalized && (
                <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[11px] text-muted-foreground">
                  当前载入的是已定稿报告，正文和封面信息已锁定。如需继续修改，请重新生成新草稿或载入其他草稿记录。
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/25 p-3 space-y-3">
                <div className="section-eyebrow">TOOLS · 草稿与智能辅助</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button onClick={resetDraft} disabled={!project || (!content && !currentReportId && !conclusion)} variant="outline" className="w-full justify-center">
                  <FileText className="h-4 w-4" />
                  新建空白草稿
                </Button>
                <Button onClick={generateRect} disabled={!content || generatingRect || isCurrentFinalized} variant="outline" className="w-full justify-center">
                  <Lightbulb className="h-4 w-4" />
                  {generatingRect ? "AI 生成中…" : "AI 生成整改建议"}
                </Button>
                <Button onClick={openRewriteForSelection} disabled={!content || isCurrentFinalized} variant="outline" className="w-full justify-center">
                  <Wand2 className="h-4 w-4" /> AI 段落重写
                </Button>
                <Button onClick={openProofingPreview} disabled={!content} variant={proofing ? "hero" : "outline"} className="w-full justify-center">
                  <Stamp className="h-4 w-4" /> {proofing ? "刷新套红预览" : "套红试印预览"}
                </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/25 p-3 space-y-3">
                <div className="section-eyebrow">DELIVERY · 保存与交付</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button onClick={() => save("draft")} disabled={!content || saving || isCurrentFinalized} variant="outline" size="sm" className="w-full justify-center">
                  <Save className="h-4 w-4" /> 保存草稿
                </Button>
                <Button onClick={archive} disabled={!currentReportId || archiving} variant="outline" size="sm" className="w-full justify-center">
                  <ArchiveIcon className="h-4 w-4" /> 归档
                </Button>
                <Button onClick={() => setShareOpen(true)} disabled={!currentReportId} variant="outline" size="sm" className="w-full justify-center">
                  <Share2 className="h-4 w-4" /> 安全外发
                </Button>
                <Button
                  onClick={exportStandardReport}
                  disabled={!content || !project}
                  variant="hero"
                  size="sm"
                  title="导出标准评估报告（附件 10-1）"
                  className="h-auto min-h-9 w-full justify-center whitespace-normal text-center leading-5 sm:col-span-2"
                >
                  <FileText className="h-4 w-4" /> 导出标准报告
                </Button>
                </div>
              </div>

            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <SectionHeader eyebrow="HISTORY" title="生成记录" count={history.length} icon={History} />
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无生成记录。现在切换项目后默认保持空白，不会再自动带出旧的演示/历史内容。</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-auto">
                  {history.map((r) => {
                    const isActive = currentReportId === r.id;
                    return (
                      <div
                        key={r.id}
                        className={`rounded-md border p-2.5 text-xs transition-all ${
                          isActive ? "border-accent bg-accent/8" : "border-border hover:border-accent/40 hover:bg-accent/4"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => loadReport(r)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono tabular-nums text-foreground">{new Date(r.created_at).toLocaleString()}</span>
                              <StatusPill tone={r.status === "finalized" ? "success" : "neutral"} dot={false}>
                                {r.status === "finalized" ? "已定稿" : "草稿"}
                              </StatusPill>
                            </div>
                            <div className="mt-1 truncate text-muted-foreground">{r.conclusion ?? "未结论"} · 点击继续使用</div>
                          </button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            title="删除该生成记录"
                            onClick={() => void deleteReportRecord(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
                </TabsContent>
              </Tabs>
          </CardContent>
          </Card>

        {/* 右侧：报告 + 整改 Tabs */}
          <Card className="surface-card min-w-0 xl:self-start xl:overflow-hidden">
            <CardContent className="flex flex-col p-6">
              <div className="flex flex-col">
              <div className="inline-flex w-fit rounded-full border border-border bg-muted/50 p-1 shadow-inner">
                <button
                  type="button"
                  onClick={() => setActiveTab("report")}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    activeTab === "report"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  报告正文
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("rect")}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    activeTab === "rect"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  整改建议
                  {rects.length > 0 && (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
                      {adopted.size}/{rects.length}
                    </span>
                  )}
                </button>
              </div>

              {activeTab === "report" && (
              <div className="mt-4">
                <div
                  ref={reportPrintAreaRef}
                  id="report-print-area"
                  className="overflow-x-auto rounded-lg border border-border bg-gradient-to-br from-card to-muted/30 p-3 sm:p-6 xl:h-[calc(100vh-16rem)] xl:min-h-0 xl:overflow-auto"
                >
                  {content ? (
                    <article className="w-full font-display">
                      <WatermarkOverlay>
                        {!proofing && project && (
                          <div className="mb-4 bg-muted/15 p-3 sm:p-4">
                            <div className={reportDocumentPageClasses}>
                              <div className={`${reportDocumentPageInnerClasses} relative min-h-[780px]`}>
                                <div className="pt-12 text-center">
                                  <h1 className="mx-auto max-w-[560px] text-[26px] font-bold leading-relaxed text-black">
                                    {activeRedlineTitle}
                                  </h1>
                                </div>
                                <div className="mt-64 space-y-5 text-[18px] font-bold leading-[2.15] text-black">
                                  {coverRows.map((row) => (
                                    <div key={row.label} className="grid grid-cols-[120px_1fr] items-end gap-4">
                                      <span className="text-right">{row.label}：</span>
                                      <span className="min-w-0 border-b border-black px-4 text-center">{row.value}</span>
                                    </div>
                                  ))}
                                  <div className="grid grid-cols-[120px_1fr] items-end gap-4">
                                    <span className="text-right">评估时间：</span>
                                    <span className="border-b border-black px-4 text-center">
                                      {reportDateParts.year} 年 {reportDateParts.month} 月 {reportDateParts.day} 日
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {proofing && project && (
                          <div className="mb-4 bg-muted/15 p-3 sm:p-4">
                            <div className={reportDocumentPageClasses}>
                              <div className={`${reportDocumentPageInnerClasses} relative min-h-[780px]`}>
                                <div className="mb-10 border-b-4 border-red-700 pb-5 text-center">
                                  <div className="text-[28px] font-bold tracking-[0.18em] text-red-700">套红试印稿</div>
                                  <div className="mt-3 text-[24px] font-bold leading-relaxed text-red-700">{activeRedlineTitle}</div>
                                </div>
                                <div className="mt-20 space-y-5 text-[18px] font-bold leading-[2.2] text-black">
                                  {coverRows.map((row) => (
                                    <div key={row.label} className="grid grid-cols-[110px_1fr] items-end gap-4">
                                      <span>{row.label}：</span>
                                      <span className="border-b border-black px-4 text-center">{row.value}</span>
                                    </div>
                                  ))}
                                  <div className="grid grid-cols-[110px_1fr] items-end gap-4">
                                    <span>评估时间：</span>
                                    <span className="border-b border-black px-4 text-center">
                                      {reportDateParts.year} 年 {reportDateParts.month} 月 {reportDateParts.day} 日
                                    </span>
                                  </div>
                                </div>
                                <div className="absolute bottom-24 right-20 grid h-32 w-32 place-items-center rounded-full border-[5px] border-red-600 text-center text-lg font-bold leading-tight text-red-600 rotate-[-12deg]">
                                  {evaluationOrg || DEFAULT_EVALUATION_ORG}<br />公章
                                </div>
                                <div className="absolute bottom-12 left-14 text-sm text-muted-foreground">
                                  模板：{activeRedlineTemplate.name}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              {proofingDirty && (
                                <Button size="sm" variant="outline" onClick={restoreProofingSnapshot}>
                                  撤销试印修改
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={clearProofingState}>
                                退出套红预览
                              </Button>
                            </div>
                          </div>
                        )}
                        {generating ? (
                          <div className="bg-muted/15 p-3 sm:p-4">
                            <div className={reportDocumentPageClasses}>
                              <div className={reportDocumentPageInnerClasses}>
                                <MarkdownView content={content} cursor variant="document" />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <RichTextEditor
                            value={content}
                            onChange={setContent}
                            onSelectionChange={setSelectedRewriteText}
                            editable={!isCurrentFinalized}
                            variant="document"
                          />
                        )}
                      </WatermarkOverlay>
                    </article>
                  ) : (
                    <EmptyState icon={FileText} title="报告将在此生成" hint="选择评估对象后，点击左侧『AI 一键生成报告』" />
                  )}
                </div>
              </div>
              )}

              {activeTab === "rect" && (
              <div className="mt-4">
                <div
                  ref={rectViewportRef}
                  className="overflow-x-auto rounded-lg border border-border bg-gradient-to-br from-card to-muted/30 p-6 xl:h-[calc(100vh-16rem)] xl:min-h-0 xl:overflow-auto"
                >
                  {rects.length === 0 ? (
                    <EmptyState icon={Lightbulb} title="尚无整改建议" hint="生成报告正文后，点击左侧『AI 生成整改建议』。AI 将自动注入评估方案、现场调研结论、缺漏材料清单按指标维度分章节生成。" />
                  ) : (
                    <div className="space-y-6">
                      {/* 整改建议选择工具条 */}
                      <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground shrink-0">SELECTION</span>
                        <StatusPill tone={adopted.size === rects.length ? "success" : adopted.size === 0 ? "neutral" : "warning"} dot={false}>
                          已选择 {adopted.size}/{rects.length}
                        </StatusPill>
                        {adoptedSavedAt && (
                          <StatusPill tone="success" dot={false}>
                            <CheckCircle2 className="h-3 w-3 mr-1" />已记录 · {adoptedSavedAt}
                          </StatusPill>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => setAdopted(new Set(rects.map(rectKey)))}>全选</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => setAdopted(new Set())}>清空</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            disabled={pushingTasks || adopted.size === 0}
                            onClick={pushAdoptedToTasks}>
                            <ListTodo className="h-3.5 w-3.5" />
                            {pushingTasks ? "推送中…" : "推送为工作任务"}
                          </Button>
                        </div>
                      </div>
                      {/* 上下文注入快照 */}
                      {rectInjected && (
                        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2.5 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent shrink-0">CONTEXT INJECTED</span>
                          {rectInjected.indicator_count > 0 && (
                            <StatusPill tone="info" dot={false}>指标体系 {rectInjected.indicator_count}项</StatusPill>
                          )}
                          {rectInjected.plan && <StatusPill tone="success" dot={false}>评估方案 ✓</StatusPill>}
                          {rectInjected.field_records_count > 0 && (
                            <StatusPill tone="gold" dot={false}>现场调研 ×{rectInjected.field_records_count}</StatusPill>
                          )}
                          {rectInjected.missing_present && <StatusPill tone="danger" dot={false}>缺漏材料 ✓</StatusPill>}
                        </div>
                      )}
                      {/* 按指标维度动态分组 */}
                      {Array.from(new Set(rects.map(r => r.category))).map((cat) => {
                        const list = rects.filter((r) => r.category === cat);
                        if (!list.length) return null;
                        return (
                          <div key={cat}>
                            <h4 className="font-display font-bold text-foreground border-b border-accent/30 pb-2 mb-3 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-accent" />
                              <span>{cat}</span>
                              <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">[{list.length.toString().padStart(2, "0")}]</span>
                            </h4>
                            <div className="space-y-3">
                              {list.map((r, i) => {
                                const meta = PRIORITY_META[r.priority];
                                const k = rectKey(r);
                                const isAdopted = adopted.has(k);
                                return (
                                  <div key={i} className={`rounded-md border p-4 transition-colors flex gap-3 ${
                                    isAdopted ? "border-success/40 bg-success/5" : "border-border bg-card hover:border-accent/40"
                                  }`}>
                                    <Checkbox
                                      checked={isAdopted}
                                      disabled={isCurrentFinalized}
                                      onCheckedChange={(v) => {
                                        setAdopted((prev) => {
                                          const next = new Set(prev);
                                          if (v) next.add(k); else next.delete(k);
                                          return next;
                                        });
                                      }}
                                      className="mt-1 shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                                        <span className="font-display font-bold text-sm text-foreground">{r.title}</span>
                                        {isAdopted && <StatusPill tone="success" dot={false}><CheckCircle2 className="h-3 w-3" /></StatusPill>}
                                        <span className="ml-auto text-[11px] font-mono text-muted-foreground">{r.responsible}</span>
                                      </div>
                                      <p className="text-sm text-foreground/80 leading-relaxed">{r.detail}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              )}

              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <RewriteBlockDialog
        open={rewriteOpen} onOpenChange={setRewriteOpen}
        block={rewriteBlock} context={content} project={project}
        onApply={async (txt, sourceText) => {
          const applied = applyRewrite(txt, sourceText);
          if (!applied) return false;
          if (currentReportId) await snapshotVersion(currentReportId, "ai", "AI 段落重写");
          return true;
        }}
      />
      {currentReportId && (
        <ShareLinkDialog open={shareOpen} onOpenChange={setShareOpen} reportId={currentReportId} />
      )}
      <ConfirmDialog />
    </>
  );
};

export default Reports;

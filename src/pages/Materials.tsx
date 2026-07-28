import { useEffect, useMemo, useState, useRef } from "react";
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
import { Plus, Upload, Check, X, Trash2, FileText, Sparkles, Download, FileSearch, FolderOpen, Radar, Layers, Link2, ChevronDown, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { StatusPill, EmptyState } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { safeStorageFileName } from "@/lib/storagePath";
import { useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";

interface Project { id: string; name: string; evaluation_system_id: string | null; category: string | null; }
interface Indicator {
  id: string; code: string | null; name: string; weight: number;
  required_materials: string | null; sort_order: number;
}
interface Material {
  id: string; project_id: string; category: string; name: string; required: boolean;
  status: "missing" | "received" | "approved" | "rejected";
  file_path: string | null; file_name: string | null; review_note: string | null;
  indicator_id: string | null;
  created_by: string;
}
interface MaterialGroup {
  key: string;
  primary: Material;
  entries: Material[];
  files: Material[];
  pendingFiles: Material[];
  reviewedFiles: Material[];
  placeholders: Material[];
}

const PRESET_CATEGORIES = [
  "项目单位需填报的资料",
  "背景及发展规划",
  "申请材料",
  "预算测算材料",
  "与项目设立和预算有关的其他材料",
  "政策背景类",
  "政策文本类",
  "测算论证类",
  "实施保障类",
  "绩效目标类",
  "其他",
];
interface MaterialIndicatorLink {
  indicator_id: string;
  relevance: number;
  source: string;
}

// 项目类标准清单（对应交流稿附件 2-1）
const TEMPLATE_PROJECT: { category: string; name: string; required: boolean }[] = [
  { category: "项目单位需填报的资料", name: "事前绩效评估项目申报书", required: true },
  { category: "项目单位需填报的资料", name: "事前绩效评估绩效目标申报表", required: true },
  { category: "项目单位需填报的资料", name: "事前绩效评估预期绩效报告", required: true },
  { category: "背景及发展规划", name: "国家及北京市相关法律、法规和规章制度", required: true },
  { category: "背景及发展规划", name: "国家及北京市确定的大政方针、政策", required: true },
  { category: "背景及发展规划", name: "部门或行业的发展规划（计划）", required: true },
  { category: "申请材料", name: "实施方案", required: true },
  { category: "申请材料", name: "可行性研究报告", required: true },
  { category: "申请材料", name: "立项专家论证意见", required: true },
  { category: "申请材料", name: "初步设计资料或总体设计、初步设计图纸", required: true },
  { category: "预算测算材料", name: "项目预算及明细、项目预算测算说明", required: true },
  { category: "预算测算材料", name: "主要材料、设备的名称、型号、规格品牌、生产厂家、价格及依据", required: true },
  { category: "预算测算材料", name: "工程预算定额、取费标准及行业主管部门制定的相关专业定额", required: true },
  { category: "预算测算材料", name: "反映测算依据的其他相关文件规定", required: true },
  { category: "与项目设立和预算有关的其他材料", name: "与项目设立和预算有关的其他材料", required: true },
];

// 政策类标准清单（对应交流稿附件 2-2）
const TEMPLATE_POLICY: { category: string; name: string; required: boolean }[] = [
  { category: "政策背景类", name: "政策出台背景说明", required: true },
  { category: "政策背景类", name: "上位政策依据 / 法律法规", required: true },
  { category: "政策背景类", name: "同类政策对比分析", required: false },
  { category: "政策文本类", name: "政策草案 / 实施意见", required: true },
  { category: "政策文本类", name: "政策征求意见汇总材料", required: true },
  { category: "政策文本类", name: "合法性审查意见", required: true },
  { category: "测算论证类", name: "政策资金需求测算说明", required: true },
  { category: "测算论证类", name: "受益对象 / 覆盖范围测算", required: true },
  { category: "测算论证类", name: "专家论证 / 听证意见", required: false },
  { category: "绩效目标类", name: "政策绩效目标申报表", required: true },
  { category: "绩效目标类", name: "政策绩效指标设置依据", required: true },
  { category: "实施保障类", name: "组织实施方案", required: true },
  { category: "实施保障类", name: "风险评估与防控措施", required: true },
];

// 兼容老调用：根据项目 category 智能选模板
const pickTemplate = (cat?: string | null) => {
  const c = (cat ?? "").toString();
  if (/政策|法规|制度|规定|意见|办法/.test(c)) return { kind: "policy" as const, list: TEMPLATE_POLICY };
  return { kind: "project" as const, list: TEMPLATE_PROJECT };
};
type MaterialStatusMeta = { label: string; tone: "danger" | "gold" | "success" | "warning" };

const STATUS_META: Record<Material["status"], MaterialStatusMeta> = {
  missing: { label: "缺失", tone: "danger" },
  received: { label: "已收", tone: "gold" },
  approved: { label: "已通过", tone: "success" },
  rejected: { label: "已驳回", tone: "warning" },
};
const PARTIAL_APPROVED_META: MaterialStatusMeta = { label: "部分通过", tone: "warning" };
const MATERIALS_LAST_PROJECT_KEY = "materials:last-project-id";

// 推断分类：根据资料名称匹配关键词
const inferCategory = (name: string): string => {
  if (/(申报书|绩效目标申报表|预期绩效报告)/.test(name)) return "项目单位需填报的资料";
  if (/(法律|法规|规章制度|政策|发展规划|规划（计划）|规划\(计划\)|方针)/.test(name)) return "背景及发展规划";
  if (/(实施方案|可行性研究报告|论证意见|初步设计|总体设计|图纸)/.test(name)) return "申请材料";
  if (/(预算|测算|材料|设备|规格|品牌|生产厂家|价格|定额|取费标准)/.test(name)) return "预算测算材料";
  if (/其他材料/.test(name)) return "与项目设立和预算有关的其他材料";
  return "其他";
};

const splitIndicatorRequiredMaterials = (value?: string | null) =>
  (value ?? "")
    .split(/[,，;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const fallbackIndicatorMaterialName = (indicator: Pick<Indicator, "code" | "name">) =>
  `${indicator.code ? `[${indicator.code}] ` : ""}${indicator.name}佐证材料`;

const isUnclassifiedMaterial = (material: Pick<Material, "category" | "name">) =>
  material.category === "其他" && material.name.startsWith("待人工确认资料：");

const logicalMaterialKey = (material: Pick<Material, "project_id" | "category" | "name">) =>
  isUnclassifiedMaterial(material)
    ? `${material.project_id}::${material.category}::待人工确认资料`
    : `${material.project_id}::${material.category}::${material.name.trim()}`;

const TEMPLATE_ORDER = new Map(
  [...TEMPLATE_PROJECT, ...TEMPLATE_POLICY].map((item, index) => [
    `${item.category}::${item.name.trim()}`,
    index,
  ]),
);

const materialPriority = (material: Material) => {
  const statusScore = material.status === "approved"
    ? 4
    : material.status === "received"
      ? 3
      : material.status === "rejected"
        ? 2
        : 1;
  return statusScore * 100 + (material.file_path ? 10 : 0) + (material.required ? 1 : 0);
};

const materialDisplayOrder = (material: Material) => {
  const templateRank = TEMPLATE_ORDER.get(`${material.category}::${material.name.trim()}`);
  if (templateRank !== undefined) return templateRank;
  const categoryRank = PRESET_CATEGORIES.indexOf(material.category);
  const safeCategoryRank = categoryRank === -1 ? PRESET_CATEGORIES.length : categoryRank;
  return 10_000 + safeCategoryRank * 1_000;
};

const isReviewedStatus = (status: Material["status"]) =>
  status === "approved" || status === "rejected";

const getMaterialGroupStatusMeta = (group: Pick<MaterialGroup, "files" | "pendingFiles" | "reviewedFiles">): MaterialStatusMeta => {
  if (!group.files.length) return STATUS_META.missing;
  if (group.pendingFiles.length) return STATUS_META.received;

  const approvedCount = group.reviewedFiles.filter((item) => item.status === "approved").length;
  const rejectedCount = group.reviewedFiles.filter((item) => item.status === "rejected").length;

  if (approvedCount > 0 && rejectedCount > 0) return PARTIAL_APPROVED_META;
  if (approvedCount > 0) return STATUS_META.approved;
  if (rejectedCount > 0) return STATUS_META.rejected;
  return STATUS_META[group.files[0].status];
};

const normalizeMatcherText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[（）()\[\]【】《》“”"'、,，:：;；!！?？._\-\s/\\]/g, "");

const extractMatcherKeywords = (value: string) =>
  Array.from(new Set(
    value
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[（）()\[\]【】《》“”"'、,，:：;；!！?？._\-\s/\\]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  ));

const INDICATOR_MATERIAL_INTENT_RULES: Array<{ indicator: RegExp[]; material: RegExp[]; score: number }> = [
  { indicator: [/必要性|立项|依据|政策/], material: [/申报|立项|政策|法律|法规|规划|专家论证|论证意见|背景/], score: 32 },
  { indicator: [/经济性|投入|成本|预算|测算|资金|筹资|合规/], material: [/预算|测算|明细|报价|询价|合同|采购|资金|绩效目标|支出|费用/], score: 36 },
  { indicator: [/绩效目标|目标|合理性|指标/], material: [/绩效目标|目标申报|目标表|绩效指标|预期绩效|绩效报告/], score: 36 },
  { indicator: [/可行性|实施方案|实施|效率|进度/], material: [/实施方案|可行性|可研|研究报告|工作方案|计划|进度|组织实施/], score: 34 },
  { indicator: [/可持续|效益|效果|满意度|产出/], material: [/绩效|效益|效果|满意度|报告|目标|规划|可持续|承诺/], score: 30 },
];

const scoreUploadedMaterialForIndicator = (material: Material, indicator: Indicator) => {
  const indicatorTokens = extractMatcherKeywords(`${indicator.name} ${indicator.required_materials ?? ""}`);
  const indicatorText = `${indicator.name} ${indicator.required_materials ?? ""}`;
  const materialText = `${material.name} ${material.file_name ?? ""} ${material.category} ${material.review_note ?? ""}`;
  const target = normalizeMatcherText(materialText);
  const keywordHits = indicatorTokens.filter((token) => target.includes(normalizeMatcherText(token))).length;
  const intentScore = INDICATOR_MATERIAL_INTENT_RULES.reduce((sum, rule) => {
    const indicatorHit = rule.indicator.some((pattern) => pattern.test(indicatorText));
    const materialHit = rule.material.some((pattern) => pattern.test(materialText));
    return indicatorHit && materialHit ? sum + rule.score : sum;
  }, 0);
  const templateScore = MATERIAL_MATCH_RULES.reduce((sum, rule) => {
    const materialHit = rule.source.some((pattern) => pattern.test(materialText));
    const indicatorHit = rule.target.some((pattern) => pattern.test(indicatorText));
    return materialHit && indicatorHit ? sum + Math.round(rule.score / 4) : sum;
  }, 0);
  const statusBonus = material.status === "approved" ? 8 : material.status === "received" ? 5 : 1;
  return keywordHits * 12 + intentScore + templateScore + statusBonus + materialPriority(material) / 100;
};

const getPreviewKind = (fileName?: string | null) => {
  const value = String(fileName ?? "").toLowerCase();
  if (/\.pdf$/i.test(value)) return "pdf" as const;
  if (/\.(png|jpe?g|gif|webp|bmp|svg|tif?f)$/i.test(value)) return "image" as const;
  return "text" as const;
};

const isDocxFile = (fileName?: string | null) => /\.docx$/i.test(String(fileName ?? ""));
const isLegacyDocFile = (fileName?: string | null) => /\.doc$/i.test(String(fileName ?? ""));

const getPreviewLabel = (fileName?: string | null, kind: "text" | "pdf" | "image" = "text") => {
  const value = String(fileName ?? "").toLowerCase();
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "图片";
  if (/\.(doc|docx|docm|dotx?)$/i.test(value)) return "Word";
  if (/\.(xls|xlsx|xlsm|csv)$/i.test(value)) return "表格";
  return "正文";
};

const unclassifiedMaterialName = (fileName: string) => {
  const baseName = fileName.replace(/\.[^.]+$/i, "").trim() || fileName.trim() || "未识别资料";
  return `待人工确认资料：${baseName}`;
};

const MATERIAL_MATCH_RULES: Array<{
  label: string;
  source: RegExp[];
  target: RegExp[];
  category?: RegExp[];
  score: number;
}> = [
  {
    label: "项目申报书",
    source: [/项目申报书/, /申报文本/, /项目申报/, /申报材料/, /项目申报表/, /项目文本/],
    target: [/项目申报书/, /事前绩效评估项目申报书/],
    category: [/项目单位需填报/],
    score: 86,
  },
  {
    label: "绩效目标申报表",
    source: [/绩效目标/, /目标申报/, /目标表/, /绩效指标/, /目标设置/],
    target: [/绩效目标申报表/, /绩效目标/],
    category: [/绩效目标/],
    score: 86,
  },
  {
    label: "预期绩效报告",
    source: [/预期绩效/, /绩效报告/, /事前绩效报告/, /财政支出.*绩效报告/],
    target: [/预期绩效报告/, /绩效报告/],
    category: [/项目单位需填报/],
    score: 84,
  },
  {
    label: "政策法规依据",
    source: [/法律/, /法规/, /规章/, /制度/, /政策/, /大政方针/, /上位政策/, /办法/, /意见/],
    target: [/法律/, /法规/, /规章制度/, /大政方针/, /政策/],
    category: [/背景及发展规划/, /政策背景/],
    score: 68,
  },
  {
    label: "发展规划",
    source: [/发展规划/, /规划计划/, /行业规划/, /部门规划/, /专项规划/, /十四五/],
    target: [/发展规划/, /规划（计划）/, /规划\(计划\)/],
    category: [/背景及发展规划/],
    score: 76,
  },
  {
    label: "实施方案",
    source: [/实施方案/, /建设方案/, /工作方案/, /组织实施/, /实施计划/],
    target: [/实施方案/, /组织实施方案/],
    category: [/申请材料/, /实施保障/],
    score: 88,
  },
  {
    label: "可行性研究报告",
    source: [/可行性/, /可研/, /研究报告/],
    target: [/可行性研究报告/],
    category: [/申请材料/],
    score: 90,
  },
  {
    label: "专家论证意见",
    source: [/专家论证/, /论证意见/, /评审意见/, /专家意见/, /专家会/],
    target: [/专家论证意见/, /论证意见/],
    category: [/申请材料/, /测算论证/],
    score: 84,
  },
  {
    label: "设计资料",
    source: [/初步设计/, /总体设计/, /设计图纸/, /图纸/, /设计方案/],
    target: [/初步设计/, /总体设计/, /图纸/],
    category: [/申请材料/],
    score: 84,
  },
  {
    label: "预算测算说明",
    source: [/预算明细/, /预算表/, /预算测算/, /测算说明/, /资金测算/, /预算说明/, /经费明细/, /费用明细/, /预算明细表/],
    target: [/项目预算及明细/, /预算测算说明/, /预算/, /测算/],
    category: [/预算测算/],
    score: 88,
  },
  {
    label: "价格依据",
    source: [/市场询价/, /询价单/, /报价单/, /中标价/, /政府采购网/, /采购网/, /价格依据/, /同类项目/, /市场价/, /造价/, /清单价/],
    target: [/主要材料/, /设备/, /规格/, /品牌/, /价格/, /依据/, /项目预算及明细/],
    category: [/预算测算/],
    score: 82,
  },
  {
    label: "定额取费标准",
    source: [/定额/, /取费标准/, /工程预算/, /造价依据/, /行业主管部门/],
    target: [/定额/, /取费标准/, /专业定额/],
    category: [/预算测算/],
    score: 82,
  },
  {
    label: "测算依据文件",
    source: [/测算依据/, /相关文件规定/, /文件规定/, /依据材料/],
    target: [/反映测算依据/, /其他相关文件规定/],
    category: [/预算测算/],
    score: 76,
  },
  {
    label: "其他佐证材料",
    source: [/其他材料/, /补充材料/, /佐证材料/, /附件/],
    target: [/其他材料/, /有关的其他材料/],
    category: [/其他材料/],
    score: 58,
  },
];

const compactMatchText = (value: string) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\s\u3000，,。.；;、:：()\[\]【】《》“”"'`!?？！._\-\\/]+/g, "");

const hasAnyPattern = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value));

const summarizeFileForMatching = async (file: File) => {
  const name = file.name || "";
  const lower = name.toLowerCase();
  try {
    if (/\.(txt|csv|md|json)$/i.test(lower) || /^text\//.test(file.type)) {
      return (await file.text()).slice(0, 24_000);
    }
    if (/\.docx$/i.test(lower)) {
      const mammoth = await import("mammoth/mammoth.browser");
      const result = await (mammoth as any).extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return String(result?.value ?? "").slice(0, 24_000);
    }
    if (/\.(xlsx|xls|xlsm)$/i.test(lower)) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      return workbook.SheetNames.slice(0, 3).map((sheetName) => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false }) as unknown[][];
        return rows.slice(0, 60).map((row) => row.slice(0, 12).join(" ")).join("\n");
      }).join("\n").slice(0, 24_000);
    }
  } catch (error) {
    console.warn("smart upload text extraction failed", error);
  }
  return "";
};

const Materials = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [miMap, setMiMap] = useState<Record<string, string[]>>({}); // material_id -> indicator_id[]
  const [miMeta, setMiMeta] = useState<Record<string, MaterialIndicatorLink[]>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "项目单位需填报的资料", name: "", required: true, indicator_id: "none" });
  const [reviewing, setReviewing] = useState<Material | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [aiMatching, setAiMatching] = useState(false);
  const [linkOpen, setLinkOpen] = useState<Material | null>(null);
  const [linkSel, setLinkSel] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<Material | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIssue, setPreviewIssue] = useState("");
  const [previewKind, setPreviewKind] = useState<"text" | "pdf" | "image">("text");
  const [smartUploading, setSmartUploading] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [reviewedSelectionMode, setReviewedSelectionMode] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const previewObjectUrlRef = useRef<string | null>(null);

  const activeProject = projects.find(p => p.id === projectId);

  const clearPreviewObjectUrl = () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  };

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id,name,evaluation_system_id,category").order("created_at", { ascending: false });
    const list = (data as Project[]) ?? [];
    setProjects(list);
    if (list.length && !projectId) {
      const savedProjectId = window.localStorage.getItem(MATERIALS_LAST_PROJECT_KEY);
      const savedProject = savedProjectId ? list.find((project) => project.id === savedProjectId) : null;
      let nextProject = savedProject ?? null;
      if (!nextProject) {
        const { data: materialRows } = await supabase
          .from("materials")
          .select("project_id,file_path")
          .not("file_path", "is", null);
        const projectIdsWithFiles = new Set((materialRows ?? []).map((row: any) => row.project_id));
        nextProject = list.find((project) => projectIdsWithFiles.has(project.id)) ?? list[0];
      }
      if (nextProject) setProjectId(nextProject.id);
    }
  };

  const loadIndicators = async () => {
    if (!activeProject?.evaluation_system_id) { setIndicators([]); return; }
    const indRes = await supabase.from("evaluation_indicators")
      .select("id,code,name,weight,required_materials,sort_order")
      .eq("system_id", activeProject.evaluation_system_id)
      .order("sort_order", { ascending: true });
    setIndicators((indRes.data as Indicator[]) ?? []);
  };

  const loadMaterials = async () => {
    if (!projectId) return setMaterials([]);
    const { data: pub, error: pubErr } = await supabase.rpc("get_materials_public", { _project_id: projectId });
    if (pubErr) { toast.error(pubErr.message); return; }
    const { data: mine } = await supabase
      .from("materials").select("*").eq("project_id", projectId);
    const mineMap = new Map((mine ?? []).map((m: any) => [m.id, m]));
    const merged: Material[] = (pub ?? []).map((m: any) => {
      const full = mineMap.get(m.id);
      return {
        ...m,
        review_note: full?.review_note ?? null,
        created_by: full?.created_by ?? "",
        indicator_id: full?.indicator_id ?? null,
      };
    }).sort((a: Material, b: Material) => a.name.localeCompare(b.name));
    setMaterials(merged);
    // 加载多对多关联
    const ids = merged.map(m => m.id);
    if (ids.length) {
      const { data: mi } = await supabase.from("material_indicators")
        .select("material_id,indicator_id,relevance,source").in("material_id", ids);
      const map: Record<string, string[]> = {};
      const meta: Record<string, MaterialIndicatorLink[]> = {};
      (mi ?? []).forEach((r: any) => {
        (map[r.material_id] ||= []).push(r.indicator_id);
        (meta[r.material_id] ||= []).push({
          indicator_id: r.indicator_id,
          relevance: Number(r.relevance || 0),
          source: String(r.source || "manual"),
        });
      });
      // 把 materials.indicator_id（主关联）也并入，避免遗漏
      merged.forEach(m => {
        if (m.indicator_id) {
          map[m.id] = Array.from(new Set([...(map[m.id] ?? []), m.indicator_id]));
        }
      });
      setMiMap(map);
      setMiMeta(meta);
    } else {
      setMiMap({});
      setMiMeta({});
    }
  };

  const indicatorsOf = (m: Material): string[] => miMap[m.id] ?? (m.indicator_id ? [m.indicator_id] : []);
  const openLinkDialog = (m: Material) => {
    setLinkOpen(m);
    setLinkSel(new Set(indicatorsOf(m)));
  };

  const saveLinks = async () => {
    if (!linkOpen || !user) return;
    const m = linkOpen;
    const wanted = new Set(linkSel);
    const current = new Set(indicatorsOf(m));
    const toAdd = [...wanted].filter(x => !current.has(x));
    const toDel = [...current].filter(x => !wanted.has(x));
    try {
      if (toAdd.length) {
        const { error } = await supabase.from("material_indicators").insert(
          toAdd.map(indicator_id => ({ material_id: m.id, indicator_id, created_by: user.id }))
        );
        if (error) throw error;
      }
      if (toDel.length) {
        const { error } = await supabase.from("material_indicators")
          .delete().eq("material_id", m.id).in("indicator_id", toDel);
        if (error) throw error;
      }
      // 同步主关联：取第一个；若没有则置 null
      const newMain = wanted.size ? [...wanted][0] : null;
      await supabase.from("materials").update({ indicator_id: newMain }).eq("id", m.id);
      toast.success(`已关联 ${wanted.size} 个指标`);
      setLinkOpen(null); setLinkSel(new Set());
      loadMaterials();
    } catch (e: any) {
      toast.error(e?.message ?? "保存失败");
    }
  };

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => {
    setSelectedFileIds(new Set());
    setReviewedSelectionMode(false);
    loadMaterials();
    loadIndicators();
    /* eslint-disable-next-line */
  }, [projectId, activeProject?.evaluation_system_id]);

  const addOne = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !projectId) return;
    if (!form.name.trim()) return toast.error("资料名称必填");
    const { error } = await supabase.from("materials").insert({
      project_id: projectId, category: form.category, name: form.name.trim(),
      required: form.required, status: "missing", created_by: user.id,
      indicator_id: form.indicator_id !== "none" ? form.indicator_id : null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("已添加"); setOpen(false);
      setForm({ category: "项目单位需填报的资料", name: "", required: true, indicator_id: "none" });
      loadMaterials();
    }
  };

  const createMissingTemplateMaterials = async (): Promise<Material[]> => {
    if (!user || !projectId) return [];
    const tpl = pickTemplate(activeProject?.category);
    const existing = new Set(materials.map(m => `${m.category}::${m.name.trim()}`));
    const toAdd = tpl.list.filter(t => !existing.has(`${t.category}::${t.name.trim()}`)).map(t => ({
      project_id: projectId, category: t.category, name: t.name, required: t.required,
      status: "missing" as const, created_by: user.id,
    }));
    if (!toAdd.length) return [];
    const { data, error } = await supabase.from("materials").insert(toAdd).select("*");
    if (error) throw error;
    return (data as Material[]) ?? [];
  };

  const addTemplate = async () => {
    try {
      const inserted = await createMissingTemplateMaterials();
      if (!inserted.length) return toast.info("标准清单已全部存在");
      const tpl = pickTemplate(activeProject?.category);
      toast.success(`已加载${tpl.kind === "policy" ? "政策类（附件 2-2）" : "项目类（附件 2-1）"}标准清单 · 新增 ${inserted.length} 项`);
    } catch (e: any) {
      toast.error(e?.message ?? "加载标准清单失败");
    }
    loadMaterials();
  };

  // 🔑 Step 7 核心：按当前评估指标体系自动生成应交资料清单
  const syncFromIndicators = async () => {
    if (!user || !projectId) return;
    if (!activeProject?.evaluation_system_id) {
      return toast.error("当前项目尚未关联评估指标体系，请先在『评估对象管理』中选择");
    }
    if (!indicators.length) {
      return toast.error("当前体系暂无指标，请先在『评估指标体系』中加载预设或新建指标");
    }
    const existing = new Set<string>();
    materials.forEach((material) => {
      const linkedIndicatorIds = [...indicatorsOf(material)];
      if (material.indicator_id && !linkedIndicatorIds.includes(material.indicator_id)) {
        linkedIndicatorIds.push(material.indicator_id);
      }
      linkedIndicatorIds.forEach((indicatorId) => {
        existing.add(`${indicatorId}::${material.name.trim()}`);
      });
    });
    const toAdd: any[] = [];
    indicators.forEach(ind => {
      const materialNames = splitIndicatorRequiredMaterials(ind.required_materials);
      const hasAnyLinkedMaterial = materials.some((material) => indicatorsOf(material).includes(ind.id));
      const namesToCreate = materialNames.length
        ? materialNames
        : hasAnyLinkedMaterial
          ? []
          : [fallbackIndicatorMaterialName(ind)];

      namesToCreate.forEach(name => {
        const key = `${ind.id}::${name}`;
        if (existing.has(key)) return;
        existing.add(key);
        toAdd.push({
          project_id: projectId,
          indicator_id: ind.id,
          category: inferCategory(name),
          name, required: true, status: "missing",
          created_by: user.id,
        });
      });
    });
    if (!toAdd.length) {
      const linkedIndicatorCount = indicators.filter((indicator) =>
        materials.some((material) => indicatorsOf(material).includes(indicator.id)),
      ).length;
      return toast.info(
        linkedIndicatorCount
          ? `所有指标资料清单均已建立；当前已覆盖 ${linkedIndicatorCount} 项指标，未上传文件的指标会显示为「待上传」`
          : "所有指标资料清单均已建立",
      );
    }
    const { error } = await supabase.from("materials").insert(toAdd);
    if (error) toast.error(error.message);
    else {
      await loadMaterials();
      toast.success(`已按指标同步 ${toAdd.length} 项应交资料`);
    }
  };

  // AI 读取项目资料清单并将现有文件匹配到可被其证明的指标。
  const aiMatchMaterials = async () => {
    if (!user || !projectId) return;
    if (!activeProject?.evaluation_system_id) {
      return toast.error("当前项目尚未关联评估指标体系");
    }
    if (!indicators.length) {
      return toast.error("当前体系暂无指标，请先在『评估指标体系』中添加");
    }
    const uploaded = materials.filter((material) => material.file_path);
    if (!uploaded.length) {
      return toast.error("请先上传项目资料文件，再进行 AI 指标证据匹配");
    }
    setAiMatching(true);
    const t = toast.loading("AI 正在判断每份资料能够证明哪些指标…");
    try {
      let data: any = { gaps: [], timedOut: false };
      try {
        const result = await Promise.race([
          supabase.functions.invoke("check-materials-completeness", {
            body: { projectId },
          }),
          new Promise<{ data: any; error: any }>((resolve) =>
            window.setTimeout(() => resolve({ data: { gaps: [], timedOut: true }, error: null }), 15_000),
          ),
        ]);
        if (result.error) throw result.error;
        if (result.data?.error) throw new Error(result.data.error);
        data = result.data ?? data;
      } catch (invokeError) {
        console.warn("AI material matching fallback", invokeError);
        data = { gaps: [], timedOut: true };
      }

      const materialByName = new Map(materials.map((material) => [material.name.trim(), material]));
      const indicatorByName = new Map(indicators.map((indicator) => [indicator.name.trim(), indicator]));
      const materialById = new Map(materials.map((material) => [material.id, material]));
      const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator]));
      const pairs = new Map<string, { material_id: string; indicator_id: string; relevance: number; source: string; created_by: string }>();
      for (const gap of data?.gaps ?? []) {
        if (!gap?.matched_material || !["covered", "partial"].includes(gap.status)) continue;
        const matchedMaterialText = String(gap.matched_material ?? "").trim();
        const materialRefs = [
          String(gap.material_id || "").trim(),
          matchedMaterialText,
          ...matchedMaterialText.split(/[,，;；\s]+/g).map((part) => part.trim()),
        ].filter(Boolean);
        const material = materialRefs
          .map((ref) => materialById.get(ref) ?? materialByName.get(ref))
          .find((item) => item?.file_path);
        const indicator = indicatorById.get(String(gap.indicator_id || ""))
          ?? indicatorByName.get(String(gap.indicator).trim());
        if (!material?.file_path || !indicator) continue;
        const score = Math.max(0, Math.min(100, Number(gap.match_score || 0)));
        if (score < 40) continue;
        const key = `${material.id}:${indicator.id}`;
        const relation = {
          material_id: material.id,
          indicator_id: indicator.id,
          relevance: score >= 85 ? 5 : score >= 70 ? 4 : score >= 55 ? 3 : 2,
          source: "ai",
          created_by: user.id,
        };
        const previous = pairs.get(key);
        if (!previous || relation.relevance > previous.relevance) pairs.set(key, relation);
      }

      // 一个项目资料往往可以同时证明多个指标。AI 如果因为正文提取不足没有返回完整关系，
      // 这里用已上传资料做保守兜底，保证每个指标至少有一份“待复核”的证明线索。
      const linkedIndicatorIds = new Set([...pairs.values()].map((relation) => relation.indicator_id));
      const uploadedWithFiles = uploaded.filter((material) => material.file_path);
      let fallbackRelations = 0;
      for (const indicator of indicators) {
        if (linkedIndicatorIds.has(indicator.id)) continue;
        const existingManualMaterial = materials.find((material) =>
          material.file_path
          && indicatorsOf(material).includes(indicator.id)
          && (miMeta[material.id] ?? []).some((link) => link.indicator_id === indicator.id && link.source !== "ai"),
        );
        const material = existingManualMaterial
          ?? [...uploadedWithFiles].sort(
            (a, b) => scoreUploadedMaterialForIndicator(b, indicator) - scoreUploadedMaterialForIndicator(a, indicator),
          )[0];
        if (!material) continue;
        pairs.set(`${material.id}:${indicator.id}`, {
          material_id: material.id,
          indicator_id: indicator.id,
          relevance: 2,
          source: "ai",
          created_by: user.id,
        });
        linkedIndicatorIds.add(indicator.id);
        fallbackRelations += 1;
      }

      const uploadedIds = uploaded.map((material) => material.id);
      if (uploadedIds.length) {
        const { error: deleteError } = await supabase.from("material_indicators")
          .delete()
          .in("material_id", uploadedIds)
          .eq("source", "ai");
        if (deleteError) throw deleteError;
      }

      const manualPairs = new Set(
        Object.entries(miMeta).flatMap(([materialId, links]) =>
          links
            .filter((link) => link.source !== "ai")
            .map((link) => `${materialId}:${link.indicator_id}`),
        ),
      );
      const relations = [...pairs.entries()]
        .filter(([key]) => !manualPairs.has(key))
        .map(([, relation]) => relation);
      if (relations.length) {
        const { error: insertError } = await supabase.from("material_indicators").insert(relations);
        if (insertError) throw insertError;
      }
      await loadMaterials();
      const matchedRelations = [...pairs.values()];
      const coveredIndicators = new Set(matchedRelations.map((relation) => relation.indicator_id)).size;
      toast.success(
        matchedRelations.length
          ? `${data?.timedOut ? "AI 响应较慢，已先" : "AI 已"}确认 ${matchedRelations.length} 条证据关系，覆盖 ${coveredIndicators} 项指标${fallbackRelations ? "（含待复核线索）" : ""}`
          : "AI 未发现足以证明指标的现有文件，请补充更具体的资料",
        { id: t },
      );
    } catch (e: any) {
      toast.error("AI 匹配失败：" + (e?.message ?? "未知错误"), { id: t });
    } finally {
      setAiMatching(false);
    }
  };

  const indexMaterialForRag = async (materialId: string) => {
    const { data, error } = await supabase.functions.invoke("ingest-project-knowledge", {
      body: { materialId },
    });
    if (error) throw error;
    return data as { indexed?: number; skipped?: number; failed?: number; errors?: string[] } | null;
  };

  const indexProjectForRag = async (targetProjectId: string) => {
    const { data, error } = await supabase.functions.invoke("ingest-project-knowledge", {
      body: { projectId: targetProjectId, limit: 500, force: false },
    });
    if (error) throw error;
    return data as { indexed?: number; skipped?: number; failed?: number; errors?: string[] } | null;
  };

  const onFile = async (m: Material, file: File, options: { silent?: boolean; deferIndex?: boolean } = {}) => {
    if (!user) return false;
    const sanitizedName = safeStorageFileName(file.name || "资料文件");
    const path = `${user.id}/${m.project_id}/${m.id}-${sanitizedName}`;
    const inputEl = fileInputRefs.current[m.id];
    try {
      if (m.file_path && m.file_path !== path) {
        const { error: removeError } = await supabase.storage.from("project-materials").remove([m.file_path]);
        if (removeError) {
          console.warn("remove previous material file failed", removeError);
        }
      }
      const up = await supabase.storage.from("project-materials").upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
      if (up.error) throw up.error;
      const { error } = await supabase.from("materials").update({
        file_path: path,
        file_name: file.name,
        status: "received",
        review_note: null,
      }).eq("id", m.id);
      if (error) throw error;
      if (!options.deferIndex) {
        try {
          const indexResult = await indexMaterialForRag(m.id);
          if (!options.silent && Number(indexResult?.failed ?? 0) > 0) {
            toast.warning("文件已上传，但正文索引不完整；已保留文件信息级索引");
          }
        } catch (indexError) {
          console.warn("material knowledge indexing failed", indexError);
          if (!options.silent) toast.warning("文件已上传，但检索索引稍后补建");
        }
      }
      await loadMaterials();
      if (!options.silent) toast.success("上传成功");
      return true;
    } catch (e: any) {
      if (!options.silent) toast.error(e?.message ?? "上传失败");
      return false;
    } finally {
      if (inputEl) inputEl.value = "";
    }
  };

  /**
   * 单文件下载。
   *
   * 走签名链接直连虽然秒开，但 storage-js 会把 download 参数里的中文名百分号编码，
   * 存储服务原样当作文件名返回，用户拿到的是 %E5%B9%B4 这种乱码名。所以仍由浏览器
   * 端取回再另存，保证文件名正确；原先“点了没反应”的问题用进度提示解决。
   */
  const downloadFile = async (m: Material) => {
    if (!m.file_path) return;
    const fileName = m.file_name || m.name || "资料文件";
    const toastId = toast.loading(`正在下载：${fileName}`);
    try {
      const { data, error } = await supabase.storage
        .from("project-materials")
        .download(m.file_path);
      if (error || !data) throw error ?? new Error("文件下载失败");
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`已下载：${fileName}`, { id: toastId });
    } catch (error: any) {
      toast.error(error?.message ?? "下载失败", { id: toastId });
    }
  };

  /**
   * 批量下载：打包成一个 ZIP。
   *
   * 连续触发多个 <a> 下载看起来更省事，但浏览器会把它判定为“自动下载多个文件”而
   * 静默拦截，实际只落地第一个。打包成单个文件既绕开这条限制，也让用户只需确认一次。
   */
  const downloadFiles = async (list: Material[]) => {
    const targets = list.filter((item) => item.file_path);
    if (!targets.length) return toast.error("选中的资料没有可下载的文件");
    if (targets.length === 1) return downloadFile(targets[0]);

    setBulkDownloading(true);
    const toastId = toast.loading(`正在打包 1/${targets.length}…`);
    try {
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import("jszip"),
        import("file-saver"),
      ]);
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let packed = 0;
      const failed: string[] = [];

      for (const [index, material] of targets.entries()) {
        const fileName = material.file_name || material.name || `资料${index + 1}`;
        toast.loading(`正在打包 ${index + 1}/${targets.length}：${fileName}`, { id: toastId });
        try {
          const { data, error } = await supabase.storage
            .from("project-materials")
            .download(material.file_path!);
          if (error || !data) throw error ?? new Error("文件下载失败");
          // 同名文件会互相覆盖，加序号区分。
          let entryName = fileName;
          if (usedNames.has(entryName)) {
            const dot = entryName.lastIndexOf(".");
            const base = dot > 0 ? entryName.slice(0, dot) : entryName;
            const ext = dot > 0 ? entryName.slice(dot) : "";
            entryName = `${base}(${index + 1})${ext}`;
          }
          usedNames.add(entryName);
          zip.file(entryName, data);
          packed += 1;
        } catch (error) {
          console.warn("bulk download failed", fileName, error);
          failed.push(fileName);
        }
      }

      if (!packed) {
        toast.error("选中的文件都下载失败，请稍后重试", { id: toastId });
        return;
      }
      toast.loading("正在生成压缩包…", { id: toastId });
      const blob = await zip.generateAsync({ type: "blob" });
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(blob, `${activeProject?.name ?? "项目资料"}-资料文件-${stamp}.zip`);
      if (failed.length) {
        toast.warning(`已打包 ${packed}/${targets.length} 个文件；失败：${failed.slice(0, 3).join("、")}`, { id: toastId });
      } else {
        toast.success(`已打包 ${packed} 个文件并开始下载`, { id: toastId });
      }
    } catch (error: any) {
      toast.error(error?.message ?? "打包下载失败", { id: toastId });
    } finally {
      setBulkDownloading(false);
    }
  };

  const previewFile = async (m: Material) => {
    if (!m.file_path) return;
    const fileName = m.file_name ?? m.name;
    clearPreviewObjectUrl();
    setPreviewing(m);
    setPreviewLoading(true);
    setPreviewText("");
    setPreviewHtml("");
    setPreviewUrl(null);
    setPreviewIssue("");
    const kind = getPreviewKind(fileName);
    setPreviewKind(kind);
    try {
      const shouldCreateSignedUrl = kind !== "text" || isDocxFile(fileName);
      const [previewRes, signedUrlRes] = await Promise.all([
        supabase.functions.invoke("preview-material", {
          body: {
            filePath: m.file_path,
            fileName,
            reviewNote: m.review_note,
          },
        }),
        !shouldCreateSignedUrl
          ? Promise.resolve({ data: null, error: null })
          : supabase.storage.from("project-materials").createSignedUrl(m.file_path, 300),
      ]);
      const { data, error } = previewRes;
      if (error) throw error;
      if (signedUrlRes.error) {
        console.warn("create preview signed url failed", signedUrlRes.error);
      } else if (signedUrlRes.data?.signedUrl) {
        const signedUrl = signedUrlRes.data.signedUrl;
        try {
          const fileResponse = await fetch(signedUrl);
          if (!fileResponse.ok) throw new Error(`文件读取失败（${fileResponse.status}）`);
          const rawBlob = await fileResponse.blob();
          if (kind === "pdf") {
            const header = await rawBlob.slice(0, 5).text();
            if (header !== "%PDF-") {
              setPreviewIssue("该文件后缀是 PDF，但文件内容不是标准 PDF，浏览器无法在线预览。请下载原文件查看。");
            } else {
              const pdfBlob = rawBlob.type === "application/pdf" ? rawBlob : new Blob([rawBlob], { type: "application/pdf" });
              const objectUrl = URL.createObjectURL(pdfBlob);
              previewObjectUrlRef.current = objectUrl;
              setPreviewUrl(objectUrl);
            }
          } else {
            const objectUrl = URL.createObjectURL(rawBlob);
            previewObjectUrlRef.current = objectUrl;
            setPreviewUrl(objectUrl);
          }
          if (isDocxFile(fileName)) {
            try {
              const mammoth = await import("mammoth/mammoth.browser");
              const result = await mammoth.convertToHtml(
                { arrayBuffer: await rawBlob.arrayBuffer() },
                {
                  styleMap: [
                    "p[style-name='Title'] => h1:fresh",
                    "p[style-name='Heading 1'] => h1:fresh",
                    "p[style-name='Heading 2'] => h2:fresh",
                    "p[style-name='Heading 3'] => h3:fresh",
                    "p[style-name='Heading 4'] => h4:fresh",
                    "b => strong",
                    "i => em",
                  ],
                },
              );
              setPreviewHtml(DOMPurify.sanitize(result.value));
            } catch (wordError) {
              console.warn("docx preview failed", wordError);
              setPreviewIssue("该 Word 文档版式较复杂，页面内预览可能不完整。请下载原文件核对正式版式。");
            }
          }
        } catch (fileError: any) {
          console.warn("create blob preview failed", fileError);
          setPreviewIssue(fileError?.message ?? "文件在线预览失败，请下载原文件查看。");
        }
      }
      const text = String(data?.text ?? "").trim();
      if (text) {
        setPreviewText(text);
      } else if (kind === "pdf") {
        setPreviewText("当前 PDF 尚未提取到可用正文。系统会在上传后自动识别文字层；扫描版会进入受控 OCR，可稍后重新打开预览。");
      } else if (kind === "image") {
        setPreviewText("当前图片不纳入自动正文解析；可先直接预览或下载原图查看。");
      } else if (isLegacyDocFile(fileName)) {
        setPreviewText("旧版 .doc 文件浏览器无法直接还原版式；请下载原文件查看，或后续在服务器接入 LibreOffice 转 PDF 后预览。");
      } else if (isDocxFile(fileName)) {
        setPreviewText("该 Word 文档暂未提取到可预览正文，请下载原文件查看。");
      } else {
        setPreviewText("该文件暂无可提取的正文内容。");
      }
    } catch (e: any) {
      setPreviewText(e?.message ?? "预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const appendFileToGroup = async (base: Material, file: File, options: { silent?: boolean; deferIndex?: boolean } = {}) => {
    if (!user) return;
    const { data: inserted, error: insertError } = await supabase.from("materials").insert({
      project_id: base.project_id,
      category: base.category,
      name: base.name,
      required: base.required,
      status: "missing",
      created_by: user.id,
      indicator_id: base.indicator_id,
    }).select("*").single();
    if (insertError || !inserted) throw insertError ?? new Error("创建追加资料记录失败");
    const newMaterial = inserted as Material;
    const relatedIndicators = indicatorsOf(base);
    if (relatedIndicators.length) {
      const { error: linkError } = await supabase.from("material_indicators").insert(
        relatedIndicators.map((indicator_id) => ({
          material_id: newMaterial.id,
          indicator_id,
          created_by: user.id,
          source: "manual",
        })),
      );
      if (linkError) throw linkError;
    }
    const uploaded = await onFile(newMaterial, file, options);
    if (!uploaded) throw new Error("上传文件失败");
  };

  const buildLogicalMaterialList = (sourceMaterials: Material[]) => {
    const grouped = new Map<string, Material>();
    sourceMaterials.forEach((material) => {
      const key = logicalMaterialKey(material);
      const current = grouped.get(key);
      const currentScore = current
        ? materialPriority(current) + (indicatorsOf(current).length ? 5 : 0)
        : -1;
      const nextScore = materialPriority(material) + (indicatorsOf(material).length ? 5 : 0);
      if (!current || nextScore > currentScore) {
        grouped.set(key, material);
      }
    });
    return Array.from(grouped.values());
  };

  const recommendMaterialForFile = (file: File, fileSample = "", candidateMaterials = logicalMaterials) => {
    const usableCandidates = candidateMaterials.filter(
      (material) => !(material.category === "其他" && material.name.startsWith("待人工确认资料：")),
    );
    const candidates = usableCandidates.length ? usableCandidates : candidateMaterials;
    if (!candidates.length) return null;
    const sourceText = `${file.name} ${fileSample}`;
    const normalizedSource = normalizeMatcherText(sourceText);
    const compactSource = compactMatchText(sourceText);
    const fileKeywords = extractMatcherKeywords(sourceText);
    const ranked = candidates.map((material) => {
      const linkedIndicatorNames = indicatorsOf(material)
        .map((indicatorId) => indicators.find((indicator) => indicator.id === indicatorId)?.name ?? "")
        .filter(Boolean)
        .join(" ");
      const materialSearchText = `${material.name} ${material.category} ${linkedIndicatorNames}`;
      const normalizedName = normalizeMatcherText(material.name);
      const normalizedCategory = normalizeMatcherText(material.category);
      const normalizedIndicatorNames = normalizeMatcherText(linkedIndicatorNames);
      const compactMaterial = compactMatchText(materialSearchText);
      const compactCategory = compactMatchText(material.category);
      let score = 0;
      if (normalizedSource && normalizedName) {
        if (normalizedSource.includes(normalizedName) || normalizedName.includes(normalizedSource)) score += 100;
      }
      if (normalizedSource && normalizedCategory && normalizedSource.includes(normalizedCategory)) score += 18;
      if (normalizedSource && normalizedIndicatorNames && normalizedSource.includes(normalizedIndicatorNames)) score += 36;
      const materialKeywords = extractMatcherKeywords(materialSearchText);
      materialKeywords.forEach((keyword) => {
        if (fileKeywords.includes(keyword)) score += 24;
        else if (normalizedSource.includes(normalizeMatcherText(keyword))) score += 14;
      });
      MATERIAL_MATCH_RULES.forEach((rule) => {
        if (!hasAnyPattern(compactSource, rule.source)) return;
        if (hasAnyPattern(compactMaterial, rule.target)) score += rule.score;
        else if (rule.category && hasAnyPattern(compactCategory, rule.category)) {
          score += Math.round(rule.score * 0.45);
        }
      });
      if (!material.file_path) score += 10;
      if (material.required) score += 4;
      return { material, score };
    }).sort((a, b) => b.score - a.score);
    if (!ranked[0] || ranked[0].score < 28) return null;
    return ranked[0];
  };

  const createUnclassifiedMaterialForFile = async (file: File) => {
    if (!user || !projectId) throw new Error("请先选择项目");
    const name = unclassifiedMaterialName(file.name || "资料文件");
    const existing = logicalMaterials.find((material) => material.category === "其他" && material.name === name);
    if (existing) return existing;

    const { data, error } = await supabase.from("materials").insert({
      project_id: projectId,
      category: "其他",
      name,
      required: false,
      status: "missing",
      created_by: user.id,
      indicator_id: null,
    }).select("*").single();
    if (error || !data) throw error ?? new Error("创建待确认资料项失败");
    return data as Material;
  };

  const ensureSmartUploadCandidates = async () => {
    const classifiedCandidates = logicalMaterials.filter(
      (material) => !(material.category === "其他" && material.name.startsWith("待人工确认资料：")),
    );
    if (classifiedCandidates.length) return logicalMaterials;
    const inserted = await createMissingTemplateMaterials();
    if (inserted.length) {
      toast.success(`已自动建立标准资料清单 ${inserted.length} 项`);
      return buildLogicalMaterialList([...materials, ...inserted]);
    }
    return buildLogicalMaterialList(materials);
  };

  const smartUploadFile = async (file: File, options: { silent?: boolean; candidates?: Material[]; deferIndex?: boolean } = {}) => {
    const toastId = options.silent ? undefined : toast.loading("正在识别资料类型…");
    try {
      const candidates = options.candidates ?? await ensureSmartUploadCandidates();
      const fileSample = await summarizeFileForMatching(file);
      const recommendation = recommendMaterialForFile(file, fileSample, candidates);
      if (!recommendation) {
        try {
          const fallback = await createUnclassifiedMaterialForFile(file);
          if (toastId) toast.info(`未自动匹配到标准清单，已转为「${fallback.name}」上传，后续可人工确认指标`, { id: toastId });
          if (fallback.file_path) {
            await appendFileToGroup(fallback, file, { silent: options.silent, deferIndex: options.deferIndex });
            return { matched: false, materialName: fallback.name };
          }
          const uploaded = await onFile(fallback, file, { silent: options.silent, deferIndex: options.deferIndex });
          if (!uploaded) await appendFileToGroup(fallback, file, { silent: options.silent, deferIndex: options.deferIndex });
          return { matched: false, materialName: fallback.name };
        } catch (e: any) {
          if (toastId) toast.error(e?.message ?? "未能创建待确认资料项，请手动选择标准清单项上传", { id: toastId });
          if (options.silent) throw e;
          return null;
        }
      }
      const { material, score } = recommendation;
      if (toastId) toast.success(`已识别为「${material.name}」${score >= 100 ? "" : ` · 匹配度 ${score}`}`, { id: toastId });
      if (material.file_path) {
        await appendFileToGroup(material, file, { silent: options.silent, deferIndex: options.deferIndex });
        return { matched: true, materialName: material.name, score };
      }
      const uploaded = await onFile(material, file, { silent: options.silent, deferIndex: options.deferIndex });
      if (!uploaded) await appendFileToGroup(material, file, { silent: options.silent, deferIndex: options.deferIndex });
      return { matched: true, materialName: material.name, score };
    } catch (e: any) {
      if (toastId) toast.error(e?.message ?? "资料自动识别失败，请手动选择标准清单项上传", { id: toastId });
      if (options.silent) throw e;
      return null;
    }
  };

  const smartUploadFiles = async (fileList: FileList | File[]) => {
    if (!user || !projectId) return toast.error("请先选择项目");
    const files = Array.from(fileList).filter((file) => file.size > 0);
    if (!files.length) return;
    setSmartUploading(true);
    const toastId = toast.loading(`正在智能分配 ${files.length} 个文件…`);
    let success = 0;
    let failed = 0;
    let matched = 0;
    try {
      const candidates = await ensureSmartUploadCandidates();
      for (const file of files) {
        try {
          const result = await smartUploadFile(file, { silent: true, candidates, deferIndex: true });
          success += 1;
          if (result?.matched) matched += 1;
        } catch {
          failed += 1;
        }
      }
      try {
        const indexResult = await indexProjectForRag(projectId);
        if (Number(indexResult?.failed ?? 0) > 0) {
          toast.warning(`已完成上传和基础索引，${indexResult?.failed} 个文件正文未完全提取`, { duration: 5000 });
        }
      } catch (indexError) {
        console.warn("bulk project knowledge indexing failed", indexError);
        toast.warning("文件已上传，项目索引将在后台或下次报告生成时自动补建");
      }
      await loadMaterials();
      toast.success(`文件夹上传完成：成功 ${success} 个，自动匹配 ${matched} 个${failed ? `，失败 ${failed} 个` : ""}`, { id: toastId });
    } catch (e: any) {
      toast.error(e?.message ?? "文件夹上传失败", { id: toastId });
    } finally {
      setSmartUploading(false);
    }
  };

  const review = async (status: "approved" | "rejected") => {
    if (!reviewing) return;
    const { error } = await supabase.from("materials").update({
      status, review_note: reviewNote.trim() || null,
    }).eq("id", reviewing.id);
    if (error) toast.error(error.message);
    else {
      setMaterials((prev) => prev.map((item) => (
        item.id === reviewing.id
          ? { ...item, status, review_note: reviewNote.trim() || null }
          : item
      )));
      toast.success(status === "approved" ? "已通过" : "已驳回");
      setReviewing(null);
      setReviewNote("");
      await loadMaterials();
    }
  };

  const removeOne = async (m: Material) => {
    const hasUploadedFile = !!m.file_path;
    if (!(await confirm({
      title: `${hasUploadedFile ? "清空" : "删除"}资料"${m.name}"？`,
      description: hasUploadedFile
        ? "将删除已上传文件，并保留这条资料项为空待上传状态。"
        : "该资料项当前为空，删除后会真正从列表中移除。",
      destructive: true,
      confirmText: hasUploadedFile ? "清空文件" : "删除资料项",
    }))) return;
    const duplicateGroup = materials.filter((item) =>
      item.project_id === m.project_id
      && item.name === m.name
      && item.category === m.category,
    );
    const targetIds = duplicateGroup.map((item) => item.id);
    const targetPaths = Array.from(new Set(duplicateGroup.map((item) => item.file_path).filter(Boolean) as string[]));
    const prevMaterials = materials;
    const prevMiMap = miMap;
    const prevMiMeta = miMeta;
    if (hasUploadedFile) {
      setMaterials((prev) => prev.map((item) => (
        targetIds.includes(item.id)
          ? { ...item, file_path: null, file_name: null, status: "missing", review_note: null }
          : item
      )));
      setMiMap((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => { next[id] = []; });
        return next;
      });
      setMiMeta((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => { next[id] = []; });
        return next;
      });
    } else {
      setMaterials((prev) => prev.filter((item) => !targetIds.includes(item.id)));
      setMiMap((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => { delete next[id]; });
        return next;
      });
      setMiMeta((prev) => {
        const next = { ...prev };
        targetIds.forEach((id) => { delete next[id]; });
        return next;
      });
    }
    try {
      await supabase.from("material_indicators").delete().in("material_id", targetIds);
      await (supabase as any)
        .from("knowledge_files")
        .delete()
        .eq("source_type", "material")
        .in("source_id", targetIds);
      if (targetPaths.length) {
        const { error: storageError } = await supabase.storage.from("project-materials").remove(targetPaths);
        if (storageError) throw storageError;
      }
      const { error } = hasUploadedFile
        ? await supabase.from("materials").update({
          file_path: null,
          file_name: null,
          status: "missing",
          review_note: null,
        }).in("id", targetIds)
        : await supabase.from("materials").delete().in("id", targetIds);
      if (error) throw error;
      toast.success(
        hasUploadedFile
          ? targetIds.length > 1
            ? `已清空 ${targetIds.length} 条同名资料的上传文件`
            : "已清空上传文件，资料项已保留"
          : targetIds.length > 1
            ? `已删除 ${targetIds.length} 条空资料项`
            : "已删除空资料项",
      );
      loadMaterials();
    } catch (e: any) {
      setMaterials(prevMaterials);
      setMiMap(prevMiMap);
      setMiMeta(prevMiMeta);
      toast.error(e?.message ?? "删除失败");
    }
  };

  const deleteUploadedFiles = async (targets: Material[]) => {
    const uploadedTargets = targets.filter((item) => item.file_path);
    if (!uploadedTargets.length) {
      toast.info("请先选择要删除的已上传文件");
      return;
    }

    const count = uploadedTargets.length;
    if (!(await confirm({
      title: count === 1
        ? `删除文件"${uploadedTargets[0].file_name || uploadedTargets[0].name}"？`
        : `删除选中的 ${count} 个文件？`,
      description: "将删除所选文件及其指标关联；若该资料项没有其他文件，会保留为空资料项，方便后续重新上传。",
      destructive: true,
      confirmText: count === 1 ? "删除文件" : "批量删除",
    }))) return;

    const prevMaterials = materials;
    const prevMiMap = miMap;
    const prevMiMeta = miMeta;
    const targetIds = new Set(uploadedTargets.map((item) => item.id));
    const deleteIds: string[] = [];
    const clearIds: string[] = [];

    const grouped = new Map<string, Material[]>();
    materials.forEach((material) => {
      const key = logicalMaterialKey(material);
      grouped.set(key, [...(grouped.get(key) ?? []), material]);
    });

    grouped.forEach((entries) => {
      const selectedEntries = entries.filter((entry) => targetIds.has(entry.id));
      if (!selectedEntries.length) return;
      const remainingFiles = entries.filter((entry) => entry.file_path && !targetIds.has(entry.id));
      const placeholders = entries.filter((entry) => !entry.file_path && !targetIds.has(entry.id));

      if (remainingFiles.length || placeholders.length) {
        deleteIds.push(...selectedEntries.map((entry) => entry.id));
        return;
      }

      const [keeper, ...rest] = selectedEntries;
      if (keeper) clearIds.push(keeper.id);
      deleteIds.push(...rest.map((entry) => entry.id));
    });

    const paths = Array.from(new Set(uploadedTargets.map((item) => item.file_path).filter(Boolean) as string[]));
    const allTouchedIds = [...deleteIds, ...clearIds];

    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      allTouchedIds.forEach((id) => next.delete(id));
      return next;
    });
    setMaterials((prev) => prev
      .filter((item) => !deleteIds.includes(item.id))
      .map((item) => clearIds.includes(item.id)
        ? { ...item, file_path: null, file_name: null, status: "missing", review_note: null }
        : item,
      ));
    setMiMap((prev) => {
      const next = { ...prev };
      allTouchedIds.forEach((id) => { delete next[id]; });
      return next;
    });
    setMiMeta((prev) => {
      const next = { ...prev };
      allTouchedIds.forEach((id) => { delete next[id]; });
      return next;
    });

    try {
      await supabase.from("material_indicators").delete().in("material_id", allTouchedIds);
      await (supabase as any)
        .from("knowledge_files")
        .delete()
        .eq("source_type", "material")
        .in("source_id", allTouchedIds);
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from("project-materials").remove(paths);
        if (storageError) throw storageError;
      }
      if (deleteIds.length) {
        const { error: deleteError } = await supabase.from("materials").delete().in("id", deleteIds);
        if (deleteError) throw deleteError;
      }
      if (clearIds.length) {
        const { error: clearError } = await supabase.from("materials").update({
          file_path: null,
          file_name: null,
          status: "missing",
          review_note: null,
        }).in("id", clearIds);
        if (clearError) throw clearError;
      }
      toast.success(count === 1 ? "文件已删除" : `已删除 ${count} 个文件`);
      await loadMaterials();
    } catch (e: any) {
      setMaterials(prevMaterials);
      setMiMap(prevMiMap);
      setMiMeta(prevMiMeta);
      toast.error(e?.message ?? "删除失败");
    }
  };

  // 指标证据雷达：
  // - missing: 还未建立该指标对应资料清单
  // - checklist: 已建立资料清单，但尚未上传文件
  // - uploaded: 已上传文件，但尚未审核通过
  // - covered: 至少有一份已审核通过的证明文件
  const radar = useMemo(() => {
    if (!indicators.length) return null;
    const rows = indicators.map(ind => {
      const linked = materials.filter(m => indicatorsOf(m).includes(ind.id));
      const files = linked.filter((material) => material.file_path);
      const approved = files.filter((material) => material.status === "approved");
      const pending = files.filter((material) => material.status === "received");
      const placeholders = linked.filter((material) => !material.file_path);
      const rejected = files.filter((material) => material.status === "rejected");
      const state = approved.length
        ? "covered"
        : files.length
          ? "uploaded"
          : placeholders.length
            ? "checklist"
            : "missing";
      return { ind, linked, files, approved, pending, rejected, placeholders, state };
    });
    const covered = rows.filter((row) => row.state === "covered").length;
    const uploaded = rows.filter((row) => row.state === "uploaded").length;
    const checklist = rows.filter((row) => row.state === "checklist").length;
    const missing = rows.filter((row) => row.state === "missing").length;
    const overallPct = rows.length ? Math.round(((covered + uploaded * 0.6 + checklist * 0.25) / rows.length) * 100) : 0;
    return { rows, covered, uploaded, checklist, missing, overallPct };
  }, [indicators, materials, miMap]);

  const logicalMaterials = useMemo(() => {
    return buildLogicalMaterialList(materials);
  }, [materials, miMap]);

  const materialGroups = useMemo<MaterialGroup[]>(() => {
    const grouped = new Map<string, Material[]>();
    materials.forEach((material) => {
      const key = logicalMaterialKey(material);
      const list = grouped.get(key) ?? [];
      list.push(material);
      grouped.set(key, list);
    });
    return Array.from(grouped.entries()).map(([key, entries]) => {
      const primary = entries
        .slice()
        .sort((a, b) => {
          const score = materialPriority(b) - materialPriority(a);
          if (score) return score;
          return a.name.localeCompare(b.name, "zh-Hans-CN");
        })[0];
      const files = entries.filter((entry) => entry.file_path);
      const pendingFiles = files.filter((entry) => entry.status === "received");
      const reviewedFiles = files.filter((entry) => isReviewedStatus(entry.status));
      const placeholders = entries.filter((entry) => !entry.file_path);
      return {
        key,
        primary,
        entries: entries.slice().sort((a, b) => {
          const fileRank = Number(Boolean(b.file_path)) - Number(Boolean(a.file_path));
          if (fileRank) return fileRank;
          const score = materialPriority(b) - materialPriority(a);
          if (score) return score;
          return a.name.localeCompare(b.name, "zh-Hans-CN");
        }),
        files,
        pendingFiles,
        reviewedFiles,
        placeholders,
      };
    }).sort((a, b) => {
      const required = Number(b.primary.required) - Number(a.primary.required);
      if (required) return required;
      const displayOrder = materialDisplayOrder(a.primary) - materialDisplayOrder(b.primary);
      if (displayOrder) return displayOrder;
      return a.primary.name.localeCompare(b.primary.name, "zh-Hans-CN");
    });
  }, [materials, miMap]);

  const stats = {
    total: materialGroups.length,
    missing: materialGroups.filter((group) => !group.files.length && group.primary.required).length,
    received: materialGroups.filter((group) => group.pendingFiles.length > 0).length,
    approved: materialGroups.filter((group) => group.files.length > 0 && group.pendingFiles.length === 0 && group.reviewedFiles.length > 0).length,
  };

  const pendingMaterials = useMemo(
    () => materialGroups.filter((group) => !group.files.length || group.pendingFiles.length > 0),
    [materialGroups],
  );
  const reviewedMaterials = useMemo(
    () => materialGroups.filter((group) => group.files.length > 0 && group.pendingFiles.length === 0 && group.reviewedFiles.length > 0),
    [materialGroups],
  );
  const hasSystem = !!activeProject?.evaluation_system_id;
  const reviewedFileIds = new Set(reviewedMaterials.flatMap((group) => group.files.map((file) => file.id)));
  const selectedFiles = materials.filter((material) => material.file_path && reviewedFileIds.has(material.id) && selectedFileIds.has(material.id));
  const selectedFileCount = selectedFiles.length;
  const toggleFileSelected = (id: string, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="PHASE II · 04 · 资料审核"
        title="指标证明材料核验"
        subtitle="AI 研判项目资料与评估指标的对应关系 · 按指标查看证明材料 · 识别尚需补充佐证的指标"
        actions={
          <>
            <Button variant="hero" onClick={aiMatchMaterials} disabled={!projectId || !hasSystem || aiMatching}>
              <Sparkles className="h-4 w-4" /> {aiMatching ? "AI 分析中…" : "AI 匹配资料与指标"}
            </Button>
            <input
              type="file"
              hidden
              ref={(el) => (fileInputRefs.current["smart-upload"] = el)}
              accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.xls,.xlsx"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await smartUploadFile(file);
                e.target.value = "";
              }}
            />
            <input
              type="file"
              hidden
              multiple
              ref={(el) => {
                fileInputRefs.current["smart-folder-upload"] = el;
                if (el) {
                  el.setAttribute("webkitdirectory", "");
                  el.setAttribute("directory", "");
                }
              }}
              accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.xls,.xlsx"
              onChange={async (e) => {
                if (e.target.files?.length) await smartUploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button variant="outline" disabled={!projectId || smartUploading} onClick={() => fileInputRefs.current["smart-upload"]?.click()}>
              <Upload className="h-4 w-4" /> {smartUploading ? "上传中…" : "AI 识别上传"}
            </Button>
            <Button variant="outline" disabled={!projectId || smartUploading} onClick={() => fileInputRefs.current["smart-folder-upload"]?.click()}>
              <FolderOpen className="h-4 w-4" /> 上传文件夹
            </Button>
            <Button variant="outline" onClick={addTemplate} disabled={!projectId} title="按项目类别智能加载附件 2-1（项目类）或 2-2（政策类）标准清单">
              <Layers className="h-4 w-4" /> 加载标准清单
              {activeProject?.category && (
                <span className="ml-1 font-mono text-[10px] opacity-70">
                  · {pickTemplate(activeProject.category).kind === "policy" ? "附2-2" : "附2-1"}
                </span>
              )}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="hero" disabled={!projectId}>
                  <Plus className="h-4 w-4" /> 新增资料项
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-display text-xl">新增资料项</DialogTitle></DialogHeader>
                <form onSubmit={addOne} className="space-y-3">
                  <div>
                    <Label>分类</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRESET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>关联评估指标（可选）</Label>
                    <Select value={form.indicator_id} onValueChange={(v) => setForm({ ...form, indicator_id: v })}>
                      <SelectTrigger><SelectValue placeholder={hasSystem ? "选择指标" : "未关联体系"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— 不关联 —</SelectItem>
                        {indicators.map(i => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.code ? `[${i.code}] ` : ""}{i.name}（权重 {i.weight}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>资料名称</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input id="req" type="checkbox" checked={form.required}
                      onChange={(e) => setForm({ ...form, required: e.target.checked })} />
                    <Label htmlFor="req" className="cursor-pointer">必需资料</Label>
                  </div>
                  <DialogFooter><Button type="submit" variant="hero">保存</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <EditPermissionNotice />

      {/* 项目选择 + 数据指标 */}
      <Card className="surface-card p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1 sm:min-w-[240px]">
            <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase mb-1.5">评估对象</div>
            <Select
              value={projectId}
              onValueChange={(value) => {
                window.localStorage.setItem(MATERIALS_LAST_PROJECT_KEY, value);
                setProjectId(value);
              }}
            >
              <SelectTrigger><SelectValue placeholder="请选择项目" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {projectId && (
              <div className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                {hasSystem ? (
                  <span className="text-success">● 已关联指标体系（{indicators.length} 项指标）</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-2 text-warning-foreground">
                    <span>● 未关联指标体系 · 无法启用缺漏雷达</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 border-warning/40 px-2 text-[11px] text-warning-foreground hover:bg-warning/10"
                      onClick={() => navigate(`/projects?editProject=${projectId}`)}
                    >
                      去关联指标体系
                    </Button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="min-w-[72px] rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">总数</div>
              <div className="font-display text-2xl font-bold text-foreground tabular-nums leading-none mt-0.5">{stats.total}</div>
            </div>
            <div className="min-w-[72px] rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-destructive">缺失</div>
              <div className="font-display text-2xl font-bold text-destructive tabular-nums leading-none mt-0.5">{stats.missing}</div>
            </div>
            <div className="min-w-[72px] rounded-md border border-gold/40 bg-gold/5 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-gold">已收</div>
              <div className="font-display text-2xl font-bold text-gold tabular-nums leading-none mt-0.5">{stats.received}</div>
            </div>
            <div className="min-w-[72px] rounded-md border border-success/30 bg-success/5 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-success">已通过</div>
              <div className="font-display text-2xl font-bold text-success tabular-nums leading-none mt-0.5">{stats.approved}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* 指标证据雷达：每项指标可展开查看具体证明文件。 */}
      {projectId && hasSystem && radar && (
        <Card className="surface-card p-5 border-accent/30 mb-6">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 grid place-items-center rounded-lg bg-accent/10 border border-accent/30 text-accent">
                  <Radar className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">指标证据雷达</div>
                  <div className="font-display font-semibold text-foreground">评估指标证明材料覆盖情况与佐证缺口识别</div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <StatusPill tone="success">已证明 {radar.covered}</StatusPill>
                <StatusPill tone="info">待审核 {radar.uploaded}</StatusPill>
                <StatusPill tone="warning">待上传 {radar.checklist}</StatusPill>
                <StatusPill tone="danger">未建清单 {radar.missing}</StatusPill>
              </div>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-accent to-success transition-all"
                style={{ width: `${radar.overallPct}%` }}
              />
            </div>
            <div className="space-y-2">
              {radar.rows.map(r => {
                const stateMeta = r.state === "covered"
                  ? { label: "已证明", tone: "success" as const }
                  : r.state === "uploaded"
                    ? { label: "待审核", tone: "info" as const }
                    : r.state === "checklist"
                    ? { label: "待上传", tone: "warning" as const }
                    : { label: "未建清单", tone: "danger" as const };
                return (
                  <details key={r.ind.id} className="group rounded-md border border-border bg-card/40 open:border-accent/40 open:bg-accent/[0.03]">
                    <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                      <div className="font-mono text-xs tabular-nums text-accent w-12 shrink-0">{r.ind.code ?? "—"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">{r.ind.name}</span>
                          <StatusPill tone="gold" dot={false}>权重 {r.ind.weight}</StatusPill>
                          <StatusPill tone={stateMeta.tone}>{stateMeta.label}</StatusPill>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.approved.length
                            ? `${r.files.length} 份证明材料，其中 ${r.approved.length} 份已审核通过`
                            : r.files.length
                              ? `已上传 ${r.files.length} 份文件，待审核通过后转为“已证明”`
                              : r.linked.length
                                ? `已建立 ${r.linked.length} 项关联资料清单，待上传证明文件`
                                : "当前尚未建立该指标对应的资料清单"}
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-border px-3 pb-3 pt-2">
                      {r.files.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px] text-left text-xs">
                            <thead className="text-muted-foreground">
                              <tr>
                                <th className="px-2 py-2 font-medium">证明文件</th>
                                <th className="px-2 py-2 font-medium">资料分类</th>
                                <th className="px-2 py-2 font-medium">审核状态</th>
                                <th className="px-2 py-2 font-medium">佐证来源</th>
                                <th className="px-2 py-2 font-medium text-right">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {r.files.map((material) => {
                                const relation = (miMeta[material.id] ?? []).find((link) => link.indicator_id === r.ind.id);
                                return (
                                  <tr key={material.id}>
                                    <td className="px-2 py-2 font-medium text-foreground">{material.file_name || material.name}</td>
                                    <td className="px-2 py-2 text-muted-foreground">{material.category}</td>
                                    <td className="px-2 py-2">
                                      <StatusPill tone={STATUS_META[material.status].tone}>{STATUS_META[material.status].label}</StatusPill>
                                    </td>
                                    <td className="px-2 py-2">
                                      <StatusPill tone={relation?.source === "ai" ? "info" : "neutral"} dot={false}>
                                        {relation?.source === "ai" ? `AI 匹配 · ${relation.relevance}/5` : "人工确认"}
                                      </StatusPill>
                                    </td>
                                    <td className="px-2 py-2 text-right">
                                      <Button size="sm" variant="outline" onClick={() => previewFile(material)}>
                                        <FileSearch className="h-3.5 w-3.5" />预览
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => downloadFile(material)}>
                                        <Download className="h-3.5 w-3.5" />查看文件
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className={`rounded-md border border-dashed p-4 text-sm ${
                          r.linked.length
                            ? "border-warning/35 bg-warning/5 text-warning-foreground"
                            : "border-destructive/35 bg-destructive/5 text-destructive"
                        }`}>
                          {r.linked.length
                            ? `该指标已建立 ${r.linked.length} 项资料清单，但暂未上传可核验的证明文件。请先上传资料；上传后会先显示“待审核”，审核通过后才会转为“已证明”。`
                            : "该指标目前尚未建立对应证明资料。可点击右上角『AI 匹配资料与指标』，由系统根据已上传文件建立证明关系。"}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
        </Card>
      )}

      {!projectId && (
        <Card className="surface-card p-0">
          <EmptyState
            icon={FolderOpen}
            title="尚未创建评估对象"
            hint="请先在『评估对象管理』中创建项目，然后回到此页面管理资料"
          />
        </Card>
      )}

      {projectId && materials.length === 0 && (
        <Card className="surface-card p-0">
          <EmptyState
            icon={FileSearch}
            title="暂无资料项"
            hint={hasSystem
              ? "可先使用『AI 识别上传』或『上传文件夹』上传资料，再点击『AI 匹配资料与指标』建立证明关系"
              : "可点击右上角『加载预设模板』快速建立标准资料清单"}
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={addTemplate}>
                  <Sparkles className="h-4 w-4" /> 预设模板
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {pendingMaterials.length > 0 && (
        <Card className="surface-card overflow-hidden p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-accent shrink-0">
                  资料清单
                </span>
                <span className="font-display font-semibold text-foreground truncate">待处理资料</span>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums shrink-0">
                [{pendingMaterials.length.toString().padStart(2, "0")}]
              </span>
            </div>
            <div className="divide-y divide-border">
              {pendingMaterials.map((group) => {
                const m = group.primary;
                const hasFile = group.files.length > 0;
                const meta = getMaterialGroupStatusMeta(group);
                const groupTitle = isUnclassifiedMaterial(m) ? "待人工确认资料" : m.name;
                return (
                  <div
                    key={group.key}
                    className={`group p-4 transition-all ${
                      hasFile
                        ? "bg-accent/8 hover:bg-accent/12"
                        : "bg-muted/20 opacity-60 hover:opacity-80"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 grid place-items-center rounded-lg shrink-0 border ${
                        hasFile
                          ? "bg-accent/10 border-accent/40 text-accent"
                          : "bg-muted border-border text-muted-foreground"
                      }`}>
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="relative inline-block pr-2 font-medium text-foreground">
                            {groupTitle}
                            {m.required && (
                              <span className="absolute -right-0.5 -top-1 text-sm font-bold leading-none text-destructive" title="必需资料">*</span>
                            )}
                          </span>
                          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                          <StatusPill tone="neutral" dot={false}>共 {group.files.length} 份文件</StatusPill>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{m.category}</span>
                          {group.pendingFiles.length > 0 && <span>待审核 {group.pendingFiles.length} 份</span>}
                          {group.reviewedFiles.length > 0 && <span>已处理 {group.reviewedFiles.length} 份</span>}
                          {!group.files.length && <span>当前尚未上传文件</span>}
                        </div>
                        {group.files.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {group.files.map((fileMaterial) => (
                              <div key={fileMaterial.id} className="rounded-md border border-border bg-background/80 px-3 py-2">
                                <div className="flex flex-wrap items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <button
                                      onClick={() => downloadFile(fileMaterial)}
                                      className="text-left text-sm font-medium text-accent hover:underline break-all"
                                    >
                                      {fileMaterial.file_name || fileMaterial.name}
                                    </button>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <StatusPill tone={STATUS_META[fileMaterial.status].tone}>{STATUS_META[fileMaterial.status].label}</StatusPill>
                                      <span>已关联指标 {indicatorsOf(fileMaterial).length}</span>
                                    </div>
                                    {fileMaterial.review_note && (
                                      <div className="mt-1.5 border-l-2 border-accent/30 pl-2 text-xs text-muted-foreground">
                                        审核备注：{fileMaterial.review_note}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <input
                                      type="file"
                                      hidden
                                      ref={(el) => (fileInputRefs.current[fileMaterial.id] = el)}
                                      accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.xls,.xlsx"
                                      onChange={(e) => e.target.files?.[0] && onFile(fileMaterial, e.target.files[0])}
                                    />
                                    <Button size="sm" variant="outline" onClick={() => previewFile(fileMaterial)}>
                                      <FileSearch className="h-3.5 w-3.5" />预览
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => fileInputRefs.current[fileMaterial.id]?.click()}>
                                      <Upload className="h-3.5 w-3.5" />更换
                                    </Button>
                                    {hasSystem && (
                                      <Button size="sm" variant="outline" onClick={() => openLinkDialog(fileMaterial)} title="人工确认该资料可佐证的指标">
                                        <Link2 className="h-3.5 w-3.5" />确认指标
                                      </Button>
                                    )}
                                    <Button size="sm" variant="outline" onClick={() => { setReviewing(fileMaterial); setReviewNote(fileMaterial.review_note ?? ""); }}>
                                      {fileMaterial.status === "received" ? "审核" : "审核结果"}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => deleteUploadedFiles([fileMaterial])} title="删除该文件">
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />删除
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <input
                        type="file" hidden ref={(el) => (fileInputRefs.current[`append:${m.id}`] = el)}
                        accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.xls,.xlsx"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (hasFile) await appendFileToGroup(m, file);
                          else await onFile(m, file);
                          e.target.value = "";
                        }}
                      />
                      <Button size="sm" variant={hasFile ? "outline" : "hero"} onClick={() => fileInputRefs.current[`append:${m.id}`]?.click()}>
                        <Upload className="h-3.5 w-3.5" />{hasFile ? "追加文件" : "添加文件"}
                      </Button>
                      <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeOne(m)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                      {hasFile && (
                        <span className="self-center text-[11px] text-muted-foreground">
                          同一资料项支持上传多份文件
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
        </Card>
      )}

      {reviewedMaterials.length > 0 && (
        <Card className="surface-card overflow-hidden p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] font-bold tracking-[0.18em] uppercase text-success shrink-0">
                已处理
              </span>
              <span className="font-display font-semibold text-foreground truncate">已审核资料</span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                [{reviewedMaterials.length.toString().padStart(2, "0")}]
              </span>
              {reviewedSelectionMode && selectedFileCount > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkDownloading}
                    onClick={() => downloadFiles(selectedFiles)}
                  >
                    {bulkDownloading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5" />}
                    下载选中（{selectedFileCount}）
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteUploadedFiles(selectedFiles)}>
                    <Trash2 className="h-3.5 w-3.5" />删除选中（{selectedFileCount}）
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={reviewedSelectionMode ? "secondary" : "outline"}
                onClick={() => {
                  setReviewedSelectionMode((prev) => {
                    if (prev) setSelectedFileIds(new Set());
                    return !prev;
                  });
                }}
              >
                {reviewedSelectionMode ? "取消多选" : "多选"}
              </Button>
            </div>
          </div>
          <div className="divide-y divide-border">
            {reviewedMaterials.map((group) => {
              const m = group.primary;
              const meta = getMaterialGroupStatusMeta(group);
              const groupTitle = isUnclassifiedMaterial(m) ? "待人工确认资料" : m.name;
              return (
                <div key={group.key} className="p-4 bg-background/80">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 grid place-items-center rounded-lg shrink-0 border bg-success/10 border-success/25 text-success">
                      <Check className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="relative inline-block pr-2 font-medium text-foreground">
                          {groupTitle}
                          {m.required && (
                            <span className="absolute -right-0.5 -top-1 text-sm font-bold leading-none text-destructive" title="必需资料">*</span>
                          )}
                        </span>
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        <StatusPill tone="neutral" dot={false}>共 {group.files.length} 份文件</StatusPill>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{m.category}</span>
                        <span>已处理 {group.reviewedFiles.length} 份</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {group.files.map((fileMaterial) => (
                          <div key={fileMaterial.id} className="rounded-md border border-border bg-card/50 px-3 py-2">
                            <div className="flex flex-wrap items-start gap-2">
                              {reviewedSelectionMode && (
                                <Checkbox
                                  className="mt-1"
                                  checked={selectedFileIds.has(fileMaterial.id)}
                                  onCheckedChange={(checked) => toggleFileSelected(fileMaterial.id, checked === true)}
                                  aria-label={`选择${fileMaterial.file_name || fileMaterial.name}`}
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <button
                                  onClick={() => downloadFile(fileMaterial)}
                                  className="text-left text-sm font-medium text-accent hover:underline break-all"
                                >
                                  {fileMaterial.file_name || fileMaterial.name}
                                </button>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <StatusPill tone={STATUS_META[fileMaterial.status].tone}>{STATUS_META[fileMaterial.status].label}</StatusPill>
                                  <span>已关联指标 {indicatorsOf(fileMaterial).length}</span>
                                </div>
                                {fileMaterial.review_note && (
                                  <div className="mt-1.5 border-l-2 border-success/40 pl-2 text-xs text-muted-foreground">
                                    审核备注：{fileMaterial.review_note}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <input
                                  type="file"
                                  hidden
                                  ref={(el) => (fileInputRefs.current[fileMaterial.id] = el)}
                                  accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.xls,.xlsx"
                                  onChange={(e) => e.target.files?.[0] && onFile(fileMaterial, e.target.files[0])}
                                />
                                <Button size="sm" variant="outline" onClick={() => previewFile(fileMaterial)}>
                                  <FileSearch className="h-3.5 w-3.5" />预览
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => fileInputRefs.current[fileMaterial.id]?.click()}>
                                  <Upload className="h-3.5 w-3.5" />更换
                                </Button>
                                {hasSystem && (
                                  <Button size="sm" variant="outline" onClick={() => openLinkDialog(fileMaterial)} title="人工确认该资料可佐证的指标">
                                    <Link2 className="h-3.5 w-3.5" />确认指标
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => { setReviewing(fileMaterial); setReviewNote(fileMaterial.review_note ?? ""); }}>
                                  审核结果
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => deleteUploadedFiles([fileMaterial])} title="删除该文件">
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />删除
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-xl">资料审核 · {reviewing?.name}</DialogTitle></DialogHeader>
          {reviewing && (
            <div className="text-xs text-muted-foreground">
              当前状态：
              <span className="ml-1 inline-flex align-middle">
                <StatusPill tone={STATUS_META[reviewing.status].tone}>{STATUS_META[reviewing.status].label}</StatusPill>
              </span>
            </div>
          )}
          <Textarea
            value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
            placeholder="审核意见或驳回理由（可选）" rows={4}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => review("rejected")}>
              <X className="h-4 w-4" />驳回
            </Button>
            <Button variant="hero" onClick={() => review("approved")}>
              <Check className="h-4 w-4" />通过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 人工复核 AI 的指标证据匹配结果。 */}
      <Dialog open={!!linkOpen} onOpenChange={(o) => { if (!o) { setLinkOpen(null); setLinkSel(new Set()); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Link2 className="h-5 w-5 text-accent" /> 人工确认可证明指标 · {linkOpen?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="text-xs text-muted-foreground -mt-2 mb-2">
            勾选该文件中有明确事实、数据或制度依据能够证明的指标。一个文件可以证明多个指标。
          </div>
          <div className="flex-1 overflow-auto border border-border rounded-md divide-y divide-border">
            {indicators.map(ind => {
              const checked = linkSel.has(ind.id);
              return (
                <label key={ind.id} className="flex items-center gap-3 p-3 hover:bg-accent/5 cursor-pointer">
                  <Checkbox checked={checked} onCheckedChange={(v) => {
                    const ns = new Set(linkSel);
                    v ? ns.add(ind.id) : ns.delete(ind.id);
                    setLinkSel(ns);
                  }} />
                  <span className="font-mono text-xs text-accent w-12 shrink-0">{ind.code ?? "—"}</span>
                  <span className="flex-1 text-sm">{ind.name}</span>
                  <StatusPill tone="gold" dot={false}>权重 {ind.weight}</StatusPill>
                </label>
              );
            })}
          </div>
          <DialogFooter className="pt-3">
            <Button variant="outline" onClick={() => setLinkOpen(null)}>取消</Button>
            <Button variant="hero" onClick={saveLinks}>
              保存（已选 {linkSel.size}）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!previewing} onOpenChange={(open) => {
        if (!open) {
          clearPreviewObjectUrl();
          setPreviewing(null);
          setPreviewText("");
          setPreviewHtml("");
          setPreviewUrl(null);
          setPreviewIssue("");
          setPreviewKind("text");
        }
      }}>
        <DialogContent className="flex h-[94vh] w-[calc(100vw-1rem)] max-w-[96vw] flex-col overflow-hidden p-0 sm:w-[96vw]">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="flex min-w-0 items-center gap-2 font-display text-xl">
              <FileSearch className="h-5 w-5 shrink-0 text-accent" />
              <span className="truncate">文件预览 · {previewing?.file_name ?? previewing?.name}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-3 sm:p-5">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-2.5">
                <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Document Preview · 文档预览
                </div>
                <StatusPill tone={previewKind === "pdf" ? "danger" : previewKind === "image" ? "gold" : "neutral"} dot={false}>
                  {getPreviewLabel(previewing?.file_name ?? previewing?.name, previewKind)}
                </StatusPill>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-slate-100/70 p-3 sm:p-6">
                {previewKind === "pdf" ? (
                  <div className="flex min-h-full flex-col gap-3">
                    <div className={`rounded-lg border px-4 py-3 text-sm ${
                      previewIssue ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 gap-2">
                          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${previewIssue ? "text-destructive" : "text-amber-600"}`} />
                          <div className="min-w-0">
                            <div className="font-medium">{previewIssue ? "当前文件无法在线预览" : "PDF 在线预览"}</div>
                            <div className={`mt-1 text-xs leading-5 ${previewIssue ? "text-destructive/80" : "text-amber-900/80"}`}>
                              {previewIssue || "系统已将文件转为本地预览地址，避免浏览器直接打开签名链接导致加载失败。个别签章版、扫描版或加密 PDF 如仍无法显示，请下载原文件查看。"}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          {previewUrl && (
                            <Button size="sm" variant="outline" onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}>
                              <ExternalLink className="h-3.5 w-3.5" />新窗口打开
                            </Button>
                          )}
                          {previewing?.file_path && (
                            <Button size="sm" variant="hero" onClick={() => downloadFile(previewing)}>
                              <Download className="h-3.5 w-3.5" />下载文档
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                    {previewUrl ? (
                      <iframe
                        title={previewing?.file_name ?? previewing?.name ?? "PDF 预览"}
                        src={`${previewUrl}#toolbar=1&navpanes=0`}
                        className="min-h-[72vh] flex-1 rounded border-0 bg-white shadow-sm"
                      />
                    ) : (
                      <div className="flex min-h-[64vh] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-white px-8 py-12 text-center shadow-sm">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                        <div className="mt-4 font-display text-lg font-semibold text-foreground">暂无可显示的 PDF 画面</div>
                        <div className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
                          {previewIssue || "文件暂时无法生成在线预览，请下载原文件查看。"}
                        </div>
                        {previewing?.file_path && (
                          <Button className="mt-5" variant="hero" onClick={() => downloadFile(previewing)}>
                            <Download className="h-4 w-4" />下载原文件
                          </Button>
                        )}
                      </div>
                    )}
                    {previewText && (
                      <div className="rounded-lg border border-border bg-white px-4 py-3 text-sm leading-6 text-muted-foreground shadow-sm">
                        {previewText}
                      </div>
                    )}
                  </div>
                ) : previewKind === "image" && previewUrl ? (
                  <div className="flex min-h-full items-start justify-center overflow-auto">
                    <img
                      src={previewUrl}
                      alt={previewing?.file_name ?? previewing?.name ?? "图片预览"}
                      className="max-w-full rounded border border-border bg-white object-contain shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="mx-auto min-h-full w-full max-w-[960px] rounded-sm bg-white px-6 py-8 shadow-sm sm:px-14 sm:py-12">
                    {previewLoading ? (
                      <div className="text-sm text-muted-foreground">正在读取文件正文…</div>
                    ) : previewing && isLegacyDocFile(previewing.file_name ?? previewing.name) ? (
                      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-8 py-12 text-center">
                        <FileText className="h-10 w-10 text-muted-foreground" />
                        <div className="mt-4 font-display text-lg font-semibold text-foreground">旧版 Word 文件暂不支持页面内还原</div>
                        <div className="mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
                          `.doc` 属于旧版二进制 Word 格式，浏览器无法稳定还原原始版式。请先下载原文件查看；如需像 PDF 一样在线预览，需要在服务器接入 LibreOffice 自动转 PDF。
                        </div>
                        {previewing.file_path && (
                          <Button className="mt-5" variant="hero" onClick={() => downloadFile(previewing)}>
                            <Download className="h-4 w-4" />下载原文件
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="mb-6 border-b border-border pb-3">
                          <div className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
                            {getPreviewLabel(previewing?.file_name ?? previewing?.name, previewKind)} 正文预览
                          </div>
                        <div className="mt-1 truncate font-display text-lg font-semibold text-foreground">
                          {previewing?.file_name ?? previewing?.name}
                        </div>
                      </div>
                        {previewHtml ? (
                          <div
                            className="docx-preview-content break-words font-serif text-[15px] leading-8 text-foreground [&_a]:text-accent [&_h1]:mb-5 [&_h1]:mt-1 [&_h1]:text-center [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-4 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-3 [&_h3]:mt-5 [&_h3]:font-semibold [&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-semibold [&_ol]:my-3 [&_ol]:pl-6 [&_p]:my-2 [&_strong]:font-semibold [&_table]:my-5 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_ul]:my-3 [&_ul]:pl-6"
                            dangerouslySetInnerHTML={{ __html: previewHtml }}
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap break-words font-serif text-[15px] leading-8 text-foreground">{previewText}</pre>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-border px-5 py-4">
            {previewing?.file_path && (
              <Button variant="outline" onClick={() => downloadFile(previewing)}>
                <Download className="h-4 w-4" />下载文档
              </Button>
            )}
            <Button
              variant="hero"
              onClick={() => {
                clearPreviewObjectUrl();
                setPreviewing(null);
                setPreviewText("");
                setPreviewUrl(null);
                setPreviewIssue("");
                setPreviewKind("text");
              }}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  );
};

export default Materials;

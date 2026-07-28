import { PermissionGate } from "@/components/PermissionGate";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Trash2, Sparkles, BookUser, Briefcase, ShieldCheck, Wallet, X, FileSignature, Download, Loader2, Archive, Hand, Search, History as HistoryIcon, ShieldAlert, Pencil, FileSpreadsheet, ClipboardCheck, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { StatusPill, StatTile, EmptyState, SectionHeader } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { useIsMobile } from "@/hooks/use-mobile";
import { safeStorageFileName } from "@/lib/storagePath";

const TYPE_META: Record<string, { label: string; tone: "info" | "gold" | "success"; icon: typeof Briefcase }> = {
  business: { label: "业务专家", tone: "info", icon: Briefcase },
  management: { label: "管理专家", tone: "gold", icon: ShieldCheck },
  finance: { label: "财务专家", tone: "success", icon: Wallet },
};
const normalizeKey = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const extractEmail = (value: string | null | undefined) =>
  normalizeKey(value).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)?.[0] ?? "";
const loadPdfTools = async () => {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  return { html2canvas, jsPDF };
};

const NOTICE_PADDING_OVERRIDE = `
<style id="notice-padding-override">
  @page { margin: 28mm 24mm !important; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #f8fafc !important;
  }
  body {
    padding: 24px !important;
  }
  .doc {
    box-sizing: border-box !important;
    max-width: 720px !important;
    margin: 0 auto !important;
    padding: 52px 56px 60px !important;
  }
  .body {
    padding: 0 6px !important;
  }
  .body p {
    margin: 12px 0 !important;
  }
</style>`;

const applyNoticePadding = (html: string | null) => {
  if (!html) return null;
  if (html.includes("notice-padding-override")) return html;
  if (html.includes("</head>")) return html.replace("</head>", `${NOTICE_PADDING_OVERRIDE}</head>`);
  return `${NOTICE_PADDING_OVERRIDE}${html}`;
};

const extractNoticeBodyHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector(".doc") ?? doc.body;
  return content?.innerHTML ?? html;
};

const buildNoticePdfPages = (
  iframeDoc: Document,
  printableHeightRatio: number,
) => {
  const root = iframeDoc.querySelector(".doc") as HTMLElement | null;
  if (!root) {
    return {
      pages: [iframeDoc.body as HTMLElement],
      cleanup: () => {},
    };
  }

  const view = iframeDoc.defaultView;
  const rootStyle = view ? view.getComputedStyle(root) : null;
  const pageWidthPx = Math.max(
    Math.ceil(root.getBoundingClientRect().width || 0),
    root.scrollWidth,
    794,
  );
  const pageHeightPx = Math.max(1123, Math.ceil(pageWidthPx * printableHeightRatio));

  const stage = iframeDoc.createElement("div");
  stage.style.position = "absolute";
  stage.style.left = "-20000px";
  stage.style.top = "0";
  stage.style.width = `${pageWidthPx}px`;
  stage.style.pointerEvents = "none";
  stage.style.background = "#f8fafc";
  iframeDoc.body.appendChild(stage);

  const blocks: HTMLElement[] = [];
  const header = root.querySelector(".header") as HTMLElement | null;
  if (header) blocks.push(header.cloneNode(true) as HTMLElement);

  const body = root.querySelector(".body") as HTMLElement | null;
  if (body) {
    const bodyChildren = Array.from(body.children) as HTMLElement[];
    if (bodyChildren.length > 0) {
      bodyChildren.forEach((child) => {
        const wrapper = iframeDoc.createElement("div");
        wrapper.className = "body";
        wrapper.appendChild(child.cloneNode(true));
        blocks.push(wrapper);
      });
    } else {
      blocks.push(body.cloneNode(true) as HTMLElement);
    }
  }

  const tailNodes = [".seal-area", ".footer-date"]
    .map((selector) => root.querySelector(selector) as HTMLElement | null)
    .filter(Boolean) as HTMLElement[];
  if (tailNodes.length > 0) {
    const tailWrapper = iframeDoc.createElement("div");
    tailNodes.forEach((node) => tailWrapper.appendChild(node.cloneNode(true)));
    blocks.push(tailWrapper);
  }

  const createPage = () => {
    const page = iframeDoc.createElement("div");
    page.className = "doc pdf-page-export";
    page.style.boxSizing = "border-box";
    page.style.width = `${pageWidthPx}px`;
    page.style.maxWidth = "none";
    page.style.height = `${pageHeightPx}px`;
    page.style.margin = "0 0 24px";
    page.style.padding = rootStyle?.padding ?? "52px 56px 60px";
    page.style.background = "#fff";
    page.style.overflow = "hidden";
    stage.appendChild(page);
    return page;
  };

  let currentPage = createPage();
  blocks.forEach((block) => {
    const clone = block.cloneNode(true) as HTMLElement;
    currentPage.appendChild(clone);
    if (currentPage.scrollHeight > pageHeightPx) {
      currentPage.removeChild(clone);
      if (currentPage.childElementCount === 0) {
        currentPage.appendChild(clone);
        return;
      }
      currentPage = createPage();
      currentPage.appendChild(clone);
    }
  });

  return {
    pages: Array.from(stage.children) as HTMLElement[],
    cleanup: () => {
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    },
  };
};

const schema = z.object({
  name: z.string().trim().min(1, "姓名必填").max(50),
  expert_type: z.enum(["business", "management", "finance"]),
  organization: z.string().trim().max(200).optional(),
  title: z.string().trim().max(100).optional(),
  specialty: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(255).optional(),
  avoid_units: z.string().trim().max(500).optional(),
});

interface Expert {
  id: string; name: string; expert_type: string;
  organization: string | null; title: string | null;
  specialty: string | null; phone: string | null; email: string | null;
  available: boolean;
  avoid_units: string | null;
}

interface Participation {
  project_id: string; project_name: string; project_unit: string;
  scored_count: number; avg_score: number; last_scored_at: string;
}

interface ProjectLite { id: string; name: string; unit: string; }
interface TargetGroup { id: string; name: string; project_id: string; }

const Experts = () => {
  const { user, isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const targetGroupId = searchParams.get("groupId") ?? "";
  const targetProjectId = searchParams.get("projectId") ?? "";
  const pickMode = searchParams.get("pick") ?? "";
  const autoOpenedPickRef = useRef("");
  const [list, setList] = useState<Expert[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [targetGroup, setTargetGroup] = useState<TargetGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [editingExpert, setEditingExpert] = useState<Expert | null>(null);
  const [picked, setPicked] = useState<Expert[] | null>(null);
  const [aiPicking, setAiPicking] = useState(false);
  const [smartOpen, setSmartOpen] = useState(false);
  const [smartCounts, setSmartCounts] = useState({ management: 2, finance: 1, business: 2 });
  const [smartKeyword, setSmartKeyword] = useState("");
  const [pickMeta, setPickMeta] = useState<Record<string, {
    score?: number;
    reasons?: string[];
    history_avg?: number | null;
    history_count?: number;
    matched_terms?: string[];
    matched_tags?: string[];
  }>>({});
  const [pickProfile, setPickProfile] = useState<string>("");
  const [form, setForm] = useState({
    name: "", expert_type: "business" as const, organization: "",
    title: "", specialty: "", phone: "", email: "", avoid_units: "",
  });

  // 参与项目
  const [partOpen, setPartOpen] = useState(false);
  const [partExpert, setPartExpert] = useState<Expert | null>(null);
  const [partList, setPartList] = useState<Participation[]>([]);
  const [partLoading, setPartLoading] = useState(false);

  // 回避过滤
  const [avoidUnit, setAvoidUnit] = useState<string>("");
  const [avoidProjectId, setAvoidProjectId] = useState<string>("");
  const [manualAvoidUnit, setManualAvoidUnit] = useState<string>("");
  const [manualProjectId, setManualProjectId] = useState<string>("");
  const [pickedProjectId, setPickedProjectId] = useState<string>("");
  const isAvoidedByUnit = (e: Expert, unit: string) => {
    if (!unit) return false;
    const list = (e.avoid_units || "").split(/[、,;；\s]+/).map(s => s.trim()).filter(Boolean);
    return list.some(u => unit.includes(u) || u.includes(unit));
  };
  const isAvoided = (e: Expert) => isAvoidedByUnit(e, avoidUnit);
  const isManualAvoided = (e: Expert) => isAvoidedByUnit(e, manualAvoidUnit);

  // Notice generator state
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeProjectId, setNoticeProjectId] = useState<string>("");
  const [noticeDuration, setNoticeDuration] = useState(30);
  const [noticeDuty, setNoticeDuty] = useState("");
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeHtml, setNoticeHtml] = useState<string | null>(null);
  const [noticeMeta, setNoticeMeta] = useState<{ notice_no: string; start_date: string; end_date: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const noticePreviewHtml = useMemo(() => applyNoticePadding(noticeHtml), [noticeHtml]);

  // 手工抽取
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKeyword, setManualKeyword] = useState("");
  const [manualSelected, setManualSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const { data: expertData, error } = await supabase
      .from("experts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    const experts = (expertData as Expert[]) ?? [];
    if (isAdmin) {
      setList(experts);
      return;
    }

    const [
      { data: groupMembers },
      { data: scoreRows },
      { data: sheetRows },
    ] = await Promise.all([
      supabase
        .from("work_group_members")
        .select("member_name,member_role,contact")
        .eq("member_role", "expert"),
      supabase
        .from("expert_scores")
        .select("expert_id,expert_name"),
      supabase
        .from("expert_score_sheets")
        .select("expert_name"),
    ]);

    const allowedIds = new Set<string>();
    const allowedNames = new Set<string>();
    const allowedEmails = new Set<string>();
    (groupMembers ?? []).forEach((item: any) => {
      const name = normalizeKey(item.member_name);
      const email = extractEmail(item.contact);
      if (name) allowedNames.add(name);
      if (email) allowedEmails.add(email);
    });
    (scoreRows ?? []).forEach((item: any) => {
      if (item.expert_id) allowedIds.add(item.expert_id);
      const name = normalizeKey(item.expert_name);
      if (name) allowedNames.add(name);
    });
    (sheetRows ?? []).forEach((item: any) => {
      const name = normalizeKey(item.expert_name);
      if (name) allowedNames.add(name);
    });

    setList(experts.filter((expert) => {
      const email = normalizeKey(expert.email);
      return allowedIds.has(expert.id)
        || allowedNames.has(normalizeKey(expert.name))
        || (!!email && allowedEmails.has(email));
    }));
  };

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id,name,unit").order("created_at", { ascending: false });
    setProjects((data ?? []) as ProjectLite[]);
  };

  const loadTargetGroup = async () => {
    if (!targetGroupId) {
      setTargetGroup(null);
      return;
    }
    const { data, error } = await supabase
      .from("work_groups")
      .select("id,name,project_id")
      .eq("id", targetGroupId)
      .maybeSingle();
    if (error) {
      toast.error("读取工作组失败：" + error.message);
      return;
    }
    setTargetGroup((data as TargetGroup | null) ?? null);
  };

  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => { load(); loadProjects(); }, [isAdmin, user?.id]);
  useEffect(() => { loadTargetGroup(); }, [targetGroupId]);
  useEffect(() => {
    const projectId = targetGroup?.project_id || targetProjectId;
    if (!projectId || projects.length === 0) return;
    applyAvoidProject(projectId);
    applyManualAvoidProject(projectId);
    setNoticeProjectId(projectId);
  }, [targetGroup?.project_id, targetProjectId, projects.length]);
  useEffect(() => {
    if (!targetGroupId || pickMode !== "smart" || autoOpenedPickRef.current === targetGroupId || list.length === 0) return;
    autoOpenedPickRef.current = targetGroupId;
    if (list.length >= 3) {
      setSmartOpen(true);
    } else {
      setManualOpen(true);
      toast.info("专家库人数较少，已为你打开人工抽取");
    }
  }, [targetGroupId, pickMode, list.length]);

  const resetForm = () => {
    setForm({
      name: "", expert_type: "business", organization: "",
      title: "", specialty: "", phone: "", email: "", avoid_units: "",
    });
    setEditingExpert(null);
  };

  const openEdit = (expert: Expert) => {
    setEditingExpert(expert);
    setForm({
      name: expert.name,
      expert_type: expert.expert_type as "business" | "management" | "finance",
      organization: expert.organization ?? "",
      title: expert.title ?? "",
      specialty: expert.specialty ?? "",
      phone: expert.phone ?? "",
      email: expert.email ?? "",
      avoid_units: expert.avoid_units ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.errors[0].message);
    const payload = {
      ...parsed.data,
      organization: parsed.data.organization || null,
      title: parsed.data.title || null,
      specialty: parsed.data.specialty || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      avoid_units: parsed.data.avoid_units || null,
    };
    const { error } = editingExpert
      ? await supabase.from("experts").update(payload as any).eq("id", editingExpert.id)
      : await supabase.from("experts").insert({ ...payload, created_by: user.id } as any);
    if (error) return toast.error(error.message);
    toast.success(editingExpert ? "专家信息已更新" : "专家已入库");
    setOpen(false);
    resetForm();
    load();
  };

  const del = async (id: string) => {
    if (!(await confirm({ title: "从专家库移除？", description: "该专家将不再出现在抽取池与下拉选项中。", destructive: true, confirmText: "移除" }))) return;
    const { error } = await supabase.from("experts").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("已移除"); load(); }
  };

  const toggleAvailable = async (expert: Expert) => {
    const next = !expert.available;
    const { error } = await supabase.from("experts").update({ available: next } as any).eq("id", expert.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(next ? "已审核通过并入库" : "已设为停用");
    load();
  };

  const matchKeyword = (e: Expert, kw: string) => {
    if (!kw.trim()) return true;
    const k = kw.trim().toLowerCase();
    return [e.name, e.specialty, e.organization, e.title].some(v => (v ?? "").toLowerCase().includes(k));
  };

  const availableByType = useMemo(() => ({
    business: list.filter((e) => e.expert_type === "business" && e.available && !isAvoided(e)).length,
    management: list.filter((e) => e.expert_type === "management" && e.available && !isAvoided(e)).length,
    finance: list.filter((e) => e.expert_type === "finance" && e.available && !isAvoided(e)).length,
  }), [avoidUnit, list]);

  const manualPoolStats = useMemo(() => ({
    business: list.filter((e) => e.expert_type === "business" && e.available && matchKeyword(e, manualKeyword) && !isManualAvoided(e)).length,
    management: list.filter((e) => e.expert_type === "management" && e.available && matchKeyword(e, manualKeyword) && !isManualAvoided(e)).length,
    finance: list.filter((e) => e.expert_type === "finance" && e.available && matchKeyword(e, manualKeyword) && !isManualAvoided(e)).length,
  }), [list, manualAvoidUnit, manualKeyword]);

  const manualSelectedStats = useMemo(() => {
    const chosen = list.filter((e) => manualSelected.has(e.id));
    return {
      total: chosen.length,
      business: chosen.filter((e) => e.expert_type === "business").length,
      management: chosen.filter((e) => e.expert_type === "management").length,
      finance: chosen.filter((e) => e.expert_type === "finance").length,
      conflicts: chosen.filter(isManualAvoided).length,
    };
  }, [list, manualAvoidUnit, manualSelected]);

  const applyAvoidProject = (projectId: string) => {
    setAvoidProjectId(projectId);
    const project = projects.find((item) => item.id === projectId);
    setAvoidUnit(project?.unit ?? "");
  };

  const applyManualAvoidProject = (projectId: string) => {
    setManualProjectId(projectId);
    const project = projects.find((item) => item.id === projectId);
    setManualAvoidUnit(project?.unit ?? "");
  };

  const syncExpertsToTargetGroup = async (experts: Expert[]) => {
    if (!targetGroupId || !user || experts.length === 0) return;
    const { data: existing, error: existingError } = await supabase
      .from("work_group_members")
      .select("member_name,organization")
      .eq("group_id", targetGroupId);
    if (existingError) {
      toast.error("同步到工作组失败：" + existingError.message);
      return;
    }
    const existingKeys = new Set(
      (existing ?? []).map((row: any) => `${row.member_name ?? ""}::${row.organization ?? ""}`),
    );
    const rows = experts
      .filter((expert) => !existingKeys.has(`${expert.name}::${expert.organization ?? ""}`))
      .map((expert) => ({
        group_id: targetGroupId,
        member_name: expert.name,
        member_role: "expert",
        organization: expert.organization,
        contact: [expert.phone, expert.email].filter(Boolean).join(" / ") || null,
        created_by: user.id,
      }));
    if (rows.length === 0) {
      toast.info("抽取的专家已在该工作组成员名单中，无需重复保存");
      return;
    }
    const { error } = await supabase.from("work_group_members").insert(rows as any);
    if (error) {
      toast.error("同步到工作组失败：" + error.message);
      return;
    }
    toast.success(`已同步 ${rows.length} 位专家到「${targetGroup?.name ?? "当前工作组"}」成员名单`);
  };

  const manualPickBySelection = async () => {
    const chosen = list.filter(e => manualSelected.has(e.id));
    if (!chosen.length) return toast.error("请至少勾选 1 位专家");
    const conflicts = chosen.filter(isManualAvoided);
    if (conflicts.length && !confirm) {/* noop */}
    if (conflicts.length) {
      const ok = window.confirm(`检测到 ${conflicts.length} 位专家与「${manualAvoidUnit}」存在回避关系：\n${conflicts.map(e => e.name).join("、")}\n仍要选择？`);
      if (!ok) return;
    }
    setPicked(chosen);
    setPickedProjectId(manualProjectId);
    setPickProfile(
      manualAvoidUnit
        ? `本次为人工勾选，共选定 ${chosen.length} 位专家，并按项目单位「${manualAvoidUnit}」标记了回避状态。`
        : `本次为人工勾选，共选定 ${chosen.length} 位专家。`
    );
    toast.success(`已手工选定 ${chosen.length} 位专家`);
    setManualOpen(false);
    setManualSelected(new Set());
    await syncExpertsToTargetGroup(chosen);
  };

  const localSmartPick = async (
    quota = smartCounts,
    keyword = smartKeyword,
  ) => {
    const pick = (type: keyof typeof quota) => {
      const need = quota[type];
      if (need <= 0) return [] as Expert[];
      const pool = list.filter((expert) =>
        expert.expert_type === type &&
        expert.available &&
        !isAvoided(expert) &&
        matchKeyword(expert, keyword),
      );
      if (pool.length < need) {
        toast.error(`${TYPE_META[type].label}符合条件仅 ${pool.length} 位，少于所需 ${need} 位`);
        return null;
      }
      return [...pool].sort(() => Math.random() - 0.5).slice(0, need);
    };
    const management = pick("management"); if (!management) return;
    const finance = pick("finance"); if (!finance) return;
    const business = pick("business"); if (!business) return;
    const result = [...management, ...finance, ...business];
    if (!result.length) {
      toast.error("请至少设置 1 位抽取数量");
      return;
    }
    setPickMeta({});
    setPickProfile(avoidUnit
      ? `系统已按数量自动抽取，并回避单位「${avoidUnit}」完成过滤。`
      : "系统已按设置数量自动抽取专家。");
    setPicked(result);
    setPickedProjectId(avoidProjectId);
    setSmartOpen(false);
    toast.success(`已抽取 ${result.length} 位专家${avoidUnit ? `（已回避「${avoidUnit}」）` : ""}`);
    await syncExpertsToTargetGroup(result);
  };

  const smartPick = async () => {
    setAiPicking(true);
    try {
      await localSmartPick(smartCounts, smartKeyword.trim());
    } finally {
      setAiPicking(false);
    }
  };

  const expertReputation = (e: Expert) => {
    const meta = pickMeta[e.id];
    if (meta?.score) return Math.max(0, Math.min(100, Math.round(meta.score)));
    let score = 72;
    if (e.specialty) score += 8;
    if (e.title) score += 5;
    if (e.available) score += 5;
    if (isAvoided(e)) score -= 30;
    return Math.max(40, Math.min(95, score));
  };

  const expertProfileTags = (e: Expert) => {
    const meta = pickMeta[e.id];
    const tags = [
      ...(meta?.matched_tags ?? []),
      ...(meta?.matched_terms ?? []).slice(0, 2),
      e.title ?? "",
      e.specialty?.split(/[、,，/／\s]+/).find(Boolean) ?? "",
    ].filter(Boolean);
    return Array.from(new Set(tags)).slice(0, 4);
  };

  const downloadBlob = async (blob: Blob, filename: string) => {
    const { saveAs } = await import("file-saver");
    saveAs(blob, filename);
  };

  const currentPickProject = () =>
    projects.find((item) => item.id === noticeProjectId)
    ?? projects.find((item) => item.id === pickedProjectId);

  const exportPickSheet = async () => {
    if (!picked?.length) return toast.error("请先抽取专家组");
    const project = currentPickProject();
    const XLSX = await import("xlsx");
    const rows = picked.map((expert, index) => ({
      序号: index + 1,
      专家姓名: expert.name,
      专家类别: TYPE_META[expert.expert_type]?.label ?? expert.expert_type,
      所属单位: expert.organization ?? "",
      职称: expert.title ?? "",
      专业领域: expert.specialty ?? "",
      联系方式: [expert.phone, expert.email].filter(Boolean).join(" / "),
      回避单位: expert.avoid_units ?? "",
      信誉度: expertReputation(expert),
      匹配理由: (pickMeta[expert.id]?.reasons ?? expertProfileTags(expert)).join("；"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "专家抽取表");
    XLSX.writeFile(wb, `${project?.name ?? "评估项目"}-专家抽取表.xlsx`);
    toast.success("专家抽取表已导出");
  };

  const exportCommitmentDoc = async () => {
    if (!picked?.length) return toast.error("请先抽取专家组");
    const project = currentPickProject();
    const lines = [
      `项目名称：${project?.name ?? "未指定项目"}`,
      `项目单位：${project?.unit ?? avoidUnit ?? "未指定"}`,
      "",
      "专家承诺事项：",
      "1. 本人承诺独立、客观、公正参与本次事前绩效评估工作。",
      "2. 本人与项目单位、预算单位及相关供应商不存在应当回避的利害关系；如发现回避情形，将及时主动说明并退出评审。",
      "3. 本人承诺对评估过程中接触的资料、数据、会议意见和工作成果履行保密义务。",
      "4. 本人承诺按照评估指标体系、项目资料和现场核验情况独立发表意见并对本人签署意见负责。",
      "",
      "专家签署：",
      ...picked.map((expert, index) => `${index + 1}. ${expert.name}（${TYPE_META[expert.expert_type]?.label ?? expert.expert_type}）    签名：__________    日期：____年__月__日`),
    ].join("\n");
    const { createTextDocxBlob } = await import("@/lib/generatedDocx");
    const blob = await createTextDocxBlob("事前绩效评估专家承诺书", lines);
    await downloadBlob(blob, `${project?.name ?? "评估项目"}-专家承诺书.docx`);
    toast.success("专家承诺书已导出");
  };

  const openParticipation = async (e: Expert) => {
    setPartExpert(e);
    setPartOpen(true);
    setPartLoading(true);
    setPartList([]);
    const { data, error } = await supabase.rpc("get_expert_participation", { _expert_name: e.name });
    setPartLoading(false);
    if (error) { toast.error(error.message); return; }
    setPartList((data ?? []) as Participation[]);
  };

  const generateNotice = async () => {
    if (!picked || picked.length === 0) return toast.error("请先抽取专家组");
    setNoticeLoading(true);
    setNoticeHtml(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-expert-notice", {
        body: {
          projectId: noticeProjectId || undefined,
          experts: picked.map((e) => ({
            id: e.id, name: e.name, expert_type: e.expert_type,
            organization: e.organization, title: e.title, specialty: e.specialty,
          })),
          durationDays: noticeDuration,
          dutyOverride: noticeDuty.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setNoticeHtml(data.html);
      setNoticeMeta({ notice_no: data.notice_no, start_date: data.start_date, end_date: data.end_date });
      toast.success("任命书已生成");
    } catch (e: any) {
      toast.error(e?.message ?? "生成失败");
    } finally {
      setNoticeLoading(false);
    }
  };

  const mountNoticeIframe = async () => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.left = "-9999px";
    iframe.style.top = "0";
    iframe.style.width = "820px";
    iframe.style.height = "1200px";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open(); doc.write(noticePreviewHtml!); doc.close();
    await new Promise((r) => setTimeout(r, 350));
    return { iframe, doc, target: doc.body };
  };

  const buildPdf = async (): Promise<{ blob: Blob; filename: string }> => {
    const { html2canvas, jsPDF } = await loadPdfTools();
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 12;
    const marginTop = 12;
    const marginBottom = 14;
    const printableW = pageW - marginX * 2;
    const printableH = pageH - marginTop - marginBottom;
    const { iframe, target } = await mountNoticeIframe();
    const { pages, cleanup } = buildNoticePdfPages(iframe.contentDocument!, printableH / printableW);
    try {
      for (const [pageIndex, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
        });
        const imgW = printableW;
        const imgH = (canvas.height * imgW) / canvas.width;
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(
          canvas.toDataURL("image/jpeg", 0.95),
          "JPEG",
          marginX,
          marginTop,
          imgW,
          Math.min(imgH, printableH),
        );
      }
    } finally {
      cleanup();
      document.body.removeChild(iframe);
    }
    const blob = pdf.output("blob");
    const filename = `任命书_${noticeMeta?.notice_no?.replace(/[〔〕]/g, "_") ?? Date.now()}.pdf`;
    return { blob, filename };
  };

  const buildWord = async (): Promise<{ blob: Blob; filename: string }> => {
    if (!noticePreviewHtml) throw new Error("请先生成任命书");
    const { createRichDocxBlob } = await import("@/lib/generatedDocx");
    const title = noticeMeta?.notice_no
      ? `专家评审组任命书 ${noticeMeta.notice_no}`
      : "专家评审组任命书";
    const blob = await createRichDocxBlob(title, extractNoticeBodyHtml(noticePreviewHtml));
    const filename = `任命书_${noticeMeta?.notice_no?.replace(/[〔〕]/g, "_") ?? Date.now()}.docx`;
    return { blob, filename };
  };

  const downloadPdf = async () => {
    if (!noticePreviewHtml) return;
    try {
      const { blob, filename } = await buildPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF 已下载");
    } catch (e: any) {
      toast.error("下载失败：" + (e?.message ?? ""));
    }
  };

  const downloadWord = async () => {
    if (!noticePreviewHtml) return;
    try {
      const { blob, filename } = await buildWord();
      await downloadBlob(blob, filename);
      toast.success("Word 已下载");
    } catch (e: any) {
      toast.error("下载失败：" + (e?.message ?? ""));
    }
  };

  const archiveNotice = async () => {
    if (!noticePreviewHtml || !user) return;
    if (!noticeProjectId) return toast.error("请先在上方选择关联项目，否则无法入档");
    setArchiving(true);
    try {
      const { blob, filename } = await buildPdf();
      const path = `${user.id}/${noticeProjectId}/notices/${Date.now()}_${safeStorageFileName(filename, "notice.pdf")}`;
      const { error: upErr } = await supabase.storage
        .from("project-materials")
        .upload(path, blob, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;
      const { data: materialRecord, error: insErr } = await supabase.from("materials").insert({
        project_id: noticeProjectId,
        name: `专家评审组任命书 ${noticeMeta?.notice_no ?? ""}`,
        category: "公文",
        required: false,
        status: "approved",
        file_path: path,
        file_name: filename,
        created_by: user.id,
      } as any).select("id").single();
      if (insErr) throw insErr;
      if (materialRecord?.id) {
        void supabase.functions.invoke("ingest-project-knowledge", {
          body: { materialId: materialRecord.id },
        }).then(({ error }) => {
          if (error) console.warn("notice knowledge indexing failed", error);
        });
      }
      toast.success("任命书已入档至「资料」库");
    } catch (e: any) {
      toast.error("入档失败：" + (e?.message ?? ""));
    } finally {
      setArchiving(false);
    }
  };

  const counts = {
    business: list.filter((e) => e.expert_type === "business").length,
    management: list.filter((e) => e.expert_type === "management").length,
    finance: list.filter((e) => e.expert_type === "finance").length,
  };

  const NewExpertDialog = (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) resetForm();
    }}>
      <DialogTrigger asChild>
        <Button variant="hero">
          <Plus className="h-4 w-4" /> 新增专家
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-display text-xl">{editingExpert ? "修改专家信息" : "新增专家"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>姓名 *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={50} /></div>
          <div>
            <Label>专家类别 *</Label>
            <Select value={form.expert_type} onValueChange={(v: any) => setForm({ ...form, expert_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="business">业务专家</SelectItem>
                <SelectItem value="management">管理专家</SelectItem>
                <SelectItem value="finance">财务专家</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>所属单位</Label><Input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} maxLength={200} /></div>
          <div><Label>职称</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} /></div>
          <div><Label>专业领域</Label><Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} maxLength={200} /></div>
          <div>
            <Label className="flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-warning" />回避单位</Label>
            <Input value={form.avoid_units} onChange={(e) => setForm({ ...form, avoid_units: e.target.value })} maxLength={500} placeholder="多个用顿号分隔，如：市林业局、园林集团" />
            <p className="text-[11px] text-muted-foreground mt-1">智能/人工抽取时将自动过滤与项目预算单位匹配的专家</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>电话</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} /></div>
            <div><Label>邮箱</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={255} /></div>
          </div>
          <DialogFooter><Button type="submit" variant="hero">{editingExpert ? "保存修改" : "保 存"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        eyebrow="PHASE I · 03 · 专家库"
        title="专家库管理"
        subtitle="业务 / 管理 / 财务三类专家分类入库 · 智能抽取或按角色×数量人工抽取 · 一键生成任命书"
        actions={
          <PermissionGate require="canManage">
            <Button variant="outline" onClick={() => setManualOpen(true)} disabled={list.length === 0}>
              <Hand className="h-4 w-4" /> 人工抽取
            </Button>
            <Button variant="outline" onClick={() => setSmartOpen(true)} disabled={list.length < 3}>
              {aiPicking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} 智能抽取
            </Button>
            {NewExpertDialog}
          </PermissionGate>
        }
      />

      <EditPermissionNotice />

      {targetGroupId && (
        <Card className="surface-card mb-6 border-accent/30 bg-accent/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg border border-accent/25 bg-accent/10 p-2">
                <Users className="h-4 w-4 text-accent" />
              </div>
              <div>
                <div className="font-medium text-foreground">抽取完成后将自动保存到工作组成员名单</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  工作组：{targetGroup?.name ?? "正在读取…"}
                  {currentPickProject()?.name ? ` · 项目：${currentPickProject()?.name}` : ""}
                </div>
              </div>
            </div>
            <Button variant="outline" onClick={() => { window.location.href = "/work-groups"; }}>
              返回工作组与方案
            </Button>
          </div>
        </Card>
      )}

      {/* 统计 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="TOTAL" value={list.length.toString().padStart(2, "0")} hint="专家库总数" icon={BookUser} tone="info" />
        <StatTile label="BUSINESS" value={counts.business.toString().padStart(2, "0")} hint="业务专家" icon={Briefcase} tone="info" />
        <StatTile label="MANAGEMENT" value={counts.management.toString().padStart(2, "0")} hint="管理专家" icon={ShieldCheck} tone="gold" />
        <StatTile label="FINANCE" value={counts.finance.toString().padStart(2, "0")} hint="财务专家" icon={Wallet} tone="success" />
      </div>

      {picked && (
        <Card className="surface-card p-6 mb-6 animate-scale-in">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <SectionHeader
              eyebrow="SMART PICK · 智能抽取"
              title="本次抽取专家组"
              count={picked.length}
              icon={Sparkles}
            />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" onClick={exportPickSheet}>
                <FileSpreadsheet className="h-4 w-4" /> 导出抽取表
              </Button>
              <Button variant="outline" onClick={exportCommitmentDoc}>
                <ClipboardCheck className="h-4 w-4" /> 导出承诺书
              </Button>
              <Button variant="gold" onClick={() => {
                setNoticeProjectId(currentPickProject()?.id ?? avoidProjectId);
                setNoticeOpen(true);
              }}>
                <FileSignature className="h-4 w-4" /> 生成任命书
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setPicked(null)} className="h-9 w-9" title="关闭抽取结果">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {pickProfile && (
            <div className="mb-4 rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">抽取依据：</span>{pickProfile}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {picked.map((e) => {
              const meta = TYPE_META[e.expert_type];
              const Icon = meta.icon;
              return (
                <div key={e.id} className="rounded-lg border border-accent/30 bg-gradient-to-br from-accent/5 to-transparent p-4 hover:shadow-glow transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-bold text-foreground">{e.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{e.title ?? "—"}</div>
                    </div>
                    <StatusPill tone={meta.tone} dot={false}>
                      <Icon className="h-3 w-3" />{meta.label}
                    </StatusPill>
                  </div>
                  <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground space-y-1">
                    <div className="truncate">{e.organization ?? "—"}</div>
                    <div className="truncate">{e.specialty ?? "—"}</div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <StatusPill tone={expertReputation(e) >= 85 ? "success" : "info"} dot={false}>信誉度 {expertReputation(e)}</StatusPill>
                      {(pickMeta[e.id]?.history_count ?? 0) > 0 && (
                        <StatusPill tone="neutral" dot={false}>历史参评 {pickMeta[e.id]?.history_count} 次</StatusPill>
                      )}
                    </div>
                    {expertProfileTags(e).length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {expertProfileTags(e).map((tag) => (
                          <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground/70">{tag}</span>
                        ))}
                      </div>
                    )}
                    {(pickMeta[e.id]?.reasons?.length ?? 0) > 0 && (
                      <div className="pt-1 text-[11px] text-accent">
                        {pickMeta[e.id]?.reasons?.join("；")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="surface-card overflow-hidden p-0">
        {list.length === 0 ? (
          <EmptyState
            icon={BookUser}
            title="专家库为空"
            hint="点击右上角『新增专家』开始建立评审专家库"
            action={NewExpertDialog}
          />
        ) : (
          <>
            {isMobile ? (
              <div className="divide-y divide-border md:hidden">
                {list.map((e) => {
                  const meta = TYPE_META[e.expert_type];
                  const Icon = meta.icon;
                  return (
                    <div key={e.id} className={`p-4 ${isAvoided(e) ? "bg-warning/5" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-medium text-foreground whitespace-nowrap">{e.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground break-words">{e.organization ?? "—"}</div>
                        </div>
                        <StatusPill tone={meta.tone} dot={false}>
                          <Icon className="h-3 w-3" />{meta.label}
                        </StatusPill>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                        <div><span className="font-mono text-muted-foreground">职称：</span>{e.title ?? "—"}</div>
                        <div className="break-words"><span className="font-mono text-muted-foreground">专业：</span>{e.specialty ?? "—"}</div>
                        <div>
                          <span className="font-mono text-muted-foreground">联系方式：</span>
                          {e.phone || e.email ? (
                            <span className="font-mono text-foreground/80 break-all">{e.phone ?? ""} {e.email ?? ""}</span>
                          ) : (
                            <span className="italic text-muted-foreground/60">仅录入人可见</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <StatusPill tone={expertReputation(e) >= 85 ? "success" : "info"} dot={false}>信誉度 {expertReputation(e)}</StatusPill>
                        <StatusPill tone={e.available ? "success" : "neutral"} dot={false}>{e.available ? "审核通过" : "停用"}</StatusPill>
                        {isAvoided(e) && <StatusPill tone="warning" dot={false}>需回避</StatusPill>}
                      </div>
                      {expertProfileTags(e).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {expertProfileTags(e).slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
                          ))}
                        </div>
                      )}
                      {e.avoid_units && (
                        <div className="mt-2 text-[11px]">
                          <span className="font-mono text-muted-foreground">回避：</span>
                          <span className={isAvoided(e) ? "font-mono font-bold text-warning-foreground" : "font-mono text-muted-foreground"}>
                            {e.avoid_units}
                          </span>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => openParticipation(e)} className="flex-1 min-w-[96px]">
                          <HistoryIcon className="h-4 w-4 text-accent" />参与项目
                        </Button>
                        <PermissionGate require="canManage">
                          <Button variant="outline" size="sm" onClick={() => openEdit(e)} className="flex-1 min-w-[96px]">
                            <Pencil className="h-4 w-4" />编辑
                          </Button>
                        </PermissionGate>
                        <PermissionGate require="canManage">
                          <Button variant="outline" size="sm" onClick={() => toggleAvailable(e)} className="flex-1 min-w-[96px]">
                            {e.available ? "设为停用" : "审核入库"}
                          </Button>
                        </PermissionGate>
                        <PermissionGate require="canManage">
                          <Button variant="ghost" size="sm" onClick={() => del(e.id)} className="w-full text-destructive">
                            <Trash2 className="h-4 w-4 text-destructive" />删除
                          </Button>
                        </PermissionGate>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">姓名</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">类别</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">单位</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">职称</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">专业领域</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">联系方式</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">画像</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">回避</TableHead>
                      <TableHead className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground">入库状态</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((e) => {
                      const meta = TYPE_META[e.expert_type];
                      const Icon = meta.icon;
                      return (
                        <TableRow key={e.id} className={`group hover:bg-accent/5 transition-colors ${isAvoided(e) ? "bg-warning/5" : ""}`}>
                          <TableCell className="font-medium text-foreground whitespace-nowrap">{e.name}</TableCell>
                          <TableCell>
                            <StatusPill tone={meta.tone} dot={false}>
                              <Icon className="h-3 w-3" />{meta.label}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="max-w-[180px] break-words text-muted-foreground">{e.organization ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{e.title ?? "—"}</TableCell>
                          <TableCell className="max-w-[240px] break-words text-muted-foreground">{e.specialty ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {e.phone || e.email ? (
                              <span className="font-mono text-foreground/80">
                                {e.phone ?? ""} {e.email ?? ""}
                              </span>
                            ) : (
                              <span className="italic text-muted-foreground/60">仅录入人可见</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-wrap gap-1">
                              <StatusPill tone={expertReputation(e) >= 85 ? "success" : "info"} dot={false}>{expertReputation(e)}</StatusPill>
                              {expertProfileTags(e).slice(0, 2).map((tag) => (
                                <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {e.avoid_units ? (
                              <span className={`font-mono ${isAvoided(e) ? "text-warning font-bold" : "text-muted-foreground"}`}>
                                {e.avoid_units}
                              </span>
                            ) : <span className="text-muted-foreground/60">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <StatusPill tone={e.available ? "success" : "neutral"} dot={false}>
                              {e.available ? "审核通过" : "停用"}
                            </StatusPill>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" onClick={() => openParticipation(e)} className="h-8 w-8" title="参与项目">
                                <HistoryIcon className="h-4 w-4 text-accent" />
                              </Button>
                              <PermissionGate require="canManage">
                                <Button variant="ghost" size="icon" onClick={() => openEdit(e)} className="h-8 w-8" title="编辑专家">
                                  <Pencil className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </PermissionGate>
                              <PermissionGate require="canManage">
                                <Button variant="ghost" size="icon" onClick={() => toggleAvailable(e)} className="h-8 w-8" title={e.available ? "设为停用" : "审核入库"}>
                                  <ShieldCheck className={`h-4 w-4 ${e.available ? "text-success" : "text-gold"}`} />
                                </Button>
                              </PermissionGate>
                              <PermissionGate require="canManage">
                                <Button variant="ghost" size="icon" onClick={() => del(e.id)} className="h-8 w-8">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </PermissionGate>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </Card>

      <Dialog open={smartOpen} onOpenChange={setSmartOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" /> 智能抽取专家组
            </DialogTitle>
            <DialogDescription>
              选择关联项目并设置抽取数量后，系统会自动按人数完成抽取，并自动排除回避专家。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>关联项目（用于回避过滤）</Label>
              <Select value={avoidProjectId} onValueChange={applyAvoidProject}>
                <SelectTrigger><SelectValue placeholder="可不选；不选时仅按数量自动抽取" /></SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                当前回避单位：{avoidUnit || "未设置"}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {(["management", "finance", "business"] as const).map((type) => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <div key={type} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm">
                      <Icon className="h-4 w-4 text-accent" />
                      <span className="font-medium">{meta.label}</span>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={smartCounts[type]}
                      onChange={(e) => setSmartCounts({
                        ...smartCounts,
                        [type]: Math.max(0, Number(e.target.value) || 0),
                      })}
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <Label>筛选关键词（可选）</Label>
              <Input
                value={smartKeyword}
                onChange={(e) => setSmartKeyword(e.target.value)}
                placeholder="如：林业、数字治理、停车、预算测算"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmartOpen(false)}>取消</Button>
            <Button variant="hero" onClick={smartPick} disabled={aiPicking}>
              {aiPicking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              开始自动抽取
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 人工抽取 Dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => { setManualOpen(o); if (!o) setManualSelected(new Set()); }}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Hand className="h-5 w-5 text-accent" /> 人工抽取专家组
            </DialogTitle>
            <DialogDescription>
              直接从专家库中手工勾选具体专家。人工抽取支持单独选择关联项目，并按该项目单位提示回避状态。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>关联项目（用于回避过滤）</Label>
            <Select value={manualProjectId} onValueChange={applyManualAvoidProject}>
              <SelectTrigger><SelectValue placeholder="可不选；不选时仅手工勾选，不做项目回避提示" /></SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              当前回避单位：{manualAvoidUnit || "未设置"}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">回避单位</div>
              <div className="mt-1 text-sm font-medium">{manualAvoidUnit || "未设置"}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">业务池</div>
              <div className="mt-1 text-sm font-medium">{manualPoolStats.business} 位</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">管理池</div>
              <div className="mt-1 text-sm font-medium">{manualPoolStats.management} 位</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">财务池</div>
              <div className="mt-1 text-sm font-medium">{manualPoolStats.finance} 位</div>
            </div>
          </div>
          <div className="flex flex-col gap-3 py-2 flex-1 overflow-hidden">
            <Input placeholder="搜索姓名/专业/单位…" value={manualKeyword} onChange={e => setManualKeyword(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="info" dot={false}>已选 {manualSelectedStats.total} 位</StatusPill>
              <StatusPill tone="gold" dot={false}>管理 {manualSelectedStats.management}</StatusPill>
              <StatusPill tone="success" dot={false}>财务 {manualSelectedStats.finance}</StatusPill>
              <StatusPill tone="info" dot={false}>业务 {manualSelectedStats.business}</StatusPill>
              {manualSelectedStats.conflicts > 0 && (
                <StatusPill tone="warning" dot={false}>回避冲突 {manualSelectedStats.conflicts} 位</StatusPill>
              )}
            </div>
            <div className="flex-1 overflow-auto border border-border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-10"></TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>类别</TableHead>
                    <TableHead>专业</TableHead>
                    <TableHead>单位</TableHead>
                    <TableHead>回避状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.filter(e => e.available && matchKeyword(e, manualKeyword)).map(e => {
                    const meta = TYPE_META[e.expert_type];
                    const checked = manualSelected.has(e.id);
                    const avoided = isManualAvoided(e);
                    return (
                      <TableRow key={e.id} className={`cursor-pointer ${avoided ? "bg-warning/5" : ""}`} onClick={() => {
                        const ns = new Set(manualSelected);
                        checked ? ns.delete(e.id) : ns.add(e.id);
                        setManualSelected(ns);
                      }}>
                        <TableCell><Checkbox checked={checked} /></TableCell>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell><StatusPill tone={meta.tone} dot={false}>{meta.label}</StatusPill></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.specialty ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{e.organization ?? "—"}</TableCell>
                        <TableCell>
                          {avoided ? <StatusPill tone="warning" dot={false}>需回避</StatusPill> : <StatusPill tone="success" dot={false}>可选</StatusPill>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualOpen(false)}>取消</Button>
              <Button variant="hero" onClick={manualPickBySelection} disabled={manualSelected.size === 0}>
                确认 {manualSelected.size} 位专家
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notice Dialog */}
      <Dialog open={noticeOpen} onOpenChange={(o) => { setNoticeOpen(o); if (!o) { setNoticeHtml(null); setNoticeMeta(null); }}}>
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-accent" /> 生成专家评审组任命书
            </DialogTitle>
            <DialogDescription>
              AI 自动生成正式公文，包含项目/职责/期限/盖章位，可下载 PDF 并入档至资料库
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col overflow-y-auto px-6 pb-4">
            <div className="shrink-0">
              <div className="grid grid-cols-1 gap-3 py-2 md:grid-cols-3">
                <div>
                  <Label>关联项目</Label>
                  <Select value={noticeProjectId} onValueChange={setNoticeProjectId}>
                    <SelectTrigger><SelectValue placeholder="选择项目（必填以入档）" /></SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>任命期限（天）</Label>
                  <Input type="number" min={1} max={365} value={noticeDuration}
                    onChange={(e) => setNoticeDuration(Math.max(1, Number(e.target.value) || 30))} />
                </div>
                <div className="flex items-end">
                  <Button onClick={generateNotice} disabled={noticeLoading} className="w-full" variant="hero">
                    {noticeLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</> : <><Sparkles className="h-4 w-4" /> AI 生成任命书</>}
                  </Button>
                </div>
              </div>
              <div>
                <Label>特别职责要求（可选）</Label>
                <Input value={noticeDuty} onChange={(e) => setNoticeDuty(e.target.value)} placeholder="例如：重点核查招投标合规性..." />
              </div>

              {noticeMeta && (
                <div className="flex flex-wrap gap-2 pt-2 text-xs">
                  <StatusPill tone="info" dot={false}>文号 {noticeMeta.notice_no}</StatusPill>
                  <StatusPill tone="success" dot={false}>{noticeMeta.start_date} → {noticeMeta.end_date}</StatusPill>
                  <StatusPill tone="gold" dot={false}>{picked?.length ?? 0} 位专家</StatusPill>
                </div>
              )}
            </div>

            <div className="mt-2 h-[52vh] min-h-[280px] max-h-[620px] overflow-hidden rounded-md border border-border bg-white">
              {noticePreviewHtml ? (
                <iframe
                  title="notice-preview"
                  srcDoc={noticePreviewHtml}
                  className="h-full w-full bg-white"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  {noticeLoading ? "AI 正在起草任命书..." : "点击上方「AI 生成任命书」开始"}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-4">
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Button className="w-full" variant="outline" onClick={() => setNoticeOpen(false)}>关 闭</Button>
            <Button className="w-full" variant="outline" onClick={downloadPdf} disabled={!noticeHtml}>
              <Download className="h-4 w-4" /> 下载 PDF
            </Button>
            <Button className="w-full" variant="outline" onClick={downloadWord} disabled={!noticeHtml}>
              <Download className="h-4 w-4" /> 下载 Word
            </Button>
            <Button className="w-full" variant="hero" onClick={archiveNotice} disabled={!noticeHtml || archiving || !noticeProjectId}>
              {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />} 入档资料库
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 参与项目对话框 */}
      <Dialog open={partOpen} onOpenChange={setPartOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-accent" /> {partExpert?.name} · 参与项目记录
            </DialogTitle>
            <DialogDescription>
              基于历史专家打分聚合，可用于评估资历、查重与回避判断
            </DialogDescription>
          </DialogHeader>
          {partLoading ? (
            <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />加载中…</div>
          ) : partList.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">该专家尚无打分记录</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>项目名称</TableHead>
                  <TableHead>预算单位</TableHead>
                  <TableHead className="text-right">打分指标数</TableHead>
                  <TableHead className="text-right">平均分</TableHead>
                  <TableHead>最近评分</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partList.map((p) => (
                  <TableRow key={p.project_id}>
                    <TableCell className="font-medium">{p.project_name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.project_unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.scored_count}</TableCell>
                    <TableCell className="text-right tabular-nums font-mono">{Number(p.avg_score).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(p.last_scored_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </>
  );
};

export default Experts;

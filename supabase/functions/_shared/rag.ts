import { chunkText, createTextEmbeddingAsync, vectorLiteral } from "./embedding.ts";
import {
  actualSourceFileName,
  buildSourceAliasEntries,
  buildSourceAliasCandidates,
  buildSourceAliasMap,
  buildPerFileEvidenceCoverage,
  extractServiceProviderMentions,
  formatSourceCitation,
  formatPerFileEvidenceCoverage,
  isSystemRecordEvidence,
  normalizeSourceKey,
  rankServiceProviderMentions,
  sourceDisplayName,
  type ServiceProviderMention,
  type SourceAliasCandidates,
  type SourceAliasMap,
} from "./reportEvidence.ts";
import {
  buildAuthoritativeTargetEvidenceDigest,
  extractAuthoritativeTargetFacts,
  formatAuthoritativeTargetRegister,
  type AuthoritativeTargetFact,
} from "./reportTargets.ts";

const STOPWORDS = new Set([
  "项目", "建设", "工作", "实施", "有关", "相关", "情况", "说明", "单位", "预算", "绩效", "评估",
  "意见", "报告", "方案", "目标", "内容", "材料", "管理", "资金", "工作组", "事前",
]);

const tokenize = (text: string) =>
  Array.from(new Set(
    (text ?? "")
      .toLowerCase()
      .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g)
      ?.filter((token) => !STOPWORDS.has(token)) ?? [],
  ));

const overlapScore = (queryTokens: string[], text: string) => {
  if (!queryTokens.length || !text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += token.length >= 4 ? 3 : 2;
  }
  return score;
};

const preview = (text: string, max = 260) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const GENERATED_REPORT_SOURCE_TYPES = new Set(["report", "report_version"]);

export const isGeneratedReportEvidence = (row: any) => {
  const sourceType = String(
    row?.source_type
      ?? row?.sourceType
      ?? row?.metadata?.source_type
      ?? row?.metadata?.sourceType
      ?? "",
  ).toLowerCase();
  if (GENERATED_REPORT_SOURCE_TYPES.has(sourceType)) return true;

  const identity = [
    row?.title,
    row?.file_name,
    row?.fileName,
    row?.category,
    row?.summary,
  ].filter(Boolean).join(" ");

  return /(?:^|[-_：:\s])系统生成报告|报告历史稿|系统生成报告（仅供参考）|^Performance Evaluation Report(?:\s*\(\d+\))?\.(?:docx?|pdf)\b|^第[一二三四五六七八九十百\d]+版(?:事前绩效)?评估报告(?:\s*\(\d+\))?\.(?:docx?|pdf)\b/i.test(identity);
};

// 图片同样是有效证据：扫描件、签章页和拍照留存的申报表都以图片上传，解析服务会
// 对它们做 OCR。把图片排除在外会让这些文件永远只有 0 片段，进而把整个项目的报告
// 生成卡在“未完成解析”上，而不是因为内容真的读不出来。
export const isReportReadableEvidenceFile = (fileName = "") =>
  /\.(doc|docx|docm|dot|dotx|xls|xlsx|xlsm|xlsb|csv|pdf|png|jpe?g|webp|bmp|tif?f)$/i
    .test(fileName);

export const looksCorruptedEvidenceText = (value: unknown) => {
  const text = String(value ?? "")
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 50) return false;
  const visibleChars = text.replace(/\s/g, "").length;
  if (!visibleChars) return false;
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  // Non-Chinese documents are out of scope for this check.
  if (chineseChars < 8) return false;
  // Scanned Chinese forms legitimately carry stray latin fragments and table
  // rules, and a single chunk holds up to 2400 characters. Counting those
  // fragments absolutely would discard a fully readable OCR page, so only treat
  // the text as garbled when the Chinese body is actually drowned out by them.
  if (chineseChars / visibleChars >= 0.25) return false;
  const latinTokens = text.match(/\b[A-Za-z]{1,5}\b/g) ?? [];
  const noiseMarks = text.match(/[|~_]{1,}|(?:-{3,})/g) ?? [];
  return latinTokens.length >= 8
    && (noiseMarks.length >= 1 || latinTokens.length >= 16);
};

export const normalizeEvidenceTextForPrompt = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw || looksCorruptedEvidenceText(raw)) return "";
  return raw
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, "$1")
    .replace(/\s+([，。；：、）】》])/g, "$1")
    .replace(/([（【《])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
};

const uniqueBy = <T>(items: T[], keyOf: (item: T) => string) => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const normalizeFact = (value: string) => value.replace(/\s+/g, " ").trim();

const extractFactSignals = (text: string) => {
  const source = String(text ?? "");
  const patterns = [
    /(?:人民币)?\s*\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元|万)/g,
    /(?:≥|≤|>=|<=|不低于|不高于|不少于|不超过|至少|至多|超过|超)?\s*\d[\d,]*(?:\.\d+)?\s*(?:标箱|非标箱|箱|件|份|个|套|人|户|天|月|年|小时|次|项|%|％)/g,
    /(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi,
    /20\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g,
    /(?:节约|降低|减少|压缩|提升|增长|下降)[^。\n；]{0,70}\d+(?:\.\d+)?\s*(?:亿元|万元|元|万|%|％|小时|天|月|年)/g,
    /(?:满意度|成功率|效率|投诉率|完好率|准确率|响应率|达标率|合格率)[^。\n；]{0,60}(?:\d+(?:\.\d+)?\s*(?:%|％)|\d+\s*次)/g,
    /\d+(?:\.\d+)?\s*元\s*\/?\s*[\u4e00-\u9fa5A-Za-z0-9]+\s*\/?\s*(?:年|月|天|次|件|箱)?/g,
    /(?:供应商|服务商|中标|成交|合同|结算|询价|单一来源|资质|单价|收费标准|应急)[^。\n；]{0,80}/g,
    /(?:数量指标|质量指标|进度指标|成本指标|效益指标|满意度|目标值|完好率|响应率|达标率|准确率|成功率|投诉率|合格率)[^。\n；]{0,80}/g,
  ];

  const signals: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = normalizeFact(match[0] ?? "");
      if (value.length >= 2) signals.push(value);
    }
  }
  return uniqueBy(signals, (item) => item.toLowerCase()).slice(0, 18);
};

const extractCitationPhrases = (text: string) => {
  const source = String(text ?? "");
  const patterns = [
    /《[^》]{4,80}》/g,
    /(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi,
    /(?:京|国|财|档|发改|社保)[\u4e00-\u9fa5]{0,10}(?:发|规|函|办|通)?[〔\[]?20\d{2}[〕\]]?\s*\d{1,5}\s*号/g,
    /(?:人民币)?\s*\d[\d,]*(?:\.\d+)?\s*(?:万元|元|万)/g,
    /(?:≥|≤|>=|<=|不低于|不高于|不少于|不超过|至少|至多|超过|超)?\s*\d[\d,]*(?:\.\d+)?\s*(?:标箱|箱|件|份|个|套|人|天|月|年|次|项|%|％)/g,
    /(?:预算金额|合同金额|结算金额|保管费|运输费|服务费|收费标准|单价|目标值|完好率|达标率|响应率|满意度)[^。；，\n]{0,36}/g,
    /(?:数量指标|质量指标|成本指标|进度指标|效益指标|满意度指标|可持续影响指标)[^。；，\n]{0,36}/g,
  ];

  const phrases: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = normalizeFact(match[0] ?? "").replace(/^《|》$/g, "");
      if (value.length >= 3 && value.length <= 90) phrases.push(value);
    }
  }

  return uniqueBy([...extractFactSignals(source), ...phrases], (item) => item.toLowerCase())
    .filter((item) => !STOPWORDS.has(item))
    .slice(0, 30);
};

const classifyEvidenceType = (text: string) => {
  const value = String(text ?? "");
  if (/预算|测算|金额|单价|收费|合同|结算|询价|标箱|报价|成本/.test(value)) return "预算成本";
  if (/绩效目标|目标值|数量指标|质量指标|成本指标|进度指标|效益指标|满意度/.test(value)) return "绩效目标";
  if (/实施方案|工作方案|流程|进度|人员分工|风险|应急|安全|保密|抽检|检查/.test(value)) return "实施方案";
  if (/政策|依据|标准|规范|档案法|政府采购|DA\/T|DAT|GB\/T|ISO/.test(value)) return "政策标准";
  if (/会议|纪要|专家|意见|评分|扣分|建议|评审/.test(value)) return "会议专家";
  if (/采购|供应商|服务商|资质|遴选|中标|成交/.test(value)) return "采购服务";
  return "其他资料";
};

const factAreaForText = (text: string) => {
  const type = classifyEvidenceType(text);
  return type === "其他资料" ? "项目背景" : type;
};

const FACT_AREAS = [
  {
    label: "项目基本事实",
    terms: ["项目名称", "项目单位", "主管部门", "项目属性", "实施周期", "项目背景", "项目内容"],
  },
  {
    label: "预算与成本测算",
    terms: ["预算", "金额", "测算", "明细", "单价", "合同", "结算", "收费", "标箱", "运输费", "保管费", "应急"],
  },
  {
    label: "绩效目标与指标值",
    terms: ["绩效目标", "指标值", "数量指标", "质量指标", "进度指标", "成本指标", "效益指标", "满意度", "响应率", "完好率"],
  },
  {
    label: "政策依据与标准规范",
    terms: ["政策依据", "档案法", "规范", "标准", "DA/T", "DAT", "京社保", "行业规划", "发展规划"],
  },
  {
    label: "实施方案与管理措施",
    terms: ["实施方案", "工作方案", "流程", "进度安排", "人员分工", "风险", "应急预案", "安全", "保密", "抽检", "检查"],
  },
  {
    label: "采购与服务商依据",
    terms: ["采购", "询价", "比价", "服务商", "供应商", "第三方", "延续", "合同", "资质", "中标", "成交"],
  },
  {
    label: "会议与专家意见",
    terms: ["会议", "纪要", "专家", "意见", "评分", "扣分", "建议", "评审"],
  },
];

const SECTION_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export const normalizeEvidenceText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。；：、“”‘’（）()《》【】,.!?！？;:"'[\]{}]/g, "")
    .toLowerCase();

export const isEvidenceSupported = (quote: unknown, corpus: string, minLength = 8) => {
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length < minLength) return false;
  const normalizedCorpus = normalizeEvidenceText(corpus);
  if (normalizedCorpus.includes(normalizedQuote)) return true;

  const tokens = normalizedQuote.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) ?? [];
  if (tokens.length < 3) return false;
  const hits = tokens.filter((token) => normalizedCorpus.includes(token)).length;
  return hits / tokens.length >= 0.75;
};

export interface ProjectInput {
  id?: string;
  name?: string | null;
  unit?: string | null;
  category?: string | null;
  description?: string | null;
}

const emptyStats = () => ({
  materialSnippets: 0,
  knowledgeSnippets: 0,
  materialOverviewFiles: 0,
  priorityMaterialChunks: 0,
  reportEvidenceSnippets: 0,
  historicalReports: 0,
  goalTargets: 0,
});

const normalizeProject = (project: ProjectInput | null | undefined) => ({
  id: project?.id,
  name: project?.name ?? "",
  unit: project?.unit ?? "",
  category: project?.category ?? null,
  description: project?.description ?? null,
});

const resolveProject = async (supabase: any, project: ProjectInput) => {
  const normalized = normalizeProject(project);

  if (normalized.id && normalized.name && normalized.unit) return normalized;

  if (normalized.id) {
    const { data } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .eq("id", normalized.id)
      .maybeSingle();
    if (data) return normalizeProject({ ...normalized, ...data });
  }

  if (normalized.name) {
    const { data: exactRows } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .eq("name", normalized.name)
      .limit(1);
    const exact = exactRows?.[0];
    if (exact) return normalizeProject({ ...normalized, ...exact });

    const { data: fuzzyRows } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .ilike("name", `%${normalized.name}%`)
      .limit(1);
    const fuzzy = fuzzyRows?.[0];
    if (fuzzy) return normalizeProject({ ...normalized, ...fuzzy });
  }

  return normalized;
};

const evidenceQueryForDimension = (dimension: string, project: ReturnType<typeof normalizeProject>, extra = "") => {
  const name = dimension.trim();
  const terms = [name, project.name, project.unit, project.category, extra].filter(Boolean) as string[];
  const push = (...items: string[]) => terms.push(...items);

  if (/经济|成本|预算|资金|收费|投入|支出|金额/.test(name)) {
    push(
      "分项预算明细", "预算测算", "预算明细", "资金测算", "项目收费", "收费标准",
      "历史合同", "合同金额", "结算清单", "结算明细", "单价", "标箱", "非标箱",
      "折算", "市场询价", "同类项目", "政策限额", "55", "65", "58",
    );
  }

  if (/目标|绩效|效益|产出|合理|质量|数量|满意|可持续/.test(name)) {
    push(
      "绩效目标申报表", "绩效目标", "指标值", "衡量口径", "支撑资料",
      "档案完好率", "抽检", "抽样", "合格率", "监测手段", "季度检查",
      "现场检查", "服务对象满意度", "可持续影响",
    );
  }

  if (/可行|实施|效率|进度|组织|方案|管理|流程/.test(name)) {
    push(
      "实施方案", "工作方案", "作业流程", "四阶段", "进度安排", "人员分工",
      "应急预案", "三层级", "风险控制", "供应商资质", "遴选方式", "单一来源",
      "ISO9001", "国家秘密载体", "保密资质", "服务承诺",
    );
  }

  if (/必要|立项|政策|依据|背景/.test(name)) {
    push(
      "政策依据", "立项依据", "申请报告", "项目背景", "现实需求", "必要性",
      "主管部门", "行业规划", "财政支出", "公共服务", "存量问题",
    );
  }

  return Array.from(new Set(terms)).join(" ");
};

const matchedTermsFor = (queryTokens: string[], content: string) => {
  const lower = content.toLowerCase();
  return queryTokens.filter((token) => lower.includes(token)).slice(0, 8);
};

const mergeEvidenceRows = (rows: any[], queryTokens: string[], limit: number) => {
  const merged = new Map<string, any>();

  for (const row of rows) {
    if (!row?.content) continue;
    const key = row.chunk_id ?? `${row.file_id ?? row.file_name}-${row.chunk_index ?? row.content.slice(0, 24)}`;
    const searchable = [row.title, row.file_name, row.category, row.content].filter(Boolean).join(" ");
    const lexicalScore = overlapScore(queryTokens, searchable);
    const vectorScore = Number(row.similarity ?? 0) * 10;
    const keywordScore = Number(row.keyword_score ?? 0);
    const score = lexicalScore + vectorScore + keywordScore;
    const previous = merged.get(key);
    if (!previous || score > previous.score) {
      merged.set(key, {
        ...row,
        score,
        matchedTerms: matchedTermsFor(queryTokens, searchable),
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const diversifyEvidenceRows = (rows: any[], limit: number) => {
  const sorted = [...rows].sort((a, b) => Number(b.score ?? b.hybrid_score ?? 0) - Number(a.score ?? a.hybrid_score ?? 0));
  const selected: any[] = [];
  const perFile = new Map<string, number>();
  const perCategory = new Map<string, number>();

  for (const row of sorted) {
    if (selected.length >= limit) break;
    const fileKey = String(row.file_id ?? row.title ?? row.file_name ?? "unknown");
    const categoryKey = String(row.category ?? row.evidence_type ?? "其他");
    const fileUsed = perFile.get(fileKey) ?? 0;
    const categoryUsed = perCategory.get(categoryKey) ?? 0;
    if (fileUsed >= 3 && selected.length >= Math.ceil(limit * 0.55)) continue;
    if (categoryUsed >= 5 && selected.length >= Math.ceil(limit * 0.72)) continue;
    perFile.set(fileKey, fileUsed + 1);
    perCategory.set(categoryKey, categoryUsed + 1);
    selected.push(row);
  }

  return selected.length >= limit ? selected : uniqueBy([...selected, ...sorted], (row) =>
    String(row.chunk_id ?? `${row.file_id}:${row.chunk_index}:${row.content?.slice(0, 20)}`)
  ).slice(0, limit);
};

const stripGeneratedHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const safeGeneratedFileName = (prefix: string, title: string, fallbackId: string) => {
  const safeTitle = (title || fallbackId || "系统原文")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "")
    .slice(0, 64);
  return `${prefix}-${safeTitle || fallbackId}.docx`;
};

const collectGeneratedProjectSources = async (supabase: any, projectId: string) => {
  const files: any[] = [];
  const chunks: any[] = [];

  const addDocument = (input: {
    sourceType: string;
    sourceId: string;
    title: string;
    filePrefix: string;
    category: string;
    content: string;
    summary?: string;
    updatedAt?: string | null;
    basePriority?: number;
    allowFactSignals?: boolean;
  }) => {
    const content = stripGeneratedHtml(input.content);
    if (!content || content.length < 8) return;

    const sourceId = String(input.sourceId);
    const fileId = `system-${input.sourceType}-${sourceId}`;
    const title = input.title || "系统生成原文";
    const fileName = safeGeneratedFileName(input.filePrefix, title, sourceId);
    const pieces = chunkText(content, 1100, 140).slice(0, 80);
    if (!pieces.length) return;

    files.push({
      id: fileId,
      title,
      file_name: fileName,
      file_path: null,
      category: input.category,
      summary: input.summary || preview(content, 260),
      chunk_count: pieces.length,
      status: "indexed",
      error_message: null,
      updated_at: input.updatedAt,
      source_type: input.sourceType,
      source_id: sourceId,
      is_generated: true,
    });

    for (const [index, piece] of pieces.entries()) {
      const searchable = [title, fileName, input.category, input.summary, piece].filter(Boolean).join(" ");
      const evidenceType = classifyEvidenceType(searchable);
      const signals = input.allowFactSignals === false ? [] : extractFactSignals(searchable);
      chunks.push({
        id: `${fileId}-chunk-${index}`,
        file_id: fileId,
        project_id: projectId,
        chunk_index: index,
        content: piece,
        metadata: {
          generated: true,
          source_type: input.sourceType,
          source_id: sourceId,
        },
        title,
        file_name: fileName,
        category: input.category || evidenceType,
        evidence_type: evidenceType,
        summary: input.summary || preview(content, 260),
        fact_signals: signals,
        priority: (input.basePriority ?? 16) + signals.length * 2 + 8,
      });
    }
  };

  try {
    const { data, error } = await supabase
      .from("meeting_minutes")
      .select("id,title,meeting_date,content,updated_at,created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(80);
    if (error) throw error;
    for (const minute of data ?? []) {
      addDocument({
        sourceType: "meeting_minute",
        sourceId: minute.id,
        title: `会议纪要：${minute.title || minute.meeting_date || "未命名会议"}`,
        filePrefix: "会议纪要",
        category: "会议专家",
        summary: `${minute.meeting_date || ""} 会议纪要原文`.trim(),
        content: `会议主题：${minute.title || "未填写"}\n会议日期：${minute.meeting_date || "未填写"}\n\n${minute.content || ""}`,
        updatedAt: minute.updated_at || minute.created_at,
        basePriority: 28,
      });
    }
  } catch (error) {
    console.warn("collect generated meeting minutes failed", error);
  }

  try {
    const { data, error } = await supabase
      .from("meeting_recordings")
      .select("id,file_name,speaker,duration_sec,transcript,updated_at,created_at")
      .eq("project_id", projectId)
      .not("transcript", "is", null)
      .order("updated_at", { ascending: false })
      .limit(120);
    if (error) throw error;
    for (const recording of data ?? []) {
      addDocument({
        sourceType: "meeting_recording",
        sourceId: recording.id,
        title: `会议录音转写：${recording.speaker || recording.file_name || "发言记录"}`,
        filePrefix: "会议录音转写",
        category: "会议专家",
        summary: `录音转写原文；发言人：${recording.speaker || "未填写"}；时长：${recording.duration_sec || 0}秒`,
        content: recording.transcript,
        updatedAt: recording.updated_at || recording.created_at,
        basePriority: 30,
      });
    }
  } catch (error) {
    console.warn("collect generated meeting recordings failed", error);
  }

  try {
    const { data: records, error: recordError } = await supabase
      .from("field_records")
      .select("id,location,research_date,participants,findings,conclusion,updated_at,created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(80);
    if (recordError) throw recordError;
    const recordRows = records ?? [];
    for (const record of recordRows) {
      addDocument({
        sourceType: "field_record",
        sourceId: record.id,
        title: `现场调研记录：${record.location || record.research_date || "未命名点位"}`,
        filePrefix: "现场调研记录",
        category: "现场调研",
        summary: `${record.research_date || ""} ${record.location || ""}`.trim(),
        content: [
          `调研地点：${record.location || "未填写"}`,
          `调研日期：${record.research_date || "未填写"}`,
          `参与人员：${record.participants || "未填写"}`,
          `调研发现：${record.findings || "未填写"}`,
          `调研结论：${record.conclusion || "未填写"}`,
        ].join("\n"),
        updatedAt: record.updated_at || record.created_at,
        basePriority: 22,
      });
    }

    const recordIds = recordRows.map((record: any) => record.id).filter(Boolean);
    if (recordIds.length) {
      const { data: audios, error: audioError } = await supabase
        .from("field_audios")
        .select("id,record_id,file_path,duration_sec,transcript,updated_at,created_at")
        .in("record_id", recordIds)
        .not("transcript", "is", null)
        .order("updated_at", { ascending: false })
        .limit(120);
      if (audioError) throw audioError;
      const recordMap = new Map(recordRows.map((record: any) => [record.id, record]));
      for (const audio of audios ?? []) {
        const record = recordMap.get(audio.record_id) ?? {};
        addDocument({
          sourceType: "field_audio",
          sourceId: audio.id,
          title: `现场调研录音转写：${record.location || audio.file_path || "未命名录音"}`,
          filePrefix: "现场调研录音转写",
          category: "现场调研",
          summary: `现场录音转写原文；点位：${record.location || "未填写"}；时长：${audio.duration_sec || 0}秒`,
          content: audio.transcript,
          updatedAt: audio.updated_at || audio.created_at,
          basePriority: 24,
        });
      }
    }
  } catch (error) {
    console.warn("collect generated field records failed", error);
  }

  try {
    const { data, error } = await supabase
      .from("evaluation_plans")
      .select("id,title,content,status,updated_at,created_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(80);
    if (error) throw error;
    for (const plan of data ?? []) {
      addDocument({
        sourceType: "evaluation_plan",
        sourceId: plan.id,
        title: `评估方案：${plan.title || "未命名方案"}`,
        filePrefix: "评估方案",
        category: "实施方案",
        summary: `系统内评估方案原文；状态：${plan.status || "draft"}`,
        content: plan.content,
        updatedAt: plan.updated_at || plan.created_at,
        basePriority: 20,
      });
    }
  } catch (error) {
    console.warn("collect generated evaluation plans failed", error);
  }

  return { files, chunks };
};

const collectProjectEvidenceLedger = async (supabase: any, projectId: string) => {
  const { data: files, error: fileError } = await supabase
    .from("knowledge_files")
    .select("id,title,file_name,category,summary,chunk_count,status,error_message,updated_at,source_type,source_id,file_path")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(260);
  if (fileError) throw fileError;

  const knowledgeRows = ((files ?? []) as any[])
    .filter((file: any) => !isGeneratedReportEvidence(file));
  let materialRows: any[] = [];
  try {
    const { data: materials, error: materialError } = await supabase
      .from("materials")
      .select("id,project_id,name,category,status,file_path,file_name,review_note,updated_at,created_at")
      .eq("project_id", projectId)
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false })
      .limit(300);
    if (materialError) throw materialError;
    materialRows = materials ?? [];
  } catch (error) {
    console.warn("collect project material ledger fallback failed", error);
  }

  const knowledgeBySourceId = new Map(
    knowledgeRows
      .filter((file: any) => file.source_type === "material" && file.source_id)
      .map((file: any) => [String(file.source_id), file]),
  );
  const knowledgeByPath = new Map(
    knowledgeRows
      .filter((file: any) => file.file_path)
      .map((file: any) => [String(file.file_path), file]),
  );

  const materialOnlyRows = materialRows
    .filter((material: any) =>
      !knowledgeBySourceId.has(String(material.id))
      && (!material.file_path || !knowledgeByPath.has(String(material.file_path)))
    )
    .map((material: any) => ({
      id: `material-${material.id}`,
      title: material.file_name || material.name || "项目资料",
      file_name: material.file_name || material.name || "项目资料",
      file_path: material.file_path,
      category: material.category || "项目资料",
      summary: material.review_note || `已上传文件：${material.file_name || material.name || "项目资料"}${material.name && material.file_name && material.name !== material.file_name ? `；资料项：${material.name}` : ""}`,
      chunk_count: 0,
      status: "uploaded",
      error_message: null,
      updated_at: material.updated_at || material.created_at,
      source_type: "material",
      source_id: material.id,
    }));

  const generatedLedger = await collectGeneratedProjectSources(supabase, projectId);

  const allFileRows = uniqueBy([...knowledgeRows, ...materialOnlyRows, ...generatedLedger.files], (file: any) =>
    String(`${file.source_type ?? "file"}:${file.source_id ?? file.file_path ?? file.id ?? `${file.title}:${file.file_name}`}`)
  )
    .filter((file: any) => !isGeneratedReportEvidence(file))
    .map((file: any) => ({
      ...file,
      summary: normalizeEvidenceTextForPrompt(file.summary)
        || `已上传文件：${file.file_name || file.title || "项目资料"}；正文识别质量不足，仅记录文件名。`,
    }));
  const fileRows = allFileRows.filter((file: any) =>
    isReportReadableEvidenceFile(String(file.file_name || file.file_path || file.title || ""))
  );
  if (!fileRows.length) return { files: allFileRows, chunks: [] };

  const fileMap = new Map(fileRows.map((file: any) => [file.id, file]));
  const { data: chunks, error: chunkError } = await supabase
    .from("knowledge_chunks")
    .select("id,file_id,project_id,chunk_index,content,metadata")
    .eq("project_id", projectId)
    .order("file_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(1600);
  if (chunkError) throw chunkError;

  const enrichedChunks = ((chunks ?? []) as any[])
    .filter((chunk: any) => fileMap.has(chunk.file_id))
    .filter((chunk: any) => Boolean(normalizeEvidenceTextForPrompt(chunk.content)))
    .map((chunk: any) => {
      const file = fileMap.get(chunk.file_id) ?? {};
      const content = normalizeEvidenceTextForPrompt(chunk.content);
      const searchable = [file.title, file.file_name, file.category, file.summary, content].filter(Boolean).join(" ");
      const evidenceType = classifyEvidenceType(searchable);
      const signals = extractFactSignals(searchable);
      return {
        ...chunk,
        content,
        title: sourceDisplayName(file),
        file_name: file.file_name,
        category: file.category ?? evidenceType,
        evidence_type: evidenceType,
        summary: file.summary,
        fact_signals: signals,
        priority: priorityMaterialRank(file) + signals.length * 2 + overlapScore(tokenize(file.title || file.file_name || ""), searchable),
      };
    })
    .sort((a: any, b: any) => Number(b.priority ?? 0) - Number(a.priority ?? 0));

  const generatedChunks = (generatedLedger.chunks ?? [])
    .filter((chunk: any) => !isGeneratedReportEvidence(chunk))
    .filter((chunk: any) => fileMap.has(chunk.file_id))
    .map((chunk: any) => ({
      ...chunk,
      priority: Number(chunk.priority ?? 0) + 4,
    }));

  const allChunks = uniqueBy([...generatedChunks, ...enrichedChunks], (chunk: any) =>
    String(chunk.id ?? `${chunk.file_id}:${chunk.chunk_index}:${chunk.content?.slice(0, 20)}`)
  ).sort((a: any, b: any) => Number(b.priority ?? 0) - Number(a.priority ?? 0));

  return { files: allFileRows, chunks: allChunks };
};

export interface ReportCitationCandidate {
  text: string;
  sourceTitle: string;
  fileName: string | null;
  category: string | null;
  snippet: string;
  location: string;
}

export const buildReportCitationCandidates = async (
  supabase: any,
  projectInput: ProjectInput,
  reportContent: string,
  limit = 90,
) => {
  const project = await resolveProject(supabase, projectInput);
  const reportText = String(reportContent ?? "").replace(/\s+/g, " ").trim();
  if (!project.id || !reportText) return [];

  const ledger = await collectProjectEvidenceLedger(supabase, project.id);
  const candidates: Array<ReportCitationCandidate & { score: number }> = [];
  const targetFacts = extractAuthoritativeTargetFacts(
    ledger.chunks.map((chunk: any) => ({
      text: String(chunk.content ?? ""),
      sourceName: sourceDisplayName(chunk),
      location: Number.isFinite(Number(chunk.chunk_index)) ? `片段 ${Number(chunk.chunk_index) + 1}` : "资料正文",
      sourceType: chunk.source_type ?? null,
    })),
  );

  const addCandidate = (phrase: string, row: any, scoreBoost = 0) => {
    const text = normalizeFact(phrase).replace(/^《|》$/g, "");
    if (text.length < 3 || text.length > 90) return;
    if (!reportText.includes(text)) return;
    const sourceTitle = sourceDisplayName(row);
    const location = Number.isFinite(Number(row.chunk_index)) ? `片段 ${Number(row.chunk_index) + 1}` : "资料摘要";
    candidates.push({
      text,
      sourceTitle,
      fileName: row.file_name ?? null,
      category: row.category ?? row.evidence_type ?? null,
      snippet: preview(row.content || row.summary || sourceTitle, 240),
      location,
      score: text.length + scoreBoost + Number(row.priority ?? 0) * 0.2,
    });
  };

  for (const chunk of ledger.chunks) {
    const phrases = extractCitationPhrases([
      chunk.title,
      chunk.file_name,
      chunk.category,
      chunk.summary,
      chunk.content,
    ].filter(Boolean).join(" "));
    for (const phrase of phrases) addCandidate(phrase, chunk, 20);
  }

  for (const file of ledger.files) {
    const title = sourceDisplayName(file);
    if (title) addCandidate(title, { ...file, content: file.summary || title }, 12);
    for (const phrase of extractCitationPhrases([title, file.category, file.summary].filter(Boolean).join(" "))) {
      addCandidate(phrase, { ...file, content: file.summary || title }, 8);
    }
  }

  for (const fact of targetFacts) {
    const factPattern = new RegExp(
      `${fact.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^。；\\n]{0,36}?${fact.displayValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    const matched = reportText.match(factPattern)?.[0];
    if (!matched) continue;
    candidates.push({
      text: matched,
      sourceTitle: fact.sourceName,
      fileName: fact.sourceName,
      category: "绩效目标",
      snippet: fact.excerpt,
      location: fact.location,
      score: matched.length + 120,
    });
  }

  return uniqueBy(
    candidates
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length)
      .filter((item, index, list) => !list.slice(0, index).some((prev) => prev.text.includes(item.text) && prev.sourceTitle === item.sourceTitle))
      .slice(0, limit),
    (item) => `${item.text.toLowerCase()}::${item.sourceTitle}`,
  ).map(({ score: _score, ...item }) => item);
};

export interface ReportEvidenceCard {
  fileId: string | null;
  sourceTitle: string;
  fileName: string | null;
  category: string | null;
  status: "referenced" | "available";
  matchedReportPhrases: string[];
  facts: string[];
  snippets: Array<{
    location: string;
    text: string;
    matchedTerms: string[];
  }>;
}

export const buildReportEvidenceCards = async (
  supabase: any,
  projectInput: ProjectInput,
  reportContent = "",
  limit = 120,
): Promise<ReportEvidenceCard[]> => {
  const project = await resolveProject(supabase, projectInput);
  if (!project.id) return [];

  const reportText = normalizeFact(reportContent);
  const reportTokens = tokenize(reportText);
  const ledger = await collectProjectEvidenceLedger(supabase, project.id);
  const chunksByFile = new Map<string, any[]>();
  for (const chunk of ledger.chunks) {
    const key = String(chunk.file_id ?? "");
    if (!key) continue;
    const current = chunksByFile.get(key) ?? [];
    current.push(chunk);
    chunksByFile.set(key, current);
  }

  const cards = ledger.files.map((file: any) => {
    const title = sourceDisplayName(file);
    const fileChunks = (chunksByFile.get(String(file.id)) ?? []).map((chunk: any) => {
      const content = String(chunk.content ?? "");
      const phrases = extractCitationPhrases([title, file.file_name, file.category, file.summary, content].filter(Boolean).join(" "));
      const matchedPhrases = phrases.filter((phrase) => reportText.includes(normalizeFact(phrase)));
      const matchedTerms = matchedTermsFor(reportTokens, [title, file.file_name, file.category, content].filter(Boolean).join(" "));
      const score = matchedPhrases.length * 25
        + matchedTerms.length * 4
        + Number(chunk.priority ?? 0) * 0.3
        + (chunk.fact_signals?.length ?? 0) * 2;
      return {
        ...chunk,
        matchedPhrases,
        matchedTerms,
        score,
      };
    });

    const sortedChunks = fileChunks
      .filter((chunk: any) => String(chunk.content ?? "").trim())
      .sort((a: any, b: any) =>
        Number(b.score ?? 0) - Number(a.score ?? 0)
        || Number(a.chunk_index ?? 0) - Number(b.chunk_index ?? 0)
      );
    const selectedChunks = sortedChunks.slice(0, 3);
    const matchedReportPhrases = uniqueBy(
      selectedChunks.flatMap((chunk: any) => chunk.matchedPhrases ?? []),
      (item) => item.toLowerCase(),
    ).slice(0, 12);
    const facts = uniqueBy(
      [
        ...extractFactSignals([title, file.category, file.summary].filter(Boolean).join(" ")),
        ...selectedChunks.flatMap((chunk: any) => chunk.fact_signals ?? []),
      ],
      (item) => item.toLowerCase(),
    ).slice(0, 16);
    const fallbackText = file.summary || title;
    const snippets = selectedChunks.length
      ? selectedChunks.map((chunk: any) => ({
        location: Number.isFinite(Number(chunk.chunk_index)) ? `片段 ${Number(chunk.chunk_index) + 1}` : "资料摘要",
        text: preview(chunk.content, 520),
        matchedTerms: chunk.matchedTerms ?? [],
      }))
      : [{
        location: "资料摘要",
        text: preview(fallbackText, 520),
        matchedTerms: matchedTermsFor(reportTokens, fallbackText),
      }];
    const isReferenced = matchedReportPhrases.length > 0
      || snippets.some((snippet) => snippet.matchedTerms.length >= 2);

    return {
      fileId: file.id ?? null,
      sourceTitle: title,
      fileName: file.file_name ?? null,
      category: file.category ?? null,
      status: isReferenced ? "referenced" : "available",
      matchedReportPhrases,
      facts,
      snippets,
    } satisfies ReportEvidenceCard;
  });

  return cards
    .sort((a, b) =>
      (a.status === "referenced" ? -1 : 1) - (b.status === "referenced" ? -1 : 1)
      || b.matchedReportPhrases.length - a.matchedReportPhrases.length
      || b.facts.length - a.facts.length
      || a.sourceTitle.localeCompare(b.sourceTitle, "zh-CN")
    )
    .slice(0, limit);
};

export interface ReportRagDossier {
  project: ReturnType<typeof normalizeProject>;
  text: string;
  corpus: string;
  sourceNames: string[];
  systemRecordNames: string[];
  sourceDocuments: Array<{
    sourceName: string;
    text: string;
  }>;
  sectionContexts: {
    opening: string;
    evaluation: string;
    closing: string;
  };
  stats: {
    files: number;
    indexedFiles: number;
    unindexedFiles: number;
    chunks: number;
    factSignals: number;
    dimensionEvidence: number;
    conflicts: number;
    coveredFiles: number;
    resolvedProjectId: string | null;
  };
  fileCards: ReportEvidenceCard[];
  conflicts: string[];
  sourceAliases: SourceAliasMap;
  sourceAliasCandidates: SourceAliasCandidates;
  serviceProviders: ServiceProviderMention[];
  targetFacts: AuthoritativeTargetFact[];
  fileReviews: Array<{
    fileId: string;
    fileName: string;
    category: string;
    status: "read" | "unreadable";
    chunkCount: number;
    factCount: number;
  }>;
  dimensionReviews: Array<{
    dimension: string;
    evidenceCount: number;
    sourceNames: string[];
  }>;
}

const sourceRef = (row: any) => {
  const title = sourceDisplayName(row);
  const location = Number.isFinite(Number(row.chunk_index)) ? `片段${Number(row.chunk_index) + 1}` : "资料摘要";
  if (isSystemRecordEvidence(row)) {
    return `系统记录“${title}”/${location}`;
  }
  return `${formatSourceCitation(title)}/${location}`;
};

const scoreChunkForTerms = (chunk: any, terms: string[]) => {
  const searchable = [chunk.title, chunk.file_name, chunk.category, chunk.summary, chunk.content].filter(Boolean).join(" ");
  const tokens = tokenize(terms.join(" "));
  return overlapScore(tokens, searchable)
    + (chunk.fact_signals?.length ?? 0) * 2
    + Number(chunk.priority ?? 0) * 0.25
    + matchedTermsFor(tokens, searchable).length * 3;
};

const pickRepresentativeChunks = (chunks: any[], terms: string[], limit = 4) => {
  const tokens = tokenize(terms.join(" "));
  return chunks
    .map((chunk: any) => {
      const searchable = [chunk.title, chunk.file_name, chunk.category, chunk.summary, chunk.content].filter(Boolean).join(" ");
      return {
        ...chunk,
        score: scoreChunkForTerms(chunk, terms),
        matchedTerms: matchedTermsFor(tokens, searchable),
      };
    })
    .sort((a: any, b: any) =>
      Number(b.score ?? 0) - Number(a.score ?? 0)
      || Number(a.chunk_index ?? 0) - Number(b.chunk_index ?? 0)
    )
    .slice(0, limit);
};

const detectDossierConflicts = (files: any[], chunks: any[]) => {
  const corpus = [
    ...files.map((file: any) => [file.title, file.file_name, file.category, file.summary].filter(Boolean).join(" ")),
    ...chunks.map((chunk: any) => [chunk.title, chunk.file_name, chunk.category, chunk.content].filter(Boolean).join(" ")),
  ].join("\n");
  const conflicts: string[] = [];
  const standards = new Map<string, Set<string>>();
  const standardPattern = /((?:DA\/?\s*T|DAT|GB\/?\s*T|GB|DB\d+\/?\s*T|ISO)\s*[\w./]+)\s*[—－-]\s*(20\d{2})/gi;
  for (const match of corpus.matchAll(standardPattern)) {
    const standard = String(match[1] ?? "").replace(/\s+/g, "").toUpperCase();
    const year = String(match[2] ?? "");
    if (!standard || !year) continue;
    const versions = standards.get(standard) ?? new Set<string>();
    versions.add(year);
    standards.set(standard, versions);
  }
  for (const [standard, versions] of standards) {
    if (versions.size <= 1) continue;
    conflicts.push(`资料中同时出现 ${standard} 的多个年份版本（${Array.from(versions).sort().join("、")}）；报告必须按具体上传文件说明版本口径，不得自行替换或默认采用某一版本。`);
  }
  if (/政府采购流程|招投标|公开招标/.test(corpus) && /询价|延续使用|未再次三方比价|未再次比价/.test(corpus)) {
    conflicts.push("采购方式存在泛化表述风险：资料中出现询价、延续使用原服务商或未再次比价等口径时，报告不得笼统写成“按政府采购流程遴选服务商”。");
  }
  return conflicts;
};

interface HardFactClaim {
  label: string;
  value: string;
  source: string;
  excerpt: string;
  guard: string;
  priority: number;
}

const HARD_FACT_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
  guard: string;
  priority: number;
}> = [
  {
    label: "政策标准与规范",
    pattern: /(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi,
    guard: "报告只能引用资料原文中实际出现的标准名称和版本号，不得自行升级、降级或改写版本。",
    priority: 100,
  },
  {
    label: "金额与预算",
    pattern: /(?:人民币)?\s*\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元|万)/gi,
    guard: "资料已出现的金额不得写成未提供；如不同文件口径不一致，应列明具体文件和口径差异。",
    priority: 98,
  },
  {
    label: "数量与规模",
    pattern: /\d[\d,]*(?:\.\d+)?\s*(?:标箱|非标箱|箱|件|份|个|套|人|户|平方米|公里|台)/gi,
    guard: "资料已出现的数量和规模不得写成无法确认；引用时必须保留原单位和对应时间口径。",
    priority: 96,
  },
  {
    label: "时间与周期",
    pattern: /20\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|(?:实施|服务|合同|项目)[^。\n；]{0,50}(?:\d+\s*(?:天|月|年)|按月|按季|按季度|上半年|下半年)/gi,
    guard: "资料已出现的时间节点、合同期或实施周期不得写成未明确；不同口径应分别注明来源。",
    priority: 95,
  },
  {
    label: "单价与成本依据",
    pattern: /\d+(?:\.\d+)?\s*元\s*\/?\s*[\u4e00-\u9fa5A-Za-z0-9]+\s*\/?\s*(?:年|月|天|次|件|箱)?|(?:单价|收费标准|成本测算)[^。\n；]{0,100}/gi,
    guard: "资料已出现的单价和成本测算依据不得写成未提供；引用时应保留计价单位和适用期间。",
    priority: 94,
  },
  {
    label: "绩效目标与质量要求",
    pattern: /(?:目标值|达标率|完好率|准确率|响应率|满意度|成功率|投诉率|合格率)[^。\n；]{0,80}/gi,
    guard: "资料已出现的绩效目标值和质量要求不得写成缺失；没有数值的要求也不得擅自补充数值。",
    priority: 93,
  },
  {
    label: "采购与服务商",
    pattern: /(?:服务商|供应商|中标单位|成交单位|承接单位|受托单位|采购方式|询价|比价|单一来源)[^。\n；]{0,120}/gi,
    guard: "采购方式、服务商和合同关系必须按资料原文书写，不得使用泛化采购表述或遗漏已明确的公司。",
    priority: 92,
  },
  {
    label: "风险与管理措施",
    pattern: /(?:风险|应急预案|安全管理|保密|权限管理|备份机制|质量控制|检查机制)[^。\n；]{0,120}/gi,
    guard: "实施措施和风险控制必须来自对应方案、制度、合同或会议原文，不得由模板自动补写。",
    priority: 91,
  },
];

const sentenceAroundMatch = (text: string, index: number, fallbackMax = 360) => {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const startCandidates = ["。", "；", "\n"].map((mark) => source.lastIndexOf(mark, Math.max(0, index - 1)));
  const start = Math.max(-1, ...startCandidates) + 1;
  const endCandidates = ["。", "；", "\n"].map((mark) => {
    const found = source.indexOf(mark, index);
    return found < 0 ? Number.POSITIVE_INFINITY : found + 1;
  });
  const end = Math.min(...endCandidates);
  const excerpt = source.slice(start, Number.isFinite(end) ? end : index + fallbackMax).trim();
  return preview(excerpt || source.slice(Math.max(0, index - 120), index + fallbackMax), fallbackMax);
};

const extractHardFactClaims = (files: any[], chunks: any[]): HardFactClaim[] => {
  const rows = [
    ...files.map((file: any) => ({
      source: `《${sourceDisplayName(file)}》/资料摘要`,
      text: [file.title, file.file_name, file.category, file.summary].filter(Boolean).join(" "),
      basePriority: priorityMaterialRank(file),
    })),
    ...chunks.map((chunk: any) => ({
      source: sourceRef(chunk),
      text: [chunk.title, chunk.file_name, chunk.category, chunk.summary, chunk.content].filter(Boolean).join(" "),
      basePriority: Number(chunk.priority ?? 0),
    })),
  ];

  const claims: HardFactClaim[] = [];
  for (const row of rows) {
    for (const rule of HARD_FACT_PATTERNS) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
      for (const match of row.text.matchAll(pattern)) {
        const value = normalizeFact(match[0] ?? "");
        if (!value) continue;
        claims.push({
          label: rule.label,
          value,
          source: row.source,
          excerpt: sentenceAroundMatch(row.text, match.index ?? 0),
          guard: rule.guard,
          priority: rule.priority + row.basePriority * 0.1 + Math.min(12, value.length / 4),
        });
      }
    }
  }

  return uniqueBy(
    claims
      .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label, "zh-CN")),
    (item) => `${item.label}:${item.value}:${item.source}`,
  ).slice(0, 90);
};

const formatHardFactClaims = (claims: HardFactClaim[]) => {
  if (!claims.length) return "当前资料未抽取到硬事实卡片。";
  const grouped = new Map<string, HardFactClaim[]>();
  for (const claim of claims) {
    const current = grouped.get(claim.label) ?? [];
    current.push(claim);
    grouped.set(claim.label, current);
  }
  return Array.from(grouped.entries())
    .map(([label, items], groupIndex) => {
      const guard = items[0]?.guard ?? "";
      const lines = items.slice(0, 8).map((item, index) =>
        `${groupIndex + 1}.${index + 1} ${item.value}（来源：${item.source}）原文：${item.excerpt}`
      );
      return `【${label}】\n禁止否认：${guard}\n${lines.join("\n")}`;
    })
    .join("\n\n");
};

const formatUnindexedFiles = (files: any[]) => {
  const rows = files
    .filter((file: any) => file.status !== "indexed" || Number(file.chunk_count ?? 0) <= 0)
    .sort((a: any, b: any) => priorityMaterialRank(b) - priorityMaterialRank(a))
    .slice(0, 160)
    .map((file: any, index: number) => {
      const title = sourceDisplayName(file);
      const category = file.category ?? classifyEvidenceType([title, file.summary].filter(Boolean).join(" "));
      const status = file.status || "uploaded";
      const reason = file.error_message ? `；索引说明：${preview(file.error_message, 160)}` : "";
      const summary = file.summary ? `；摘要：${preview(file.summary, 260)}` : "";
      return `${index + 1}. 《${title}》[${category}｜${status}｜0片段]${reason}${summary}`;
    });
  return rows.join("\n");
};

export const buildReportRagDossier = async (
  supabase: any,
  projectInput: ProjectInput,
  dimensions: string[] = [],
  extra = "",
): Promise<ReportRagDossier> => {
  const project = await resolveProject(supabase, projectInput);
  const empty = {
    project,
    text: "【项目资料依据】\n当前项目暂无可直接引用的 Word/Excel 正文资料，报告只能依据项目基础信息和人工补充内容生成。",
    corpus: "",
    sectionContexts: {
      opening: "【项目资料依据】\n当前项目暂无可直接引用的 Word/Excel 正文资料。",
      evaluation: "【项目资料依据】\n当前项目暂无可直接引用的 Word/Excel 正文资料。",
      closing: "【项目资料依据】\n当前项目暂无可直接引用的 Word/Excel 正文资料。",
    },
    stats: {
      files: 0,
      indexedFiles: 0,
      unindexedFiles: 0,
      chunks: 0,
      factSignals: 0,
      dimensionEvidence: 0,
      conflicts: 0,
      coveredFiles: 0,
      resolvedProjectId: project.id ?? null,
    },
    fileCards: [],
    conflicts: [],
    sourceNames: [],
    systemRecordNames: [],
    sourceDocuments: [],
    sourceAliases: {},
    sourceAliasCandidates: {},
    serviceProviders: [],
    targetFacts: [],
    fileReviews: [],
    dimensionReviews: [],
  };
  if (!project.id) return empty;

  let ledger;
  try {
    ledger = await collectProjectEvidenceLedger(supabase, project.id);
  } catch (error) {
    console.warn("build report rag dossier failed", error);
    return {
      ...empty,
      text: "【项目资料依据】\n当前项目资料读取失败，报告生成应提示先核对可解析的 Word/Excel 资料。",
    };
  }

  // Historical/generated reports are outputs, not evidence for a new report.
  // Keep other system-generated originals (meeting minutes, field records, etc.)
  // because they are first-party project records.
  const files = ledger.files.filter((file: any) =>
    !["report", "report_version"].includes(String(file.source_type ?? ""))
  );
  const evidenceFileIds = new Set(files.map((file: any) => String(file.id)));
  const chunks = ledger.chunks.filter((chunk: any) =>
    evidenceFileIds.has(String(chunk.file_id))
  );
  const indexedFiles = files.filter((file: any) =>
    file.status === "indexed" && Number(file.chunk_count ?? 0) > 0
  ).length;
  const unindexedFiles = Math.max(0, files.length - indexedFiles);
  const conflicts = detectDossierConflicts(files, chunks);
  const targetFacts = extractAuthoritativeTargetFacts(
    chunks
      .filter((chunk: any) => !["report", "report_version"].includes(String(chunk.source_type ?? "")))
      .map((chunk: any) => ({
        text: String(chunk.content ?? ""),
        sourceName: sourceDisplayName(chunk),
        location: Number.isFinite(Number(chunk.chunk_index)) ? `片段 ${Number(chunk.chunk_index) + 1}` : "资料正文",
        sourceType: chunk.source_type ?? null,
      })),
  );
  const targetRegisterText = formatAuthoritativeTargetRegister(targetFacts);
  const hardFactClaims = extractHardFactClaims(files, chunks);
  const coverageItems = buildPerFileEvidenceCoverage(files, chunks, {
    totalCharacters: 26000,
    maxFiles: 160,
  });
  const perFileText = formatPerFileEvidenceCoverage(coverageItems);
  const unindexedFileText = formatUnindexedFiles(files);
  const allFacts = uniqueBy(
    chunks.flatMap((chunk: any) => (chunk.fact_signals ?? []).map((fact: string) => ({
      fact,
      source: sourceRef(chunk),
      category: chunk.category ?? chunk.evidence_type ?? "项目资料",
    }))),
    (item) => `${item.fact}:${item.source}`,
  ).slice(0, 140);

  const factAreaSections = FACT_AREAS.map((area) => {
    const evidence = pickRepresentativeChunks(chunks, [...area.terms, project.name, project.unit, extra], 6);
    return `【${area.label}】\n${evidence.length
      ? evidence.map((row: any, index: number) =>
        `${index + 1}. ${sourceRef(row)}${row.matchedTerms?.length ? `；命中词：${row.matchedTerms.join("、")}` : ""}：${preview(row.content, 640)}`
      ).join("\n")
      : "根据现有资料暂未见该类证据。"
    }`;
  });

  const dimensionSections = dimensions.map((dimension, index) => {
    const query = evidenceQueryForDimension(dimension, project, extra);
    const evidence = pickRepresentativeChunks(chunks, [dimension, query], 8);
    return `【${SECTION_LABELS[index] ?? String(index + 1)}、${dimension}】\n${evidence.length
      ? evidence.map((row: any, evidenceIndex: number) =>
        `${evidenceIndex + 1}. ${sourceRef(row)}${row.matchedTerms?.length ? `；命中词：${row.matchedTerms.join("、")}` : ""}：${preview(row.content, 760)}`
      ).join("\n")
      : "根据现有资料暂未见该指标的直接证据。"
    }`;
  });
  const dimensionReviews = dimensions.map((dimension) => {
    const query = evidenceQueryForDimension(dimension, project, extra);
    const evidence = pickRepresentativeChunks(chunks, [dimension, query], 8);
    return {
      dimension,
      evidenceCount: evidence.length,
      sourceNames: uniqueBy(
        evidence.map((row: any) => sourceDisplayName(row)).filter(Boolean),
        (name) => name.toLowerCase(),
      ),
    };
  });
  const fileRowsById = new Map(files.map((file: any) => [String(file.id ?? ""), file]));
  const fileReviews = coverageItems.map((item) => {
    const readable = item.indexedChunkCount > 0;
    const row: any = fileRowsById.get(item.fileId) ?? {};
    // A blank reason leaves the operator with nothing to act on, so explain why
    // the file produced no usable text instead of only naming it.
    const explainUnreadable = () => {
      if (row.error_message) return String(row.error_message);
      const fileName = String(row.file_name || row.file_path || row.title || "");
      if (fileName && !isReportReadableEvidenceFile(fileName)) {
        return "该文件类型不在报告可引用证据范围内，请上传 PDF、Word、Excel 或图片版本";
      }
      const indexedChunks = Number(row.chunk_count ?? 0);
      if (String(row.status ?? "") === "indexed" && indexedChunks > 0) {
        return `已建立 ${indexedChunks} 个索引片段，但正文被判定为乱码或空白，报告不能采信，请重新解析该文件`;
      }
      return `尚未完成正文索引（当前索引状态：${row.status || "未建立索引"}）`;
    };
    return {
      fileId: item.fileId,
      fileName: item.fileName,
      category: item.category,
      status: readable ? "read" as const : "unreadable" as const,
      sourceType: item.sourceType ?? null,
      sourceId: item.sourceId ?? null,
      errorMessage: item.errorMessage ?? (readable ? null : explainUnreadable()),
      chunkCount: item.indexedChunkCount,
      factCount: item.keyFacts.length,
    };
  });

  const fileCards = await buildReportEvidenceCards(supabase, project, "", 120);
  const corpus = chunks.map((chunk: any) => chunk.content).join("\n");
  const sourceNames = uniqueBy(
    files
      .map((file: any) => actualSourceFileName(file))
      .filter((name: string) => name && name !== "未命名资料"),
    (name) => name.toLowerCase(),
  );
  const systemRecordNames = uniqueBy(
    files
      .filter((file: any) => isSystemRecordEvidence(file))
      .map((file: any) => sourceDisplayName(file))
      .filter((name: string) => name && name !== "未命名资料"),
    (name) => name.toLowerCase(),
  );
  const chunksByFile = new Map<string, any[]>();
  for (const chunk of chunks) {
    const fileId = String(chunk.file_id ?? "");
    if (!fileId) continue;
    const current = chunksByFile.get(fileId) ?? [];
    current.push(chunk);
    chunksByFile.set(fileId, current);
  }
  const sourceDocuments = files
    .map((file: any) => {
      const sourceName = actualSourceFileName(file);
      if (!sourceName) return null;
      const fileChunks = (chunksByFile.get(String(file.id)) ?? [])
        .slice()
        .sort((left: any, right: any) =>
          Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0)
        );
      const text = [
        file.summary,
        ...fileChunks.map((chunk: any) => chunk.content),
      ].filter(Boolean).join("\n");
      return text.trim() ? { sourceName, text } : null;
    })
    .filter((item): item is { sourceName: string; text: string } => Boolean(item));
  const authoritativeTargetEvidenceText = buildAuthoritativeTargetEvidenceDigest(
    sourceDocuments,
    12000,
  );
  const sourceAliases = buildSourceAliasMap(files);
  const sourceAliasCandidates = buildSourceAliasCandidates(files);
  const sourceAliasEntries = buildSourceAliasEntries(files);
  const authoritativeFiles = files;
  const authoritativeFileIds = new Set(authoritativeFiles.map((file: any) => String(file.id)));
  const serviceProviders = rankServiceProviderMentions(extractServiceProviderMentions([
    ...authoritativeFiles.map((file: any) => ({
      sourceName: sourceDisplayName(file),
      text: [file.title, file.file_name, file.category, file.summary].filter(Boolean).join("；"),
    })),
    ...chunks
      .filter((chunk: any) => authoritativeFileIds.has(String(chunk.file_id)))
      .map((chunk: any) => ({
        sourceName: sourceDisplayName(chunk),
        text: [chunk.title, chunk.file_name, chunk.category, chunk.content].filter(Boolean).join("；"),
      })),
  ]));
  const sourceManifestText = sourceNames.length
    ? sourceNames.map((name, index) => `${index + 1}. ${formatSourceCitation(name)}`).join("\n")
    : "当前项目暂无可引用的真实资料文件名。";
  const sourceAliasText = Object.entries(sourceAliasCandidates).length
    ? Object.entries(sourceAliasCandidates)
      .map(([alias, fileNames], index) =>
        `${index + 1}. 资料项“${files.find((file: any) => normalizeSourceKey(file.title) === alias)?.title || alias}”对应：${fileNames.map(formatSourceCitation).join("、")}`
      )
      .join("\n")
    : "";
  const providerText = serviceProviders.length
    ? serviceProviders
      .map((item, index) =>
        `${index + 1}. 服务商：${item.name}；交叉来源：${item.evidenceCount ?? 1}份；来源：${formatSourceCitation(item.sourceName)}；原文：${item.excerpt}`
      )
      .join("\n")
    : "";
  const hardFactText = formatHardFactClaims(hardFactClaims);
  const conflictText = conflicts.length
    ? conflicts.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "";
  const directFactText = allFacts.length
    ? allFacts.map((item, index) => `${index + 1}. ${item.fact}（来源：${item.source}；类型：${item.category}）`).join("\n")
    : "根据现有资料暂未见可直接核验的金额、数量、标准号、日期或指标值。";
  const sharedEvidenceText = [
    "【项目资料依据】",
    "以下证据来自当前项目已上传并完成正文解析的资料。模板只提供章节结构，不能提供事实。",
    `当前项目：${project.name || "未命名项目"}；项目单位：${project.unit || "未填写"}。`,
    authoritativeTargetEvidenceText,
    "【可引用真实资料名称】",
    sourceManifestText,
    sourceAliasText ? `【资料项标题与真实文件名对应关系】\n${sourceAliasText}` : "",
    providerText ? `【采购与服务商事实】\n${providerText}` : "",
    targetRegisterText,
    "【逐文件全覆盖证据】",
    perFileText || "当前项目暂无可直接引用的 Word/Excel 正文资料。",
    "【硬事实卡片】",
    hardFactText,
    conflictText ? `【冲突口径】\n${conflictText}` : "",
  ].filter(Boolean).join("\n\n");
  const sectionContexts = {
    opening: [
      sharedEvidenceText,
      "【评估对象与评估方式相关事实】",
      factAreaSections.filter((_, index) => [0, 3, 4, 5, 6].includes(index)).join("\n\n"),
    ].filter(Boolean).join("\n\n"),
    evaluation: [
      sharedEvidenceText,
      "【可直接核验的事实/数据】",
      directFactText,
      `【按事实类型归集】\n${factAreaSections.join("\n\n")}`,
      dimensions.length ? `【按当前评估指标归集】\n${dimensionSections.join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    closing: [
      sharedEvidenceText,
      "【问题与建议相关事实】",
      factAreaSections.filter((_, index) => [1, 2, 4, 5, 6].includes(index)).join("\n\n"),
      "第四章建议只能针对以上证据中已经识别的问题和资料缺口，不得使用模板通用建议补齐。",
    ].filter(Boolean).join("\n\n"),
  };
  const text = [
    "【项目资料依据】",
    "本资料依据是生成报告的事实来源。写作时必须先按“逐文件证据 -> 事实清单 -> 指标证据 -> 冲突口径”顺序核对，不得只根据少数片段写结论。",
    `当前项目：${project.name || "未命名项目"}；项目单位：${project.unit || "未填写"}。`,
    authoritativeTargetEvidenceText,
    "【可引用真实资料名称】",
    sourceManifestText,
    sourceAliasEntries.length
      ? `【资料项标题与真实文件名对应关系】\n${sourceAliasEntries
        .map((entry, index) => `${index + 1}. 资料项“${entry.alias}”实际对应《${entry.fileName}》`)
        .join("\n")}`
      : "",
    serviceProviders.length
      ? `【采购与服务商硬事实】\n${serviceProviders
        .map((item, index) =>
          `${index + 1}. 服务商：${item.name}；交叉来源：${item.evidenceCount ?? 1}份；来源：《${item.sourceName}》；原文：${item.excerpt}`
        )
        .join("\n")}`
      : "",
    targetRegisterText,
    "【零、硬事实卡片与禁止否认清单】",
    formatHardFactClaims(hardFactClaims),
    conflicts.length ? `【零-A、冲突口径与强制修正】\n${conflicts.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
    "【一、逐文件证据清单】",
    perFileText || "当前项目暂无可直接引用的 Word/Excel 正文资料。",
    "【二、可直接核验的事实/数据】",
    allFacts.length
      ? allFacts.map((item, index) => `${index + 1}. ${item.fact}（来源：${item.source}；类型：${item.category}）`).join("\n")
      : "根据现有资料暂未见可直接核验的金额、数量、标准号、日期或指标值。",
    `【五、按事实类型归集】\n${factAreaSections.join("\n\n")}`,
    dimensions.length ? `【六、按当前评估指标归集】\n${dimensionSections.join("\n\n")}` : "",
    "【七、报告生成硬规则】\n1. 第三章每个事实依据必须写出来源线索，如“根据《真实上传文件名》可见”。\n2. 所有带数字、标准号、金额、时间、目标值的句子必须来自本资料依据；没有来源不得写。\n3. 如果【硬事实卡片】已有某类事实，不得写该类内容“无法确认、未提供、缺少”。只能写“已提供……，但仍需补充……”。\n4. 如果证据存在不同口径，必须并列说明口径差异和对应真实文件名，不得自行选择有利口径。\n5. 每份可解析 Word/Excel 资料都必须被检查；与正文判断相关的文件必须吸收进报告。\n6. 报告写完后必须逐项自检服务商、金额、数量、标准版本、实施周期、绩效目标、会议意见等事实是否与项目证据一致，不得使用任何项目专用固定值。",
  ].filter(Boolean).join("\n\n");

  return {
    project,
    text,
    corpus,
    sourceNames,
    systemRecordNames,
    sourceDocuments,
    sourceAliases,
    serviceProviders,
    targetFacts,
    fileReviews,
    dimensionReviews,
    sectionContexts,
    stats: {
      files: files.length,
      indexedFiles,
      unindexedFiles,
      chunks: chunks.length,
      factSignals: allFacts.length + hardFactClaims.length,
      dimensionEvidence: dimensionSections.length,
      conflicts: conflicts.length,
      coveredFiles: coverageItems.length,
      resolvedProjectId: project.id ?? null,
    },
    fileCards,
    conflicts,
    sourceAliasCandidates,
  };
};

const formatLedgerFiles = (files: any[]) => files
  .slice()
  .sort((a: any, b: any) => priorityMaterialRank(b) - priorityMaterialRank(a))
  .slice(0, 120)
  .map((file: any, index: number) => {
    const title = sourceDisplayName(file);
    const type = classifyEvidenceType([title, file.category, file.summary].filter(Boolean).join(" "));
    const signals = extractFactSignals([title, file.category, file.summary].filter(Boolean).join(" "));
    return `${index + 1}. 《${title}》[${file.category ?? type}｜${Number(file.chunk_count ?? 0)}片段｜${type}]`
      + `${signals.length ? `；关键事实：${signals.slice(0, 8).join("、")}` : ""}`
      + `${file.summary ? `；摘要：${preview(file.summary, 260)}` : ""}`;
  });

const formatPerFileEvidenceLedger = (files: any[], chunks: any[]) => {
  if (!files.length) return "";
  const chunksByFile = new Map<string, any[]>();
  for (const chunk of chunks) {
    const key = String(chunk.file_id ?? "");
    if (!key) continue;
    const current = chunksByFile.get(key) ?? [];
    current.push(chunk);
    chunksByFile.set(key, current);
  }

  return files
    .slice()
    .sort((a: any, b: any) => priorityMaterialRank(b) - priorityMaterialRank(a))
    .slice(0, 120)
    .map((file: any, index: number) => {
      const title = sourceDisplayName(file);
      const fileChunks = (chunksByFile.get(String(file.id)) ?? [])
        .slice()
        .sort((a: any, b: any) =>
          Number(b.priority ?? 0) - Number(a.priority ?? 0)
          || Number(a.chunk_index ?? 0) - Number(b.chunk_index ?? 0)
        );
      const primary = fileChunks[0];
      const signals = uniqueBy(
        [
          ...extractFactSignals([title, file.category, file.summary].filter(Boolean).join(" ")),
          ...(primary?.fact_signals ?? []),
        ],
        (item) => item.toLowerCase(),
      ).slice(0, 10);
      const location = primary && Number.isFinite(Number(primary.chunk_index))
        ? `片段${Number(primary.chunk_index) + 1}`
        : "资料摘要";
      const content = primary?.content || file.summary || title;
      return `${index + 1}. 《${title}》[${file.category ?? classifyEvidenceType([title, file.summary].filter(Boolean).join(" "))}｜${location}]`
        + `${signals.length ? `；可核验数据/事实：${signals.join("、")}` : ""}`
        + `：${preview(content, 520)}`;
    })
    .join("\n");
};

const formatEvidenceRow = (item: any, index: number, max = 620) => {
  const title = sourceDisplayName(item);
  const category = item.category ?? item.evidence_type ?? "项目资料";
  const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "资料摘要";
  const signals = item.fact_signals?.length ? `；事实信号：${item.fact_signals.slice(0, 10).join("、")}` : "";
  const terms = item.matchedTerms?.length ? `；命中词：${item.matchedTerms.join("、")}` : "";
  return `${index + 1}. 《${title}》[${category}｜${location}${terms}${signals}]：${preview(item.content, max)}`;
};

const collectEvidenceForQuery = async (supabase: any, projectId: string, queryText: string, limit = 4) => {
  const queryTokens = tokenize(queryText);
  const rows: any[] = [];

  try {
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: vectorLiteral(await createTextEmbeddingAsync(queryText)),
      match_count: Math.max(limit * 2, 8),
      match_project_id: projectId,
    });
    if (error) throw error;
    rows.push(...(data ?? []));
  } catch (error) {
    console.warn("report vector evidence search failed", error);
  }

  if (queryTokens.length) {
    try {
      const { data, error } = await supabase.rpc("keyword_knowledge_chunks", {
        query_terms: queryTokens.slice(0, 24),
        match_count: Math.max(limit * 3, 12),
        match_project_id: projectId,
      });
      if (error) throw error;
      rows.push(...(data ?? []));
    } catch (error) {
      console.warn("report keyword evidence search fallback", error);
    }
  }

  try {
    const { data: materials, error } = await supabase
      .from("materials")
      .select("id,name,category,status,file_name,review_note,updated_at")
      .eq("project_id", projectId)
      .not("file_path", "is", null)
      .limit(80);
    if (error) throw error;
    const materialRows = (materials ?? [])
      .map((material: any) => {
        const searchable = [material.name, material.category, material.file_name, material.review_note].filter(Boolean).join(" ");
        const score = overlapScore(queryTokens, searchable) + (material.status === "approved" ? 4 : material.status === "received" ? 2 : 0);
        if (score <= 0) return null;
        return {
          chunk_id: `material-${material.id}`,
          file_id: material.id,
          title: sourceDisplayName(material),
          file_name: material.file_name,
          category: material.category ?? "项目资料",
          chunk_index: null,
          content: `项目已上传文件：${material.file_name || material.name || "项目资料"}${material.name && material.file_name && material.name !== material.file_name ? `；资料项：${material.name}` : ""}${material.review_note ? `；审核说明：${material.review_note}` : ""}。`,
          keyword_score: score,
        };
      })
      .filter(Boolean);
    rows.push(...materialRows);
  } catch (error) {
    console.warn("report material evidence fallback failed", error);
  }

  return mergeEvidenceRows(
    rows.filter((row: any) => !isGeneratedReportEvidence(row)),
    queryTokens,
    limit,
  );
};

const priorityMaterialRank = (item: any) => {
  const text = [item.title, item.file_name, item.category, item.summary].filter(Boolean).join(" ");
  let score = 0;
  if (/申报书|申请|立项|背景|依据/.test(text)) score += 12;
  if (/绩效目标|目标表|指标|绩效/.test(text)) score += 11;
  if (/预算|测算|明细|收费|金额|合同|结算|报价|询价/.test(text)) score += 10;
  if (/实施方案|工作方案|流程|进度|人员|风险|应急/.test(text)) score += 9;
  if (/专家|会议|意见|打分|评分/.test(text)) score += 8;
  score += Math.min(8, Number(item.chunk_count ?? 0));
  return score;
};

const collectFactRowsForArea = async (supabase: any, projectId: string, area: { label: string; terms: string[] }, limit = 5) => {
  const queryTokens = tokenize(area.terms.join(" "));
  const rows: any[] = [];

  try {
    const { data, error } = await supabase.rpc("keyword_knowledge_chunks", {
      query_terms: area.terms,
      match_count: Math.max(limit * 2, 12),
      match_project_id: projectId,
    });
    if (error) throw error;
    rows.push(...(data ?? []));
  } catch (error) {
    console.warn(`fact area keyword search failed: ${area.label}`, error);
  }

  try {
    const { data: files, error } = await supabase
      .from("knowledge_files")
      .select("id,title,file_name,category,summary,chunk_count,status,source_type")
      .eq("project_id", projectId)
      .eq("status", "indexed")
      .limit(80);
    if (error) throw error;
    const fileRows = (files ?? [])
      .filter((file: any) => !isGeneratedReportEvidence(file))
      .map((file: any) => {
        const searchable = [file.title, file.file_name, file.category, file.summary].filter(Boolean).join(" ");
        const score = overlapScore(queryTokens, searchable);
        if (score <= 0) return null;
        return {
          chunk_id: `fact-file-${file.id}`,
          file_id: file.id,
          title: sourceDisplayName(file),
          file_name: file.file_name,
          category: file.category ?? "项目资料",
          chunk_index: null,
          content: `资料名称：${sourceDisplayName(file)}${file.summary ? `；摘要：${file.summary}` : ""}`,
          keyword_score: score,
        };
      })
      .filter(Boolean);
    rows.push(...fileRows);
  } catch (error) {
    console.warn(`fact area file search failed: ${area.label}`, error);
  }

  return mergeEvidenceRows(
    rows.filter((row: any) => !isGeneratedReportEvidence(row)),
    queryTokens,
    limit,
  );
};

export const buildReportFactPack = async (
  supabase: any,
  projectInput: ProjectInput,
  dimensions: string[] = [],
) => {
  const project = await resolveProject(supabase, projectInput);
  const stats = {
    ...emptyStats(),
    factAreas: 0,
    factEvidenceSnippets: 0,
    resolvedProjectId: project.id ?? null,
  };

  if (!project.id) {
    return {
      project,
      stats,
      corpus: "",
      text: "【项目事实核对包】\n当前项目未能解析，无法生成事实核对包。",
      rows: [],
    };
  }

  const areas = [
    ...FACT_AREAS,
    ...dimensions.map((dimension) => ({
      label: `评估指标证据：${dimension}`,
      terms: [dimension, ...evidenceQueryForDimension(dimension, project).split(/\s+/).slice(0, 18)],
    })),
  ];

  const rows = [];
  const corpusParts: string[] = [];
  for (const area of areas) {
    const evidence = await collectFactRowsForArea(supabase, project.id, area, 5);
    stats.factAreas += 1;
    stats.factEvidenceSnippets += evidence.length;
    evidence.forEach((row: any) => corpusParts.push(row.content));
    const evidenceText = evidence.length
      ? evidence.map((item: any, index: number) => {
        const title = sourceDisplayName(item);
        const category = item.category ?? "项目资料";
        const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "资料摘要";
        const terms = item.matchedTerms?.length ? `；命中词：${item.matchedTerms.join("、")}` : "";
        return `${index + 1}. 《${title}》[${category}｜${location}${terms}]：${preview(item.content, 460)}`;
      }).join("\n")
      : "未检索到可直接引用的当前项目证据。";
    rows.push({
      area: area.label,
      evidence,
      text: `【${area.label}】\n${evidenceText}`,
    });
  }

  return {
    project,
    stats,
    corpus: corpusParts.join("\n"),
    text: [
      "【项目事实核对包】",
      "以下内容用于在正式写作前先锁定项目事实。报告中的金额、数量、单价、标准号、采购方式、绩效目标值、实施周期、服务商、会议意见等关键判断，必须能在本核对包或当前项目证据矩阵中找到依据；找不到依据时只能写“根据现有资料暂未见明确依据”，不得编造。",
      rows.map((row) => row.text).join("\n\n"),
    ].join("\n\n"),
    rows,
  };
};

export const buildGroundedReportRagPack = async (
  supabase: any,
  projectInput: ProjectInput,
  dimensions: string[] = [],
  extra = "",
) => {
  const project = await resolveProject(supabase, projectInput);
  const stats = {
    groundedFiles: 0,
    groundedChunks: 0,
    groundedFacts: 0,
    groundedDimensionEvidence: 0,
    resolvedProjectId: project.id ?? null,
  };

  if (!project.id) {
    return {
      project,
      stats,
      corpus: "",
      text: "【Grounded RAG 证据账本】\n当前项目未能解析，无法生成证据账本。",
      dimensionRows: [],
      ledgerRows: [],
    };
  }

  let ledger;
  try {
    ledger = await collectProjectEvidenceLedger(supabase, project.id);
  } catch (error) {
    console.warn("collect project evidence ledger failed", error);
    return {
      project,
      stats,
      corpus: "",
      text: "【Grounded RAG 证据账本】\n当前项目资料索引读取失败，无法生成证据账本。",
      dimensionRows: [],
      ledgerRows: [],
    };
  }

  stats.groundedFiles = ledger.files.length;
  stats.groundedChunks = ledger.chunks.length;

  const fileOverview = formatLedgerFiles(ledger.files);
  const perFileEvidence = formatPerFileEvidenceLedger(ledger.files, ledger.chunks);
  const queryTokens = tokenize([
    project.name,
    project.unit,
    project.category,
    project.description,
    extra,
    dimensions.join(" "),
    "预算 金额 标箱 绩效目标 指标值 实施方案 政策 标准 合同 会议 专家",
  ].filter(Boolean).join(" "));

  const scoredLedgerRows = ledger.chunks.map((chunk: any) => {
    const searchable = [chunk.title, chunk.file_name, chunk.category, chunk.summary, chunk.content].filter(Boolean).join(" ");
    const factBonus = (chunk.fact_signals?.length ?? 0) * 4;
    const score = overlapScore(queryTokens, searchable) + factBonus + Number(chunk.priority ?? 0) * 0.35;
    return {
      ...chunk,
      score,
      matchedTerms: matchedTermsFor(queryTokens, searchable),
    };
  });

  const topLedgerRows = diversifyEvidenceRows(scoredLedgerRows, 36);
  const factSignals = uniqueBy(
    topLedgerRows.flatMap((row: any) => (row.fact_signals ?? []).map((fact: string) => ({
      fact,
      title: sourceDisplayName(row),
      category: row.category ?? row.evidence_type ?? "项目资料",
    }))),
    (item) => `${item.fact}:${item.title}`,
  ).slice(0, 80);
  stats.groundedFacts = factSignals.length;

  const typeGroups = new Map<string, any[]>();
  for (const row of topLedgerRows) {
    const type = factAreaForText([row.title, row.category, row.content].filter(Boolean).join(" "));
    const current = typeGroups.get(type) ?? [];
    current.push(row);
    typeGroups.set(type, current);
  }

  const dimensionRows = [];
  for (const [dimensionIndex, dimension] of dimensions.entries()) {
    const dimensionQuery = evidenceQueryForDimension(dimension, project, extra);
    const dimensionTokens = tokenize(dimensionQuery);
    const ledgerMatches = ledger.chunks.map((chunk: any) => {
      const searchable = [chunk.title, chunk.file_name, chunk.category, chunk.summary, chunk.content].filter(Boolean).join(" ");
      const score = overlapScore(dimensionTokens, searchable)
        + (chunk.fact_signals?.length ?? 0) * 2
        + (/预算|经济|成本|投入/.test(dimension) && chunk.evidence_type === "预算成本" ? 12 : 0)
        + (/目标|质量|数量|效益|满意|持续/.test(dimension) && chunk.evidence_type === "绩效目标" ? 12 : 0)
        + (/可行|实施|效率|方案|进度/.test(dimension) && chunk.evidence_type === "实施方案" ? 10 : 0)
        + (/必要|政策|依据/.test(dimension) && chunk.evidence_type === "政策标准" ? 10 : 0);
      return {
        ...chunk,
        score,
        matchedTerms: matchedTermsFor(dimensionTokens, searchable),
      };
    }).filter((row: any) => Number(row.score ?? 0) > 0);

    let hybridMatches: any[] = [];
    try {
      hybridMatches = await collectEvidenceForQuery(supabase, project.id, dimensionQuery, 12);
    } catch (error) {
      console.warn(`grounded dimension hybrid retrieval failed: ${dimension}`, error);
    }

    const evidence = diversifyEvidenceRows(
      uniqueBy([...ledgerMatches, ...hybridMatches], (row: any) =>
        String(row.chunk_id ?? row.id ?? `${row.file_id}:${row.chunk_index}:${row.content?.slice(0, 20)}`)
      ),
      10,
    );
    stats.groundedDimensionEvidence += evidence.length;
    dimensionRows.push({
      dimension,
      evidence,
      text: `【${SECTION_LABELS[dimensionIndex] ?? String(dimensionIndex + 1)}、${dimension}】\n`
        + (evidence.length
          ? evidence.map((item, index) => formatEvidenceRow(item, index, 720)).join("\n")
          : "未在当前项目证据账本中检索到可直接支撑该指标的资料。"),
    });
  }

  const typeGroupText = Array.from(typeGroups.entries())
    .map(([type, rows]) =>
      `【${type}】\n${rows.slice(0, 6).map((row, index) => formatEvidenceRow(row, index, 560)).join("\n")}`
    )
    .join("\n\n");

  const factText = factSignals.length
    ? factSignals.map((item, index) => `${index + 1}. ${item.fact}（来源：《${item.title}》/${item.category}）`).join("\n")
    : "当前索引中未抽取到金额、数量、标准号、日期等可直接核验的硬事实。";

  const ledgerText = [
    "【Grounded RAG 证据账本】",
    "这是报告生成的主依据，采用“文件全景 + 硬事实抽取 + 混合检索 + 多文件去重”的方式生成。报告尤其是第三章必须优先使用本账本；账本没有的内容不得写成会议意见、专家意见或项目事实。",
    `当前项目：${project.name || "未命名项目"}；索引文件 ${stats.groundedFiles} 个，索引片段 ${stats.groundedChunks} 个。`,
    fileOverview.length ? `【一、资料全景】\n${fileOverview.join("\n")}` : "【一、资料全景】\n当前项目暂无已索引资料。",
    perFileEvidence ? `【二、逐文件代表性原文依据】\n以下清单覆盖当前项目全部已索引文件。写作时必须逐份校验，不能只引用少数文件；如果某份资料与第三章结论无直接关系，也应在依据链中标为“已检查但未形成正文结论”。\n${perFileEvidence}` : "",
    `【三、硬事实清单】\n${factText}`,
    typeGroupText ? `【四、按事实类型归集的关键证据】\n${typeGroupText}` : "",
    dimensionRows.length ? `【五、按当前评估指标归集的证据】\n${dimensionRows.map((row) => row.text).join("\n\n")}` : "",
    "【六、写作硬约束】\n1. 金额、数量、单价、标准号、服务商、绩效目标值、会议意见必须来自上方证据；没有证据时只能写“根据现有资料暂未见明确依据”。\n2. 已在硬事实清单出现的事实，不得再写“未提供、无法确认、资料不足”。\n3. 旧的系统生成报告、报告历史稿和历史同类报告已从证据链排除，不得引用或沿用其中事实。\n4. 第三章每个指标至少吸收两个不同文件或不同事实类型的证据；不足时必须说明仍需补充交叉验证资料。\n5. 第三章完成前必须检查【逐文件代表性原文依据】里的每份文件，优先吸收所有与项目事实、预算、绩效目标、实施方案、政策依据、专家意见相关的文件。",
  ].filter(Boolean).join("\n\n");

  return {
    project,
    stats,
    corpus: topLedgerRows.map((row) => row.content).join("\n"),
    text: ledgerText,
    dimensionRows,
    ledgerRows: topLedgerRows,
  };
};

const buildProjectMaterialPanorama = async (supabase: any, projectId: string) => {
  const { data: files, error } = await supabase
    .from("knowledge_files")
    .select("id,title,file_name,category,summary,chunk_count,indexed_at,updated_at,source_type")
    .eq("project_id", projectId)
    .eq("status", "indexed")
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error || !files?.length) {
    if (error) console.warn("project material panorama failed", error);
    return { text: "", fileCount: 0, chunkCount: 0 };
  }

  const sortedFiles = [...files]
    .filter((file: any) => !isGeneratedReportEvidence(file))
    .sort((a: any, b: any) => priorityMaterialRank(b) - priorityMaterialRank(a));
  const overview = sortedFiles.map((file: any, index: number) => {
    const title = sourceDisplayName(file);
    const category = file.category ?? "项目资料";
    const chunks = Number(file.chunk_count ?? 0);
    const summary = preview(file.summary || "", 360);
    return `${index + 1}. 《${title}》[${category}｜${chunks}个片段]${summary ? `：${summary}` : ""}`;
  });

  const priorityIds = sortedFiles.slice(0, 10).map((file: any) => file.id);
  let chunkLines: string[] = [];
  if (priorityIds.length) {
    const { data: chunks, error: chunkError } = await supabase
      .from("knowledge_chunks")
      .select("file_id,chunk_index,content")
      .in("file_id", priorityIds)
      .order("chunk_index", { ascending: true });
    if (chunkError) {
      console.warn("priority material chunks failed", chunkError);
    } else {
      const fileMap = new Map(sortedFiles.map((file: any) => [file.id, file]));
      const perFile = new Map<string, number>();
      chunkLines = (chunks ?? [])
        .filter((chunk: any) => {
          const used = perFile.get(chunk.file_id) ?? 0;
          if (used >= 3) return false;
          perFile.set(chunk.file_id, used + 1);
          return true;
        })
        .slice(0, 24)
        .map((chunk: any, index: number) => {
          const file = fileMap.get(chunk.file_id) ?? {};
          const title = sourceDisplayName(file);
          return `${index + 1}. 《${title}》片段${Number(chunk.chunk_index ?? 0) + 1}：${preview(chunk.content, 620)}`;
        });
    }
  }

  return {
    fileCount: files.length,
    chunkCount: chunkLines.length,
    text: [
      "【项目资料全景清单】",
      "以下为当前项目已完成索引的资料总览，写报告和方案时必须先整体理解这些资料，再按指标引用证据；不得只根据单个片段下结论。",
      overview.join("\n"),
      chunkLines.length
        ? "【重点资料优先阅读片段】\n" + chunkLines.join("\n")
        : "",
    ].filter(Boolean).join("\n"),
  };
};

const buildReportEvidenceContext = async (
  supabase: any,
  project: ReturnType<typeof normalizeProject>,
  dimensions: string[],
  extra = "",
) => {
  if (!project.id || !dimensions.length) return { text: "", count: 0 };

  const sections: string[] = [];
  let count = 0;

  for (const [index, dimension] of dimensions.entries()) {
    const queryText = evidenceQueryForDimension(dimension, project, extra);
    const evidenceRows = await collectEvidenceForQuery(supabase, project.id, queryText, 10);
    if (!evidenceRows.length) {
      sections.push(`${index + 1}. ${dimension}：根据现有资料暂未见可直接引用的正文依据。写作时只能披露“根据现有资料暂未见明确依据”，不得扩大为“项目未提供”。`);
      continue;
    }

    count += evidenceRows.length;
    sections.push(
      `${index + 1}. ${dimension}：\n`
      + evidenceRows.map((item: any, evidenceIndex: number) => {
        const title = sourceDisplayName(item);
        const category = item.category ?? "项目资料";
        const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "正文片段";
        const terms = item.matchedTerms?.length ? `；命中：${item.matchedTerms.join("、")}` : "";
        return `  ${evidenceIndex + 1}. 《${title}》[${category}｜${location}${terms}]：${preview(item.content, 680)}`;
      }).join("\n"),
    );
  }

  return {
    count,
    text: sections.length
      ? "【第三章逐项证据核验】\n"
        + "以下内容为写作第三章前必须优先核对的项目资料证据。只允许把这里列出的当前项目一手资料和系统形成的会议、调研记录作为事实依据；旧的系统生成报告、报告历史稿和历史同类报告不得作为写法或事实参考。若证据已覆盖预算明细、历史合同、结算清单、实施方案、供应商资质、监测频率、抽检标准等，不得再写“未提供”“缺少”“无法确认”；只能写“已提供……，但仍需补充……”。\n"
        + sections.join("\n")
      : "",
  };
};

export const buildReportEvidenceMatrix = async (
  supabase: any,
  projectInput: ProjectInput,
  extra = "",
  dimensions: string[] = [],
) => {
  const project = await resolveProject(supabase, projectInput);
  const effectiveDimensions = dimensions.length ? dimensions : [];
  const stats = { ...emptyStats(), resolvedProjectId: project.id ?? null };

  if (!project.id || !effectiveDimensions.length) {
    return {
      project,
      stats,
      corpus: "",
      text: "【当前项目证据矩阵】\n当前项目未关联可用评估指标或未能解析项目，不能形成逐项证据矩阵。",
      rows: [],
    };
  }

  const panorama = await buildProjectMaterialPanorama(supabase, project.id);
  stats.materialOverviewFiles = panorama.fileCount;
  stats.priorityMaterialChunks = panorama.chunkCount;

  const rows = [];
  const corpusParts = [panorama.text, extra].filter(Boolean);

  for (const dimension of effectiveDimensions) {
    const queryText = evidenceQueryForDimension(dimension, project, extra);
    const evidenceRows = await collectEvidenceForQuery(supabase, project.id, queryText, 14);
    const directRows = evidenceRows.filter((row: any) => {
      const content = String(row?.content ?? "");
      const sourceType = String(row?.source_type ?? row?.metadata?.sourceType ?? "");
      const title = String(row?.title ?? row?.file_name ?? "");
      const category = String(row?.category ?? "");
      const isCurrentMaterial = !/历史同类报告|目标库|可复用绩效目标|历史项目/.test(`${title} ${category}`);
      return content.trim().length >= 12 && isCurrentMaterial && sourceType !== "history";
    });
    stats.reportEvidenceSnippets += directRows.length;
    directRows.forEach((row: any) => corpusParts.push(row.content));

    const supportLines = directRows.length
      ? directRows.slice(0, 8).map((item: any, index: number) => {
        const title = sourceDisplayName(item);
        const category = item.category ?? "项目资料";
        const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "正文片段";
        const terms = item.matchedTerms?.length ? `；命中词：${item.matchedTerms.join("、")}` : "";
        return `${index + 1}. 《${title}》[${category}｜${location}${terms}]：${preview(item.content, 760)}`;
      }).join("\n")
      : "未命中当前项目资料的直接正文依据。";

    rows.push({
      dimension,
      evidenceCount: directRows.length,
      evidence: directRows,
      text: `【${dimension}】\n已检索到的当前项目证据：${directRows.length} 条\n${supportLines}\n写作约束：有证据的内容必须写“资料显示/已提供/根据……可见”；无直接证据时只能写“根据现有资料暂未见明确依据”，不得写成“项目单位未提供”。`,
    });
  }

  const text = [
    "【当前项目证据矩阵】",
    "以下矩阵是报告第三章的唯一当前项目事实依据。第三章必须逐项吸收这些证据，不得使用默认五项指标替代当前指标，不得把会议或资料没有出现的内容写成事实。",
    panorama.text,
    rows.map((row) => row.text).join("\n\n"),
  ].filter(Boolean).join("\n\n");

  return {
    project,
    stats,
    corpus: corpusParts.join("\n"),
    text,
    rows,
  };
};

export const buildProjectKnowledgeContext = async (supabase: any, projectInput: ProjectInput, extra = "") => {
  const project = await resolveProject(supabase, projectInput);
  const queryText = [project.name, project.unit, project.category, project.description, extra].filter(Boolean).join(" ");
  const queryTokens = tokenize(queryText);

  const sections: string[] = [];
  const stats = {
    ...emptyStats(),
    resolvedProjectId: project.id ?? null,
  };

  if (project.id) {
    const panorama = await buildProjectMaterialPanorama(supabase, project.id);
    if (panorama.text) {
      stats.materialOverviewFiles = panorama.fileCount;
      stats.priorityMaterialChunks = panorama.chunkCount;
      sections.push(panorama.text);
    }

    try {
      const { data: knowledgeMatches } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: vectorLiteral(await createTextEmbeddingAsync(queryText)),
        match_count: 10,
        match_project_id: project.id,
      });
      const knowledgeRows = (knowledgeMatches ?? [])
        .filter((item: any) => item?.content)
        .filter((item: any) => !isGeneratedReportEvidence(item))
        .slice(0, 10);
      if (knowledgeRows.length) {
        stats.knowledgeSnippets = knowledgeRows.length;
        sections.push(
          "【项目资料检索依据】\n"
          + knowledgeRows.map((item: any, index: number) =>
            `${index + 1}. 《${sourceDisplayName(item)}》[${item.category ?? "项目资料"}]：${preview(item.content, 520)}`
          ).join("\n"),
        );
      }
    } catch (error) {
      console.warn("knowledge vector search failed", error);
    }

    const { data: materials } = await supabase
      .from("materials")
      .select("id,name,category,status,file_path,file_name,review_note")
      .eq("project_id", project.id)
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false });

    const materialCandidates = (materials ?? [])
      .filter((material: any) => !isGeneratedReportEvidence(material))
      .map((material: any) => {
        const searchable = [material.name, material.category, material.review_note, material.file_name].filter(Boolean).join(" ");
        return {
          name: material.name,
          category: material.category,
          status: material.status,
          snippet: preview(material.review_note || material.file_name || material.name, 180),
          score: overlapScore(queryTokens, searchable) + (material.status === "approved" ? 4 : material.status === "received" ? 2 : 0),
        };
      });

    const topMaterials = materialCandidates
      .filter((item) => item.snippet)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (topMaterials.length) {
      stats.materialSnippets = topMaterials.length;
      sections.push(
        "【当前项目资料摘录】\n"
        + topMaterials.map((item, index) =>
          `${index + 1}. 《${item.name}》[${item.category ?? "未分类"}|${item.status}]：${item.snippet}`
        ).join("\n"),
      );
    }
  }

  let goalQuery = supabase
    .from("goal_library")
    .select("category,code,name,weight,scoring_method,required_materials,usage_count")
    .order("usage_count", { ascending: false })
    .limit(20);

  if (project.category) goalQuery = goalQuery.eq("category", project.category);
  const { data: goalLibrary } = await goalQuery;
  const goals = (goalLibrary ?? [])
    .map((goal: any) => ({
      ...goal,
      score: overlapScore(queryTokens, [goal.name, goal.scoring_method, goal.required_materials, goal.code].filter(Boolean).join(" "))
        + Number(goal.usage_count || 0),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 6);

  if (goals.length) {
    stats.goalTargets = goals.length;
    sections.push(
      "【可复用绩效目标参考】\n"
      + goals.map((goal: any, index: number) =>
        `${index + 1}. ${goal.code ? `${goal.code} ` : ""}${goal.name}（权重${Number(goal.weight || 0)}，引用${goal.usage_count || 0}次）`
        + `${goal.required_materials ? `；建议资料：${preview(goal.required_materials, 120)}` : ""}`
      ).join("\n"),
    );
  }

  return {
    text: sections.join("\n\n"),
    stats,
    project,
  };
};

export const buildReportKnowledgeContext = async (
  supabase: any,
  projectInput: ProjectInput,
  extra = "",
  dimensions: string[] = [],
) => {
  const base = await buildProjectKnowledgeContext(supabase, projectInput, extra);
  const reportEvidence = await buildReportEvidenceContext(supabase, base.project, dimensions, extra);

  return {
    ...base,
    text: [base.text, reportEvidence.text].filter(Boolean).join("\n\n"),
    stats: {
      ...base.stats,
      reportEvidenceSnippets: reportEvidence.count,
    },
  };
};

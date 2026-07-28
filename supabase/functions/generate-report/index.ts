// Edge function: stream AI-generated pre-performance evaluation report
// Auto-injects expert score averages and deduction reasons from DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildReportRagDossier } from "../_shared/rag.ts";
import {
  ensureServiceProviderDisclosure,
  formatSourceCitation,
  reconcileAuthoritativeScoreNarrative,
  rewriteProjectMaterialCitations,
  type AuthoritativeIndicatorScore,
  type AuthoritativeScoreSnapshot,
  type ServiceProviderMention,
  type SourceAliasCandidates,
  type SourceAliasMap,
} from "../_shared/reportEvidence.ts";
import {
  CN_SECTION_LABELS,
  REPORT_ATTACHMENT_LINES,
  REPORT_EVALUATION_TARGET_LINES,
  REPORT_METHOD_LINES,
  REPORT_NOTES_LINES,
  buildEvaluationContentToc,
  buildStrictReportInstruction,
  stripDeprecatedReportMethodSections,
} from "../_shared/reportTemplate.ts";
import { summarizeMeetingEvidence } from "../_shared/meetingEvidence.ts";
import {
  reconcileAuthoritativeTargetNarrative,
} from "../_shared/reportTargets.ts";
import {
  applyReportQualityCorrections,
  cleanReportLanguage,
  containsCorruptedReportText,
  containsGeneratedReportCitation,
  corruptedReportLines,
  ensureAllSourcesAcknowledged,
} from "../_shared/reportQuality.ts";
import {
  verifyFinalReport,
  verifyReportPreflight,
} from "../_shared/reportVerification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers":
    "X-Report-Generator-Version, X-Report-Service-Providers, X-Rag-Grounded-Files, X-Rag-Indexed-Files, X-Report-Verification",
};

const REPORT_GENERATOR_VERSION = "report-review-v13-comprehensive-verification";

interface ReqBody {
  project: {
    id?: string;
    name: string;
    unit: string;
    budget: number;
    category: string | null;
    description: string | null;
  };
  extra?: string;
}

interface ReportSectionContexts {
  opening: string;
  evaluation: string;
  closing: string;
}

interface ScoreSummaryResult {
  text: string;
  snapshot: AuthoritativeScoreSnapshot | null;
}

const buildSystemPrompt = (dimensions: string[]) => `你是一名资深的北京市通州区财政支出项目事前绩效评估专家。
请参照“北京市通州区财政支出项目事前绩效评估报告”正式成果格式撰写报告。

必须严格按照以下目录、名称、编号和顺序输出，不得改名、合并、删减、增加或调换章节：

${buildStrictReportInstruction(dimensions, { includeMethodLead: true })}

严格写作规则：
1. 只使用“一、”“（一）”“1.”“（1）”四级中文编号，不使用 Markdown、项目符号或英文标题。
2. 模板只决定章节结构，不提供事实依据。所有项目事实、金额、日期、标准号、文件名、会议意见、专家观点、绩效指标值、服务内容和问题判断，必须以【项目资料依据】【会议纪要与专家意见依据】【专家评分摘要】中的内容为准；这些依据中没有出现的内容不得写成事实。
3. 第一章必须完整保留全部九类具体绩效指标。没有资料依据时写“根据现有资料无法确认”，并说明需补充的资料，不能删去该项。
4. 第二章不得虚构受托单位、评估机构、调研日期和专家姓名。现场调研、市场调研属于流程事实，必须有调研记录、照片、纪要或资料原文明确支撑后才能写成“已开展”；没有明确证据时，只能写“根据现有资料暂未见明确记录，需补充……”。第二章“3.召开专家预评估会”为固定模板项：只要系统已读取到会议纪要、纪要原文、录音转写或会议分析，就必须写入该项，不得写“未见会议纪要/会议记录”。
5. 第三章必须且只能按当前项目已关联的评估指标体系展开，不得使用默认的“项目必要性、项目可行性、项目经济性、项目效率性、项目效益性”替代。当前应使用的指标为：${dimensions.join("、")}。每一指标均按“事实依据、发现的问题、分析判断、综上结论”展开。每一指标末尾必须有以“综上”开头的判断。
6. 如提供专家评分摘要，第三章总体结论项必须列示专家总平均分，并按当前评估指标体系逐项列示满分与平均得分；不得把评分另设为独立章节。
7. 第四章建议必须逐项对应第三章的问题，具体说明应补充的文件、应完善的制度、应调整的预算或指标。
8. 第五章两段固定说明必须原样保留。
9. 第六章四项附件名称必须原样保留。
10. 不得虚构政策文件、预算明细、指标值或评估事实。事实不足不等于替项目作正面判断，应客观披露证据缺口。
11. 第三章写作前必须优先核对“项目资料依据”。如果资料依据中已经出现预算明细、预算测算、历史合同、结算清单、收费标准、绩效目标、抽检/检查机制、实施方案、作业流程、应急预案、供应商资质或遴选方式，不得再写“未提供”“缺少”“无法确认”同类相反结论。
12. 对任何“缺少、未提供、无法确认、不明确”的判断，必须先说明已核验到哪些资料、这些资料为什么仍不能证明该点；不得简单否定资料存在。
13. 必须先整体阅读“逐文件证据清单”“可直接核验的事实/数据”“冲突口径与强制修正”“按当前评估指标归集”，再写第三章。第三章每个指标的“事实依据”至少引用 2 类资料线索；如果资料依据没有命中，才能写“根据现有资料暂未见明确依据”，不能扩大为“项目单位未提供”。
14. 对资料已经证明的内容，应写“已提供/资料显示/根据……可见”；对仍缺少的内容，应写“但仍需补充……”，不得把已有资料完全忽略。
15. 引用资料时只能使用【可引用真实资料名称】中列出的完整文件名。不得把 OCR 表格内容、正文片段、资料项标题或乱码当作文件名，不得原样粘贴无法阅读的识别文本。
15. 第三章所有涉及金额、数量、标准号、指标值、服务内容、会议意见、专家意见的句子，都必须在同句或相邻句写明“根据《资料名称》/资料显示/会议纪要载明”等来源线索；不能只写无来源结论。
16. 如果“冲突口径与强制修正”中指出旧版标准、采购方式或数量口径风险，报告必须按修正口径写，禁止继续输出被标记为风险的表述。
17. 第一章九类绩效指标也必须核对“硬事实卡片与禁止否认清单”。如果硬事实卡片已有对应事实，不得在第一章写“无法确认”。
18. 报告正文不得出现“RAG、文件库、索引、切片、OCR、模型、证据档案”等系统实现词汇；只能写“项目资料”“资料显示”“根据《文件名》可见”“需补充核验”等正式业务表述。
19. 第二章“3.召开专家预评估会”必须优先吸收已形成的会议纪要、纪要原文、录音转写或会议分析内容；只概括 3-5 条实质性会议结论，不得逐句复制会议原文、时间戳、发言人标签或整段录音转写。如会议原文未提供参会名单或签到表，不得虚构，但应写明“已形成会议文字记录，仍需补充参会人员、签到表和专家组集体意见等归档材料”。禁止在该项写“虽已形成部分专家沟通记录，但暂未见明确会议纪要/决议文件”这类否认会议纪要的表述。
20. 引用资料来源时，必须优先使用上传文件名，不得用资料清单标题冒充文件名；例如资料项标题与实际上传文件名不一致时，应写实际文件名。
21. 禁止引用当前项目资料中不存在的项目材料名称；进度指标、绩效目标、实施依据应分别回到实际上传的资料来源。
22. 【绩效目标原值锁定表】中的指标名称、比较符号、数值和单位是不可拆分的权威口径。不得把“至少达到某值”的目标阈值改写为满分值，不得合并名称相近但含义不同的指标，不得在整改建议中提出弱于权威口径的示例目标。
23. 旧的系统生成报告及其历史版本属于输出结果，不是项目证据。禁止引用“系统生成报告”“报告历史稿”“Performance Evaluation Report”或任何第几版生成报告，也不得沿用其中的事实和结论。
24. 使用第三人称、客观中立、正式严谨的财政绩效评估语言，总字数原则上为 3500-6000 字。`;

const encoder = new TextEncoder();

const sseData = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const sseReplace = (content: string) =>
  `data: ${JSON.stringify({ type: "replace", content })}\n\n`;

const sseError = (message: string) =>
  `data: ${JSON.stringify({ type: "error", message })}\n\n`;

const sseVerification = (verification: unknown) =>
  `data: ${JSON.stringify({ type: "verification", verification })}\n\n`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readAIText = async (response: Response) => {
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content
    ?? json.output_text
    ?? json.text
    ?? "";
  return String(content ?? "").trim();
};

const callReportSection = async (
  system: string,
  user: string,
  maxTokens: number,
  retries = 2,
) => {
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await callAI("report", {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        max_tokens: maxTokens,
        temperature: 0.15,
      }, { timeoutMs: 85000 });
      if (!response.ok) {
        lastError = `${response.status} ${await response.text()}`;
      } else {
        const text = await readAIText(response);
        if (text) return text;
        lastError = "AI 返回空内容";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) await sleep(700 * (attempt + 1));
  }
  throw new Error(lastError || "AI 分章生成失败");
};

const readAIStream = async (response: Response, onDelta: (content: string) => void) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || contentType.includes("application/json")) {
    const text = await readAIText(response);
    if (text) onDelta(text);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return payload === "[DONE]";
    try {
      const json = JSON.parse(payload);
      const content = json.choices?.[0]?.delta?.content
        ?? json.choices?.[0]?.message?.content
        ?? json.output_text
        ?? json.text
        ?? "";
      if (content) {
        const value = String(content);
        output += value;
        onDelta(value);
      }
    } catch {
      // 忽略非 JSON 心跳行，避免供应商扩展字段打断输出。
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (consumeLine(line)) return output.trim();
    }
  }
  if (buffer) consumeLine(buffer);
  return output.trim();
};

const callReportSectionStream = async (
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (content: string) => void,
) => {
  const response = await callAI("report", {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
    max_tokens: maxTokens,
    temperature: 0.15,
  }, { timeoutMs: 110000 });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const text = await readAIStream(response, onDelta);
  if (!text.trim()) throw new Error("AI 返回空内容");
  return text;
};

const sanitizeSection = (text: string) =>
  text
    .replace(/^\s*(好的|以下是|下面是|我将|已根据)[\s\S]{0,80}?(?=一、|二、|三、|四、|五、|六、)/, "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ""))
    .trim();

const sliceFromHeading = (text: string, heading: string) => {
  const source = String(text ?? "").trim();
  const direct = source.indexOf(heading);
  if (direct >= 0) return source.slice(direct).trim();
  const loose = new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
  const match = loose.exec(source);
  return match ? source.slice(match.index).trim() : source;
};

const stripDuplicateOpeningBeforeThirdChapter = (text: string) => {
  const source = String(text ?? "").trim();
  const third = source.indexOf("三、评估内容与结论");
  if (third < 0) return source;
  const firstOpening = source.indexOf("一、评估对象");
  if (firstOpening < 0 || firstOpening >= third) return source;
  const secondOpening = source.indexOf("一、评估对象", firstOpening + "一、评估对象".length);
  if (secondOpening < 0 || secondOpening >= third) return source;
  return `${source.slice(0, secondOpening).trim()}\n\n${source.slice(third).trim()}`.trim();
};

const dedupeAdjacentParagraphs = (text: string) => {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const normalized = paragraph
      .replace(/[，。；：、,.．:;（）()\s]/g, "")
      .slice(0, 260);
    const previous = output.at(-1)?.replace(/[，。；：、,.．:;（）()\s]/g, "").slice(0, 260) ?? "";
    if (normalized.length >= 40 && normalized === previous) continue;
    output.push(paragraph);
  }
  return output.join("\n\n");
};

const stripGenericSuggestionTail = (text: string) => {
  const source = String(text ?? "").trim();
  if (!source) return source;
  const four = headingIndex(source, "四、相关建议");
  const five = headingIndex(source, "五、其他需要说明的问题");
  if (four < 0 || five < 0 || five <= four) return source;

  const before = source.slice(0, four);
  const suggestions = source.slice(four, five);
  const after = source.slice(five);
  const genericStart = suggestions.search(/\n\s*1[.．、]\s*针对(?:立项必要性|项目必要性|投入经济性|项目经济性|绩效目标合理性|实施方案可行性|项目可行性|筹资合规性|可持续性|项目效益性)/);
  if (genericStart < 0) return source;
  const formalPart = suggestions.slice(0, genericStart).trim();
  const formalCount = (formalPart.match(/^\s*（[一二三四五六七八九十]+）/gm) ?? []).length;
  if (formalCount < 2) return source;
  return `${before}${formalPart}\n\n${after}`.trim();
};

const stripReportProcessTerms = (text: string) =>
  String(text ?? "")
    .replace(/现有生成内容未完整覆盖该部分[，,、]?\s*请结合\s*RAG\s*V2\s*项目证据档案补充完善。?/g, "")
    .replace(/现有生成内容未完整覆盖该部分。?/g, "")
    .replace(/请结合\s*(?:RAG\s*V2\s*)?项目证据档案补充完善。?/g, "")
    .replace(/RAG\s*V2\s*项目证据档案|Grounded\s*RAG\s*证据账本|当前项目证据矩阵/g, "项目资料依据")
    .replace(/证据档案/g, "资料依据")
    .replace(/资料库\/文件库|文件库|资料库/g, "项目资料")
    .replace(/(?:现有|当前)?(?:正文|资料)?索引(?:未检出|未读取)?(?:，?需人工核对或重新索引)?/g, "根据现有资料暂未见明确依据")
    .replace(/未建索引|索引文件|索引片段|切片|OCR|RAG/g, "资料")
    .replace(/需人工核对或重新索引|重新索引/g, "需补充资料来源并复核")
    .replace(/共查阅项目资料中的资料\s*(\d+)\s*份[，,]\s*资料\s*\d+\s*份[，,]\s*资料\s*\d+\s*份。?/g, "共查阅项目单位提供的相关资料$1份，重点核验项目申报、预算测算、绩效目标、实施方案及专家意见等材料。")
    .replace(/共查阅项目资料中的资料\s*(\d+)\s*份。?/g, "共查阅项目单位提供的相关资料$1份。");

const sanitizeFinalReportText = (
  text: string,
  sourceNames: string[] = [],
  sourceAliases: SourceAliasMap = {},
  sourceAliasCandidates: SourceAliasCandidates = {},
) =>
  rewriteProjectMaterialCitations(dedupeAdjacentParagraphs(stripGenericSuggestionTail(stripDuplicateOpeningBeforeThirdChapter(stripReportProcessTerms(String(text ?? ""))
    .replace(/已建立正文索引数量和未建索引数量/g, "已查阅资料范围")
    .replace(/\n?当前项目：[^。\n]*?项目资料共\s*\d+\s*份[^。\n]*?正文片段\s*\d+\s*段。?/g, "")
    .replace(/\n?当前项目：[^。\n]*?资料文件\s*\d+\s*个，资料\s*\d+\s*个。?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()))), sourceNames, sourceAliases, sourceAliasCandidates);

const limitContext = (text: string, max = 24000) => {
  const compact = String(text ?? "").trim();
  if (compact.length <= max) return compact;
  const head = compact.slice(0, Math.floor(max * 0.72));
  const tail = compact.slice(-Math.floor(max * 0.22));
  return `${head}\n\n【中间部分因上下文长度限制已压缩，保留前部总览和尾部关键证据】\n\n${tail}`;
};

const extractDossierBlock = (text: string, heading: string, nextHeadings: string[]) => {
  const source = String(text ?? "");
  const start = source.indexOf(heading);
  if (start < 0) return "";
  const afterHeading = start + heading.length;
  const next = nextHeadings
    .map((item) => source.indexOf(item, afterHeading))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return source.slice(start, next ?? source.length).trim();
};

const buildDeterministicFactDigest = (groundedRagText: string) => {
  const hardFacts = extractDossierBlock(groundedRagText, "【硬事实卡片】", [
    "【冲突口径】",
    "【可直接核验的事实/数据】",
    "【按事实类型归集】",
  ]) || extractDossierBlock(groundedRagText, "【零、硬事实卡片与禁止否认清单】", [
    "【零-A、冲突口径与强制修正】",
    "【一、逐文件证据清单】",
  ]);
  const conflictFacts = extractDossierBlock(groundedRagText, "【冲突口径】", [
    "【可直接核验的事实/数据】",
    "【按事实类型归集】",
  ]) || extractDossierBlock(groundedRagText, "【零-A、冲突口径与强制修正】", [
    "【一、逐文件证据清单】",
  ]);
  const directFacts = extractDossierBlock(groundedRagText, "【二、可直接核验的事实/数据】", [
    "【五、按事实类型归集】",
    "【六、按当前评估指标归集】",
  ]);
  return limitContext([hardFacts, conflictFacts, directFacts].filter(Boolean).join("\n\n"), 12000);
};

const normalizeEvidenceText = (value: unknown, max = 1800) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const buildProjectMeetingContext = async (supabase: any, projectId?: string) => {
  if (!projectId) return "";
  try {
    const { data: minutes, error } = await supabase
      .from("meeting_minutes")
      .select("id,title,meeting_date,content,updated_at,created_at")
      .eq("project_id", projectId)
      .order("meeting_date", { ascending: false })
      .limit(8);
    if (error) throw error;

    const minuteRows = (minutes ?? []) as any[];
    if (!minuteRows.length) return "";

    const minuteIds = minuteRows.map((row) => row.id).filter(Boolean);
    const { data: analyses } = minuteIds.length
      ? await supabase
        .from("meeting_analyses")
        .select("minute_id,summary,opinions,created_at")
        .in("minute_id", minuteIds)
      : { data: [] };
    const { data: recordings } = minuteIds.length
      ? await supabase
        .from("meeting_recordings")
        .select("meeting_id,speaker,transcript,transcript_status,created_at")
        .in("meeting_id", minuteIds)
        .eq("transcript_status", "done")
      : { data: [] };

    const analysisByMinute = new Map<string, any[]>();
    for (const row of (analyses ?? []) as any[]) {
      const key = String(row.minute_id ?? "");
      if (!key) continue;
      analysisByMinute.set(key, [...(analysisByMinute.get(key) ?? []), row]);
    }

    const recordingsByMinute = new Map<string, any[]>();
    for (const row of (recordings ?? []) as any[]) {
      const key = String(row.meeting_id ?? "");
      if (!key) continue;
      recordingsByMinute.set(key, [...(recordingsByMinute.get(key) ?? []), row]);
    }

    const blocks = minuteRows.map((minute, index) => {
      const analysisText = (analysisByMinute.get(String(minute.id)) ?? [])
        .map((row) => normalizeEvidenceText([
          row.summary,
          typeof row.opinions === "string" ? row.opinions : JSON.stringify(row.opinions ?? {}),
        ].filter(Boolean).join("；"), 1200))
        .filter(Boolean)
        .join("；");
      const transcriptText = (recordingsByMinute.get(String(minute.id)) ?? [])
        .map((row) => {
          const speaker = normalizeEvidenceText(row.speaker, 40) || "发言人";
          const text = normalizeEvidenceText(row.transcript, 900);
          return text ? `${speaker}：${text}` : "";
        })
        .filter(Boolean)
        .join("；");

      const meetingSummary = summarizeMeetingEvidence({
        analysisText,
        minuteText: normalizeEvidenceText(minute.content, 6000),
        transcriptText,
        maxPoints: 5,
        maxChars: 520,
      });

      return [
        `${index + 1}. 会议主题：${normalizeEvidenceText(minute.title, 120) || "未命名会议"}；会议日期：${minute.meeting_date ?? "未填写"}`,
        meetingSummary
          ? `会议结论摘要：${meetingSummary}`
          : "会议结论摘要：现有会议文字内容较少，暂未形成可提炼的实质性意见。",
        "摘要说明：以上内容由会议分析、纪要及录音转写中的明确观点提炼，不代表逐字转写原文。",
      ].filter(Boolean).join("\n");
    }).filter(Boolean);

    return blocks.length
      ? `【会议纪要与专家意见依据】\n${blocks.join("\n\n")}`
      : "";
  } catch (error) {
    console.warn("build meeting context failed", error);
    return "";
  }
};

const stripThirdChapterIntrusions = (text: string) => {
  const output = sliceFromHeading(String(text ?? "").trim(), "三、评估内容与结论");
  const intrusion = output.search(/\n(?:一、评估对象|二、评估方式和方法|四、相关建议|五、其他需要说明的问题|六、附件)(?:\n|$)/);
  return intrusion > 0 ? output.slice(0, intrusion).trim() : output;
};

const headingIndex = (text: string, heading: string) => {
  const direct = text.indexOf(heading);
  if (direct >= 0) return direct;
  const loose = new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
  const match = loose.exec(text);
  return match?.index ?? -1;
};

const isDanglingSentence = (text: string) => {
  const compact = String(text ?? "").trim();
  if (!compact) return false;
  const lastLine = compact.split(/\n+/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  if (!lastLine || /^[一二三四五六七八九十]+、/.test(lastLine)) return false;
  if (/[。！？；]$/.test(lastLine)) return false;
  return lastLine.length >= 18 || /^\d+[.．、]/.test(lastLine);
};

const trimDanglingLastParagraph = (text: string) => {
  let output = String(text ?? "").trim();
  if (!isDanglingSentence(output)) return output;
  const lastBreak = output.lastIndexOf("\n");
  if (lastBreak < 0) return "";
  output = output.slice(0, lastBreak).trim();
  return output;
};

const getBetweenHeadings = (text: string, startHeading: string, nextHeadings: string[]) => {
  const start = headingIndex(text, startHeading);
  if (start < 0) return "";
  const afterStart = start + startHeading.length;
  const next = nextHeadings
    .map((heading) => headingIndex(text.slice(afterStart), heading))
    .filter((index) => index >= 0)
    .map((index) => afterStart + index)
    .sort((a, b) => a - b)[0];
  return text.slice(start, next ?? text.length).trim();
};

const isGenericFallbackSection = (section: string) => {
  const compact = String(section ?? "");
  return /现有(?:资料|项目资料)?(?:暂未见|无法确认).*?完整判断的直接依据/.test(compact)
    || /证据链尚未完全闭合/.test(compact)
    || /现有索引未检出|资料索引未检出|RAG\s*V2|项目证据档案/.test(compact);
};

const ensureThirdChapterSubstance = (text: string, dimensions: string[], scoreSummary: string) => {
  const output = stripThirdChapterIntrusions(text);
  const headings = [
    ...dimensions.map((dimension, index) => `（${CN_SECTION_LABELS[index] ?? String(index + 1)}）${dimension}`),
    `（${CN_SECTION_LABELS[dimensions.length] ?? String(dimensions.length + 1)}）总体结论`,
  ];

  for (let index = 0; index < dimensions.length; index += 1) {
    const heading = headings[index];
    const nextHeading = headings[index + 1];
    const currentStart = headingIndex(output, heading);
    if (currentStart < 0) throw new Error(`第三章缺少指标小节：${dimensions[index]}`);
    const currentEnd = nextHeading ? headingIndex(output.slice(currentStart + heading.length), nextHeading) : -1;
    const absoluteEnd = currentEnd >= 0 ? currentStart + heading.length + currentEnd : output.length;
    const section = output.slice(currentStart, absoluteEnd).trim();
    const hasStructure = /事实依据/.test(section)
      && /发现的问题/.test(section)
      && /分析判断/.test(section)
      && /综上/.test(section)
      && section.replace(/\s+/g, "").length >= 180;
    if (!hasStructure || isDanglingSentence(section) || isGenericFallbackSection(section)) {
      throw new Error(`第三章“${dimensions[index]}”内容不完整或疑似兜底`);
    }
  }

  const overallHeading = headings[headings.length - 1];
  const overall = getBetweenHeadings(output, overallHeading, ["四、相关建议", "五、其他需要说明的问题", "六、附件"]);
  if (!overall || overall.replace(/\s+/g, "").length < 80 || isDanglingSentence(overall)) {
    throw new Error("第三章总体结论不完整");
  }

  return output;
};

const ensureFinalChaptersComplete = (text: string, dimensions: string[]) => {
  const raw = sanitizeSection(text);
  const fourIndex = headingIndex(raw, "四、相关建议");
  const fiveIndex = headingIndex(raw, "五、其他需要说明的问题");
  const sixIndex = headingIndex(raw, "六、附件");

  let suggestions = fourIndex >= 0
    ? raw.slice(fourIndex, [fiveIndex, sixIndex].filter((index) => index > fourIndex).sort((a, b) => a - b)[0] ?? raw.length).trim()
    : "四、相关建议";
  suggestions = trimDanglingLastParagraph(suggestions);
  if (!suggestions.includes("四、相关建议")) suggestions = `四、相关建议\n${suggestions}`.trim();

  suggestions = stripGenericSuggestionTail(`${suggestions}\n\n五、其他需要说明的问题`).replace(/\n\n五、其他需要说明的问题$/, "").trim();
  const existingSuggestionCount =
    (suggestions.match(/^\s*\d+[.．、]/gm) ?? []).length
    + (suggestions.match(/^\s*（[一二三四五六七八九十]+）/gm) ?? []).length;
  if (existingSuggestionCount < 4) {
    throw new Error("第四章建议不完整，已阻止默认建议兜底");
  }

  const notes = REPORT_NOTES_LINES.join("\n");
  const attachments = REPORT_ATTACHMENT_LINES.join("\n");

  return `${suggestions}\n\n${notes}\n\n${attachments}`.trim();
};

const ensureOpeningChaptersComplete = (text: string, project: ReqBody["project"]) => {
  const output = trimDanglingLastParagraph(sanitizeSection(text));
  if (!/一、评估对象/.test(output)) throw new Error("缺少第一章“评估对象”");
  const firstChapterRequirements = REPORT_EVALUATION_TARGET_LINES.filter((line) => !line.endsWith("："));
  for (const heading of firstChapterRequirements) {
    if (!output.includes(heading)) {
      throw new Error(`第一章缺少标准小节：${heading}`);
    }
  }
  if (!/二、评估方式和方法/.test(output)) {
    throw new Error("缺少第二章“评估方式和方法”");
  }
  const methodRequirements = REPORT_METHOD_LINES.slice(1);
  for (const heading of methodRequirements) {
    if (!output.includes(heading)) {
      throw new Error(`第二章缺少标准小节：${heading}`);
    }
  }
  return output.trim();
};

const hasEvidence = (source: string, pattern: RegExp) => pattern.test(source);

const extractHardEvidenceFlags = (source: string) => {
  const evidence = String(source ?? "");
  const authoritativeEvidence = evidence
    .split(/\n+/)
    .filter((line) => !/系统生成报告|报告历史稿|报告成果/.test(line))
    .join("\n");
  return {
    hasProcurementReality: hasEvidence(authoritativeEvidence, /询价|延续使用|未再次三方比价|未再次比价|单一来源|服务商|供应商|中标|成交/i),
    hasFieldRecord: hasEvidence(authoritativeEvidence, /现场调研记录|调研地点|调研日期|现场调研录音转写|实地调研|踏勘记录/i),
    hasPreMeetingRecord: hasEvidence(authoritativeEvidence, /专家预评估会|预评估会|预评估会议/i),
    hasMeetingRecord: hasEvidence(authoritativeEvidence, /【会议纪要与专家意见依据】|会议主题|会议日期|纪要原文|录音转写|会议分析/i),
  };
};

const insertEvidenceAfterHeading = (text: string, heading: string, sentence: string) => {
  if (text.includes(sentence)) return text;
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escapedHeading}\\s*\\n\\s*(?:1[.．])?事实依据[：:]?)`);
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `$1${sentence}`);
};

const insertParagraphAfterHeading = (text: string, heading: string, paragraph: string) => {
  const cleanParagraph = String(paragraph ?? "").trim();
  if (!cleanParagraph || text.includes(cleanParagraph)) return text;
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escapedHeading}\\s*)`);
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `$1\n${cleanParagraph}\n`);
};

const replaceOrInsertNumberedSection = (text: string, heading: string, body: string) => {
  const cleanBody = String(body ?? "").trim();
  if (!cleanBody) return text;
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(^|\\n)\\s*${escapedHeading}\\s*[\\s\\S]*?(?=\\n\\s*(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）)|$)`,
    "g"
  );
  if (pattern.test(text)) {
    return text.replace(pattern, `\n${heading}\n${cleanBody}`);
  }
  return insertParagraphAfterHeading(text, "（三）评估方式", `${heading}\n${cleanBody}`);
};

const buildMeetingUseParagraph = (evidenceSource: string) => {
  const source = String(evidenceSource ?? "");
  if (!/【会议纪要与专家意见依据】|会议主题|会议日期|会议结论摘要|纪要原文|录音转写|会议分析/i.test(source)) return "";
  const rawTitle = source.match(/会议主题：([^；\n]{1,80})/)?.[1]?.trim();
  const title = rawTitle?.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}(?:专家预评估会|专家会))/)?.[1]
    ?? rawTitle?.replace(/^(?:测试[，,\s]*)+/, "").replace(/【[^】]+】/g, "").trim();
  const rawDate = source.match(/会议日期：([^；\n]{1,80})/)?.[1]?.trim() ?? "";
  const date = rawDate.match(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?/)?.[0]
    ?? rawDate.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    ?? "";
  const raw = source.match(/会议结论摘要：([\s\S]*?)(?:\n摘要说明：|\n\d+[.．、]\s*会议主题：|\n【|$)/)?.[1]
    ?? source.match(/会议分析：([\s\S]*?)(?:\n录音转写：|\n\d+[.．、]\s*会议主题：|\n【|$)/)?.[1]
    ?? source.match(/纪要原文：([\s\S]*?)(?:\n会议分析：|\n录音转写：|\n\d+[.．、]\s*会议主题：|\n【|$)/)?.[1]
    ?? source.match(/录音转写：([\s\S]*?)(?:\n\d+[.．、]\s*会议主题：|\n【|$)/)?.[1]
    ?? "";
  const summary = summarizeMeetingEvidence({
    analysisText: raw,
    maxPoints: 3,
    maxChars: 280,
  });
  const sourceLabel = [
    title && title !== "未命名会议" ? `《${title}》` : "会议纪要或录音转写稿",
    date && date !== "未填写" ? `（${date}）` : "",
  ].filter(Boolean).join("");
  const evidencePart = summary
    ? `根据${sourceLabel}，会议主要形成以下意见：${summary}`
    : `根据${sourceLabel}可见，项目已形成会议文字记录，可作为专家讨论与项目沟通情况的文字依据。`;
  return `${evidencePart}归档时应补充参会人员、签到表和专家组集体意见。`;
};

const stripFormalExpertMeetingSections = stripDeprecatedReportMethodSections;

const applyHardFactCorrections = (
  draft: string,
  evidenceSource: string,
  sourceNames: string[] = [],
  serviceProviders: ServiceProviderMention[] = [],
) => {
  const flags = extractHardEvidenceFlags(evidenceSource);
  let output = stripFormalExpertMeetingSections(draft).trim();

  if (flags.hasProcurementReality) {
    output = output
      .replace(/按政府采购流程遴选服务商/g, "按资料载明的询价、延续合作或实际采购口径确定服务商")
      .replace(/通过政府采购流程遴选服务商/g, "通过资料载明的询价、延续合作或实际采购口径确定服务商");
  }

  output = ensureServiceProviderDisclosure(output, serviceProviders);

  if (flags.hasMeetingRecord) {
    const meetingRecordSentence = "资料显示，项目已形成会议纪要或录音转写稿，可作为专家预评估会讨论与项目沟通情况的文字依据；定稿归档时仍建议补充参会人员、签到表及专家组集体意见等材料。";
    const meetingUseParagraph = buildMeetingUseParagraph(evidenceSource);
    output = output
      .replace(/根据现有资料暂未见明确的专家预评估会会议纪要、签到表或录音转写稿。?/g, meetingRecordSentence)
      .replace(/根据现有资料暂未见明确的专家预评估会会议纪要、签到表或会议录音转写稿。?/g, meetingRecordSentence)
      .replace(/根据现有资料暂未见明确的专家预评估会会议纪要、签到表或决议文件。?/g, meetingRecordSentence)
      .replace(/根据现有资料暂未见明确的[“"]?专家预评估会[”"]?会议纪要、签到表或决议文件。?/g, meetingRecordSentence)
      .replace(/虽已形成部分专家沟通记录，但需补充正式的预评估会议材料[^。\n]*。?/g, "定稿归档时仍建议补充参会人员、签到表和专家组集体意见等材料，以完善专家预评估会程序证据链。")
      .replace(/虽已形成部分专家沟通记录[^。\n]*。?/g, meetingRecordSentence)
      .replace(/需补充专家预评估会的完整会议材料，包括会议议程、参会专家名单、讨论要点及形成的初步意见，以证明预评估程序的规范性。?/g, "后续归档时建议补充会议类型、参会专家名单、签到表和专家组集体意见，以完善专家预评估会程序证据链。")
      .replace(/根据现有资料[，,]\s*尚未提供([^。\n]{0,60}?)(会议纪要)(?:及|和)([^。\n]{0,80}?)(?:会议记录|签到表)[^。\n]*。/g, meetingRecordSentence)
      .replace(/尚未提供([^。\n]{0,60}?)(会议纪要)(?:及|和)([^。\n]{0,80}?)(?:会议记录|签到表)[^。\n]*。/g, meetingRecordSentence)
      .replace(/(?:未见|暂未见|缺少)([^。\n]{0,60}?)(会议纪要)(?:及|和)([^。\n]{0,80}?)(?:会议记录|签到表)[^。\n]*。/g, meetingRecordSentence)
      .replace(/(?:尚未提供|未提供|未见|暂未见|缺少)(?:相关)?(?:会议记录|会议纪要|专家会议记录|专家会议纪要)[^。\n]*。/g, meetingRecordSentence)
      .replace(/(?:会议记录|会议纪要|专家会议记录|专家会议纪要)(?:尚未提供|未提供|未见|暂未见|缺少)[^。\n]*。/g, meetingRecordSentence)
      .replace(/((?:会议|专家会)[^。\n]{0,80})(?:尚未提供|未提供|未见|暂未见|缺少)相关记录/g, meetingRecordSentence)
      .replace(/没有事实数据时写明尚未提供相关记录。?/g, "");
    output = replaceOrInsertNumberedSection(output, "3.召开专家预评估会", meetingUseParagraph || meetingRecordSentence);
  }

  if (!flags.hasFieldRecord) {
    output = output
      .replace(/评估工作组对项目单位进行了现场调研[^。\n]*。/g, "根据现有资料暂未见明确的现场调研记录，需补充现场调研时间、地点、参与人员、调研内容及调研结论等材料。")
      .replace(/通过与项目负责人及相关科室人员座谈[^。\n]*。/g, "如已开展座谈或实地核验，应补充相应记录后再作为评估依据。")
      .replace(/并结合现场调研情况/g, "并结合项目单位所提供资料及已形成的会议文字记录");
  }

  if (!flags.hasPreMeetingRecord && !flags.hasMeetingRecord) {
    output = output.replace(
      /在正式评估前，评估工作组组织了专家预评估会[^。\n]*。[^。\n]*。?/g,
      "根据现有资料暂未见明确标注为专家预评估会的会议记录；如已召开预评估会，应补充会议日期、参会人员、签到表、会议纪要及初步意见。"
    );
  }

  output = output
    .replace(/采用“五维论证”方法[^。\n]*。/g, "采用多维论证方法，围绕当前项目已关联的评估指标体系开展综合评价。")
    .replace(/五维论证/g, "多维论证")
    .replace(/（注：[^）]{0,120}五维[^）]{0,120}）/g, "");

  return stripFormalExpertMeetingSections(output);
};

const buildFactDigest = async (
  project: ReqBody["project"],
  groundedRagText: string,
  factPackText: string,
  evidenceMatrixText: string,
) => {
  if (!groundedRagText && !factPackText && !evidenceMatrixText) return "";
  const prompt = `请从以下“项目资料依据”中提取一份【可直接用于报告写作的事实清单】。

要求：
1. 只抽取证据中明确出现的事实，不要推断、不要补写。
2. 必须优先列出：项目名称、项目单位、预算金额、预算分项、数量/单价/时间口径、绩效目标值、政策依据/标准号、实施周期、采购方式、服务商、供应商资质、实施方案、检查/抽检机制、会议/专家明确意见。
3. 每条事实后用括号写明来源文件或证据线索。
4. 如果资料中存在不同口径，要并列写出“口径差异”，不能自行合并。
5. 输出中文纯文本，不使用 Markdown 表格。

项目信息：${project.name}，${project.unit}，预算 ${project.budget} 元

${groundedRagText ? `【项目资料依据】\n${groundedRagText}\n\n` : ""}

${factPackText}

${evidenceMatrixText}`;
  try {
    return sanitizeSection(await callReportSection(
      "你是严谨的财政绩效评估资料核验员。你的任务是抽取事实，不是写报告。",
      prompt,
      5200,
      1,
    ));
  } catch (error) {
    console.warn("build fact digest failed", error);
    return "";
  }
};

const auditAndRepairThirdChapter = async (
  draft: string,
  dimensions: string[],
  groundedRagText: string,
  factPackText: string,
  factDigest: string,
  evidenceMatrixText: string,
  scoreSummary: string,
  sourceNames: string[] = [],
) => {
  const withHeadings = stripThirdChapterIntrusions(draft);
  if (!groundedRagText && !factPackText && !evidenceMatrixText) return withHeadings;

  const prompt = `请对下面的“第三章草稿”做一次证据驱动修订，输出修订后的完整第三章。

必须执行：
1. 只保留“项目资料依据 / 事实清单 / 专家评分摘要”能支撑的内容。
2. 如果草稿中写了“未提供、缺少、无法确认、不明确”，但项目资料依据或事实清单已有对应数据，必须改为“资料显示/根据……可见”，并补上已有事实。
3. 如果草稿中出现会议、专家、政策、金额、数量、标准号、采购方式等没有来源的内容，必须删除或改成“根据现有资料暂未见明确依据”。
4. 第三章必须严格按这些指标展开：${dimensions.join("、")}；不得替换为默认五项。
5. 每个指标保留“1.事实依据 2.发现的问题 3.分析判断 4.综上结论”。
6. 每条事实依据必须尽量写明来源文件名或来源线索；没有来源的事实必须删除。
7. 若“硬事实卡片与禁止否认清单”已证明某类事实，必须删除或改写草稿中同类“缺少、未提供、无法确认、不明确”的判断。
8. 不使用 Markdown，不输出解释，只输出完整第三章。

【事实清单】
${factDigest || "（未生成事实清单，以下以项目资料依据为准）"}

${groundedRagText ? `【项目资料依据】\n${groundedRagText}\n\n` : ""}

${factPackText}

${evidenceMatrixText}

${scoreSummary ? `【专家评分摘要】\n${scoreSummary}` : ""}

【第三章草稿】
${withHeadings}`;

  try {
    const repaired = sanitizeSection(await callReportSection(
      "你是报告质量复核员，只能依据证据修订报告，禁止补写无来源事实。",
      prompt,
      7000,
      1,
    ));
    return applyHardFactCorrections(
      ensureThirdChapterSubstance(repaired || withHeadings, dimensions, scoreSummary),
      [groundedRagText, factPackText, factDigest, evidenceMatrixText].filter(Boolean).join("\n"),
      sourceNames,
    );
  } catch (error) {
    console.warn("audit and repair third chapter failed", error);
    throw error instanceof Error ? error : new Error("第三章证据修订失败");
  }
};

const auditAndRepairEvidenceContradictions = async (
  draft: string,
  sectionName: string,
  groundedRagText: string,
  factDigest: string,
  sourceNames: string[] = [],
) => {
  if (!groundedRagText || !/(无法确认|未提供|缺少|不明确|标准|采购流程|采购方式|会议记录|会议纪要)/i.test(draft)) {
    return draft;
  }

  const prompt = `请核对并修订下面的“${sectionName}草稿”，只输出修订后的完整${sectionName}。

必须执行：
1. 重点检查草稿中的“无法确认、未提供、缺少、不明确、采购流程、采购方式、标准号、会议记录”等表述。
2. 如果【项目资料依据】或【结构化事实清单】已经列出对应事实，必须把否定表述改为“资料显示/根据……可见”，并写出来源线索。
3. 如果项目资料依据的“硬事实卡片与禁止否认清单”已经说明某类事实，草稿不得继续否认该事实存在。
4. 如草稿中的标准号、政策名称、采购方式与项目资料依据不一致，必须以项目资料依据为准；资料依据没有出现的标准号、政策名称或采购方式必须删除。
5. 如项目资料依据出现具体采购事实，不得泛化为资料中没有出现的采购流程。
6. 不使用 Markdown，不解释修订过程，只输出修订后的章节正文。

【结构化事实清单】
${factDigest || "（无）"}

【项目资料依据】
${groundedRagText}

【${sectionName}草稿】
${draft}`;

  try {
    const repaired = sanitizeSection(await callReportSection(
      "你是财政绩效评估报告一致性核对员。只能依据项目资料修订矛盾表述，禁止新增无来源事实。",
      prompt,
      sectionName === "一至二章" ? 5200 : 3200,
      1,
    ));
    return applyHardFactCorrections(repaired || draft, [groundedRagText, factDigest].filter(Boolean).join("\n"), sourceNames);
  } catch (error) {
    console.warn(`audit evidence contradictions failed: ${sectionName}`, error);
    return applyHardFactCorrections(draft, [groundedRagText, factDigest].filter(Boolean).join("\n"), sourceNames);
  }
};

const buildSharedWritingContext = (
  project: ReqBody["project"],
  indicatorText: string,
  knowledgeText: string,
  groundedRagText: string,
  evidenceMatrixText: string,
  factPackText: string,
  factDigest: string,
  scoreSummary: string,
  meetingContext: string,
  extra = "",
) => `项目信息：
项目名称：${project.name}
申请单位：${project.unit}
预算金额：人民币 ${project.budget.toLocaleString()} 元
项目类别：${project.category ?? "未分类"}
项目说明：${project.description ?? "（暂无）"}

${indicatorText}

${!groundedRagText && factDigest ? `【结构化事实清单】\n${factDigest}\n\n` : ""}${groundedRagText ? `${groundedRagText}\n\n` : ""}${factPackText ? `${factPackText}\n\n` : ""}${evidenceMatrixText ? `${evidenceMatrixText}\n\n` : ""}${knowledgeText ? `${knowledgeText}\n\n` : ""}${meetingContext ? `${meetingContext}\n\n` : ""}${scoreSummary ? `${scoreSummary}\n\n` : ""}${extra ? `补充材料与专家意见：\n${extra}\n\n` : ""}`;

const buildSectionPrompts = (
  project: ReqBody["project"],
  dimensions: string[],
  indicatorText: string,
  knowledgeText: string,
  sectionContexts: ReportSectionContexts,
  evidenceMatrixText: string,
  factPackText: string,
  factDigest: string,
  scoreSummary: string,
  meetingContext: string,
  sourceNames: string[] = [],
  systemRecordNames: string[] = [],
  sourceAliases: SourceAliasMap = {},
  sourceAliasCandidates: SourceAliasCandidates = {},
  serviceProviders: ServiceProviderMention[] = [],
  extra = "",
) => {
  const sharedOpening = buildSharedWritingContext(project, indicatorText, knowledgeText, sectionContexts.opening, evidenceMatrixText, factPackText, factDigest, scoreSummary, meetingContext, extra);
  const sharedEvaluation = buildSharedWritingContext(project, indicatorText, knowledgeText, sectionContexts.evaluation, evidenceMatrixText, factPackText, factDigest, scoreSummary, meetingContext, extra);
  const sharedClosing = buildSharedWritingContext(project, indicatorText, knowledgeText, sectionContexts.closing, evidenceMatrixText, factPackText, factDigest, scoreSummary, meetingContext, extra);
  const sourceNameRule = sourceNames.length
    ? `\n当前项目允许作为资料来源引用的真实名称如下，凡不在此清单内的项目资料名不得写成文件名：\n${sourceNames.map((name, index) => `${index + 1}. ${formatSourceCitation(name)}`).join("\n")}\n`
    : "\n当前项目未读取到可引用真实文件名，报告不得自行编造《资料名称》。\n";
  const systemRecordRule = systemRecordNames.length
    ? `系统内还保存了以下项目原始记录，它们可以作为事实依据，但不是上传附件：\n${systemRecordNames
      .map((name, index) => `${index + 1}. ${name}`)
      .join("\n")}
引用这些记录时只能写成“根据系统内已保存的某某会议纪要/评估方案/调研记录”，不得添加 .doc/.docx/.pdf 后缀，也不得用书名号伪装成上传文件。\n`
    : "";
  const sourceAliasRule = Object.keys(sourceAliases).length
    ? `资料项标题必须替换为对应的真实上传文件名：\n${Object.entries(sourceAliases)
      .map(([alias, fileName], index) => `${index + 1}. “${alias}”只能引用为${formatSourceCitation(fileName)}`)
      .join("\n")}\n`
    : "";
  const sourceAliasCandidateRule = Object.keys(sourceAliasCandidates).length
    ? `以下资料项对应多个真实上传文件，正文不得再使用资料项标题，必须列出实际用到的真实文件名：\n${Object.entries(sourceAliasCandidates)
      .filter(([, fileNames]) => fileNames.length > 1)
      .map(([alias, fileNames], index) => `${index + 1}. “${alias}”对应：${fileNames.map(formatSourceCitation).join("、")}`)
      .join("\n")}\n`
    : "";
  const serviceProviderRule = serviceProviders.length
    ? `当前项目资料已通过合同、结算、实施方案或多文件交叉证据识别到以下服务商事实，相关章节不得漏写，也不得替换成其他公司；仅出现在单份询价/报价候选材料中的公司不得写成已确定服务商：\n${serviceProviders
      .map((item, index) =>
        `${index + 1}. ${item.name}；交叉来源：${item.evidenceCount ?? 1}份；来源：${formatSourceCitation(item.sourceName)}`
      )
      .join("\n")}\n`
    : "";
  const commonRules = `共同规则：
1. 只输出指定章节正文，不输出封面、目录、寒暄或解释。
2. 不使用 Markdown，不使用项目符号，不使用英文标题。
3. 模板只提供章节结构，不提供事实。所有事实、金额、日期、标准、文件名、会议意见、专家观点、项目结论必须来自【项目资料依据】【会议纪要与专家意见依据】【专家评分摘要】；这些依据没有出现的内容不得写成事实。
4. 不得虚构资料中没有出现的事实、金额、日期、政策名称、专家意见。
5. 对证据不足处，只能写“根据现有资料暂未见明确依据/根据现有资料无法确认”，并说明需补充什么，不得自行编造。
6. 如果【结构化事实清单】或【项目资料依据】已有明确数值、文件、标准号或时间口径，不得写相反的“无法确认/未提供”。
7. 如果【项目资料依据】列出冲突口径，必须采用“强制修正”后的口径，不能继续沿用风险表述。
8. 如果【硬事实卡片与禁止否认清单】已列出某类事实，报告中不得再否认该类事实存在。
9. 如果提供了【会议纪要与专家意见依据】，不得写“尚未提供会议记录/会议纪要/专家会议记录”等相反表述；引用会议观点时只能来自该依据。
10. 现场调研、市场调研、比价、采购方式、成本节约等流程或事实，必须有资料原文明确支撑才能写成已发生/已证明；没有明确依据时必须写“需补充……”，不能为了报告完整而补写。
11. 引用来源时必须从“可引用真实资料名称”中选择；不得把资料清单标题、指标要求或模板附件名写成文件名。
12. 如果某个项目材料名称不在“可引用真实资料名称”中，绝对不得把它写成书名号引用。
13. 正文不得出现 RAG、文件库、索引、切片、OCR、模型等系统实现词。
14. “可行性研究报告”“实施方案”“预算测算材料”等资料项大标题不能直接作为文件名引用；存在对应关系时必须改用真实上传文件名。
15. 写作前必须逐项阅读【逐文件全覆盖证据】；该清单中的每份文件都已纳入本章证据输入，不得只依据排在前面的文件。
16. 如提供【当前系统专家评分汇总（权威口径）】，总平均分、逐指标平均分和有效扣分理由必须完全采用该汇总；上传的历史专家意见书只能辅助理解文字意见，不能覆盖当前评分。不得把满分指标写成存在专家扣分，也不得把一个专家的分值写成专家平均分。
17. 【绩效目标原值锁定表】中的每项指标必须在第一章体现，比较符号、数值和单位必须逐字保留。响应率、满意度、控制率、运行率等分别属于独立事实，禁止因为数值相近而合并；已有量化经济效益时禁止写“无法确认具体经济效益指标值”。
18. 上传文件和系统记录必须严格区分：只有“可引用真实资料名称”中的名称可以使用书名号并作为文件引用；系统内会议纪要、录音转写、评估方案和调研记录只能按系统记录表述，不得生成并不存在的附件文件名。${sourceNameRule}${systemRecordRule}${sourceAliasRule}${sourceAliasCandidateRule}${serviceProviderRule}`;

  return [
    {
      name: "一至二章",
      maxTokens: 3600,
      evidenceText: sectionContexts.opening,
      prompt: `${sharedOpening}${commonRules}

请只生成以下章节：
一、评估对象
二、评估方式和方法

要求：
1. 第一章完整保留项目绩效目标九类指标、资金总额、项目概况；第二章保留评估程序、评估思路及方法，并且“评估方式”只保留三项：项目基本情况现场调研、查阅资料、召开专家预评估会。
2. 第一章九类指标必须优先使用【硬事实卡片与禁止否认清单】。如果资料已出现某项指标值、实施周期、服务内容或供应商等事实，不得写“无法确认”。
3. 政策标准必须优先采用项目资料里的最新/实际标准口径，不得写被冲突口径标记为风险的旧标准。
4. 第二章“2.查阅资料”只写资料查阅范围、查阅方式和资料核验重点，不得写文件库、索引数量、切片数量等系统信息。
5. “3.召开专家预评估会”必须使用【会议纪要与专家意见依据】中的会议主题、会议日期和会议结论摘要；仅概括 2-3 条最重要的会议结论，总字数控制在 300 字以内，不得整段复制纪要原文或录音转写，不得保留时间戳和发言人标签；不得再写“未提供会议记录/会议纪要/决议文件”。如参会人员、签到表或专家组集体意见未明确，只能简要写明尚需补充的归档材料。不得生成已删除的正式评估会议相关小节。`,
    },
    {
      name: "第三章",
      maxTokens: 6200,
      evidenceText: sectionContexts.evaluation,
      prompt: `${sharedEvaluation}${commonRules}

请只生成以下章节：
三、评估内容与结论
${buildEvaluationContentToc(dimensions)}

强制要求：
1. 第三章必须按当前项目实际指标展开：${dimensions.join("、")}。
2. 不得使用默认“项目必要性、项目可行性、项目经济性、项目效率性、项目效益性”，除非它们本来就是当前项目指标。
3. 每个指标必须按“1.事实依据 2.发现的问题 3.分析判断 4.综上结论”写。
	4. 必须优先使用【项目资料依据】中的当前项目资料；如果资料依据列出了已上传文件，不能忽略。
	5. 必须先使用【结构化事实清单】和【项目资料依据】中的事实，尤其是预算、绩效目标、标准号、采购方式、服务商、实施周期、历史数量和单价。
	6. 没有证据的点只能说“根据现有资料暂未见明确依据”，不能写成“会议认为/专家指出/项目单位未提供”。
	7. 如果引用专家或会议观点，必须来自补充材料或证据矩阵明确文本；不能把通用建议写成会议结论。
	8. 每一指标事实依据中至少写出 2 个来源线索；如果只有 1 个证据，必须说明仍需补充交叉验证材料。
	9. 对任何带金额、数量、比例、标准号、日期或目标值的句子，必须能在项目资料中找到同类原文片段；找不到时不得写成已明确。
	10. 第三章要尽量覆盖不同文件来源，不得反复只引用同一两份资料；与当前项目事实、预算、目标、实施、政策、专家意见相关的文件都应被吸收到对应指标或总体结论中。
	11. 成本节约、市场调研、采购限价、现场调研、会议召开、供应商、采购方式等内容都必须有原文证据；如果只在历史生成稿中出现，不能作为当前项目事实。
	12. 如果资料中出现供应商、询价、延续使用、比价或单一来源等采购服务信息，必须在项目概况、立项必要性或可行性分析中吸收，不能漏写。
	13. 第三章不要写“AI核验、模型判断、自我修正、RAG、文件库、索引、OCR”等过程性或系统实现表达。
	14. 每个指标的得分必须使用【当前系统专家评分汇总（权威口径）】中的逐指标平均分；扣分理由只能引用该汇总明确列出的当前有效理由。`,
	    },
    {
      name: "四至六章",
      maxTokens: 3600,
      evidenceText: sectionContexts.closing,
      prompt: `${sharedClosing}${commonRules}

请只生成以下章节：
四、相关建议
五、其他需要说明的问题
六、附件

	要求：第四章建议必须对应第三章的资料缺口和问题；第五章两段固定说明必须原样保留；第六章只保留四项附件清单。`,
    },
  ];
};

const refreshProjectKnowledgeIndex = async (supabase: any, projectId?: string) => {
  if (!projectId) return { indexed: 0, skipped: 0, failed: 0 };
  try {
    const { data, error } = await supabase.functions.invoke("ingest-project-knowledge", {
      body: { projectId, limit: 500, force: false },
    });
    if (error) throw error;
    return {
      indexed: Number(data?.indexed ?? 0),
      skipped: Number(data?.skipped ?? 0),
      failed: Number(data?.failed ?? 0),
    };
  } catch (error) {
    console.warn("refresh project knowledge index failed", error);
    return { indexed: 0, skipped: 0, failed: 0 };
  }
};

const retryUnreadableProjectMaterials = async (
  supabase: any,
  project: ReqBody["project"],
  dimensions: string[],
  extra: string,
  dossier: any,
) => {
  let verification = verifyReportPreflight(dossier);
  if (verification.status !== "blocked" || !project.id) {
    return { dossier, verification, retried: 0 };
  }

  const unreadableMaterials = Array.from(
    new Map(
      (Array.isArray(dossier.fileReviews) ? dossier.fileReviews : [])
        .filter((file: any) =>
          file?.status === "unreadable"
          && String(file?.sourceType ?? file?.source_type ?? "") === "material"
          && file?.sourceId
        )
        .map((file: any) => [String(file.sourceId), file]),
    ).values(),
  ).slice(0, 8);

  if (!unreadableMaterials.length) {
    return { dossier, verification, retried: 0 };
  }

  let retried = 0;
  for (const file of unreadableMaterials) {
    try {
      const { error } = await supabase.functions.invoke("ingest-project-knowledge", {
        body: { materialId: file.sourceId, force: true, limit: 1 },
      });
      if (error) throw error;
      retried += 1;
    } catch (error) {
      console.warn("retry unreadable material index failed", file.fileName, error);
    }
  }

  if (!retried) {
    return { dossier, verification, retried: 0 };
  }

  const rebuiltDossier = await buildReportRagDossier(supabase, project, dimensions, extra);
  verification = verifyReportPreflight(rebuiltDossier as any);
  return { dossier: rebuiltDossier, verification, retried };
};

async function buildIndicatorSummary(projectId: string): Promise<{ dimensions: string[]; text: string }> {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);
    const { data: project } = await sb
      .from("projects")
      .select("evaluation_system_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project?.evaluation_system_id) {
      throw new Error("当前项目未关联评估指标体系，已停止生成，避免使用默认五项兜底。");
    }
    const { data: indicators } = await sb
      .from("evaluation_indicators")
      .select("code,name,weight,level,sort_order")
      .eq("system_id", project.evaluation_system_id)
      .order("sort_order", { ascending: true });
    const rows = (indicators ?? []).filter((item: any) => Number(item.level ?? 1) === 1 || item.level === null);
    const dimensions = rows.map((item: any) => String(item.name ?? "").trim()).filter(Boolean);
    if (!dimensions.length) {
      throw new Error("当前项目已关联评估指标体系，但未读取到一级指标，已停止生成。");
    }
    return {
      dimensions,
      text: `当前项目已关联评估指标体系，第三章必须按以下一级指标展开，不得替换为默认五项：\n${rows.map((item: any, index: number) =>
        `${index + 1}. ${item.code ? `[${item.code}] ` : ""}${item.name}${item.weight !== null && item.weight !== undefined ? `（权重 ${item.weight}）` : ""}`
      ).join("\n")}`,
    };
  } catch (e) {
    console.error("buildIndicatorSummary error:", e);
    throw e instanceof Error ? e : new Error("读取评估指标体系失败，已停止生成。");
  }
}

async function buildScoreSummary(projectId: string): Promise<ScoreSummaryResult> {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);
    const { data: scores } = await sb
      .from("expert_scores")
      .select("score, max_score, deduct_reason, expert_name, indicator_id, created_at")
      .eq("project_id", projectId);
    if (!scores || !scores.length) return { text: "", snapshot: null };

    // One expert may upload or edit the same sheet more than once. Only the
    // latest score for each expert + indicator pair participates in the
    // authoritative aggregate.
    const latestScores = new Map<string, any>();
    for (const row of scores as any[]) {
      const key = `${String(row.expert_name ?? "匿名")}::${String(row.indicator_id ?? "")}`;
      const current = latestScores.get(key);
      if (!current || String(row.created_at ?? "") >= String(current.created_at ?? "")) {
        latestScores.set(key, row);
      }
    }
    const currentScores = Array.from(latestScores.values());

    // 按指标聚合
    const indIds = Array.from(new Set(currentScores.map((r: any) => r.indicator_id)));
    const { data: inds } = await sb
      .from("evaluation_indicators")
      .select("id,name,code")
      .in("id", indIds);
    const indMap: Record<string, { name: string; code: string | null }> = {};
    (inds ?? []).forEach((i: any) => { indMap[i.id] = { name: i.name, code: i.code }; });

    // 按专家分组
    const byExpert: Record<string, { sum: number; max: number }> = {};
    const byIndicator = new Map<string, {
      name: string;
      sum: number;
      max: number;
      experts: Set<string>;
      reasons: Set<string>;
    }>();
    currentScores.forEach((r: any) => {
      const e = r.expert_name ?? "匿名";
      const rawScore = Number(r.score) || 0;
      const rawMax = Number(r.max_score) || 0;
      const score = rawMax > 0 ? Math.min(Math.max(rawScore, 0), rawMax) : Math.max(rawScore, 0);
      byExpert[e] ??= { sum: 0, max: 0 };
      byExpert[e].sum += score;
      byExpert[e].max += rawMax;

      const indicatorId = String(r.indicator_id ?? "");
      const indicatorName = indMap[indicatorId]?.name ?? "未命名指标";
      const aggregate = byIndicator.get(indicatorId) ?? {
        name: indicatorName,
        sum: 0,
        max: 0,
        experts: new Set<string>(),
        reasons: new Set<string>(),
      };
      aggregate.sum += score;
      aggregate.max += rawMax;
      aggregate.experts.add(e);
      const reason = String(r.deduct_reason ?? "").trim();
      if (reason && score + 0.005 < rawMax) aggregate.reasons.add(reason);
      byIndicator.set(indicatorId, aggregate);
    });

    const expertCount = Object.keys(byExpert).length;
    if (!expertCount) return { text: "", snapshot: null };
    const indicatorScores: AuthoritativeIndicatorScore[] = Array.from(byIndicator.values()).map((row) => {
      const count = Math.max(1, row.experts.size);
      return {
        name: row.name,
        average: row.sum / count,
        maxAverage: row.max / count,
        expertCount: count,
        reasons: Array.from(row.reasons),
      };
    });
    const reasons = indicatorScores.flatMap((indicator) =>
      indicator.reasons.map((reason) => ({
        ind: indicator.name,
        reason,
      }))
    );
    const expertRows = Object.entries(byExpert).map(([e, v]) =>
      `  · ${e}：${v.sum.toFixed(1)} / ${v.max.toFixed(1)} 分`
    );
    const avg = Object.values(byExpert).reduce((a, b) => a + b.sum, 0) / expertCount;
    const maxAvg = Object.values(byExpert).reduce((a, b) => a + b.max, 0) / expertCount;
    const snapshot: AuthoritativeScoreSnapshot = {
      average: avg,
      maxAverage: maxAvg,
      expertCount,
      indicators: indicatorScores,
    };

    let out = `【当前系统专家评分汇总（权威口径）】\n`;
    out += `当前共有 ${expertCount} 位专家参与打分；总平均得分：${avg.toFixed(2)} / ${maxAvg.toFixed(2)} 分。\n`;
    out += `逐指标平均分（正文和总体结论必须使用以下数据，优先级高于上传的历史专家意见书）：\n`;
    out += indicatorScores.map((indicator, index) =>
      `  ${index + 1}. [${indicator.name}] ${indicator.average.toFixed(2)} / ${indicator.maxAverage.toFixed(2)} 分${
        indicator.reasons.length
          ? `；有效扣分理由：${indicator.reasons.join("；")}`
          : "；无已记录扣分理由"
      }`
    ).join("\n");
    out += `\n各专家总分：\n${expertRows.join("\n")}\n`;
    if (reasons.length) {
      out += `主要扣分理由（仅来自当前未满分评分记录，前 8 条）：\n`;
      out += reasons.slice(0, 8).map((r, i) => `   ${i + 1}. [${r.ind}] ${r.reason}`).join("\n");
    }
    return { text: out, snapshot };
  } catch (e) {
    console.error("buildScoreSummary error:", e);
    return { text: "", snapshot: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project, extra }: ReqBody = await req.json();
    if (!project?.name) {
      return new Response(JSON.stringify({ error: "缺少项目信息" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const indicatorSummary = project.id
      ? await buildIndicatorSummary(project.id)
      : (() => { throw new Error("未提供项目 ID，已停止生成，避免使用默认指标兜底。"); })();
    const scoreResult: ScoreSummaryResult = project.id
      ? await buildScoreSummary(project.id)
      : { text: "", snapshot: null };
    const scoreSummary = scoreResult.text;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // 报告生成必须保持短链路。项目资料索引由上传/资料库流程异步完成；
    // 如果在这里同步重建全项目索引，资料较多时 Edge Function 会被平台超时终止。
    const indexStats = { indexed: 0, skipped: 0, failed: 0 };
    let ragDossier = project.id
      ? await buildReportRagDossier(supabase, project, indicatorSummary.dimensions, extra ?? "")
      : {
        text: "",
        sectionContexts: {
          opening: "",
          evaluation: "",
          closing: "",
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
          resolvedProjectId: null,
        },
        sourceNames: [],
        systemRecordNames: [],
        sourceDocuments: [],
        sourceAliases: {},
        sourceAliasCandidates: {},
        serviceProviders: [],
      };
    let preflightVerification = verifyReportPreflight(ragDossier as any);
    if (preflightVerification.status === "blocked") {
      const retryResult = await retryUnreadableProjectMaterials(
        supabase,
        project,
        indicatorSummary.dimensions,
        extra ?? "",
        ragDossier,
      );
      ragDossier = retryResult.dossier;
      preflightVerification = retryResult.verification;
    }
    const meetingContext = project.id ? await buildProjectMeetingContext(supabase, project.id) : "";
    const sectionContexts: ReportSectionContexts = (ragDossier as any).sectionContexts ?? {
      opening: ragDossier.text,
      evaluation: ragDossier.text,
      closing: ragDossier.text,
    };
    const groundedRagText = sectionContexts.evaluation;
    const sourceNames = Array.isArray((ragDossier as any).sourceNames) ? (ragDossier as any).sourceNames : [];
    const systemRecordNames = Array.isArray((ragDossier as any).systemRecordNames)
      ? (ragDossier as any).systemRecordNames
      : [];
    const sourceDocuments = Array.isArray((ragDossier as any).sourceDocuments)
      ? (ragDossier as any).sourceDocuments
      : [];
    const sourceAliases = (ragDossier as any).sourceAliases && typeof (ragDossier as any).sourceAliases === "object"
      ? (ragDossier as any).sourceAliases as SourceAliasMap
      : {};
    const sourceAliasCandidates = (ragDossier as any).sourceAliasCandidates
      && typeof (ragDossier as any).sourceAliasCandidates === "object"
      ? (ragDossier as any).sourceAliasCandidates as SourceAliasCandidates
      : {};
    const serviceProviders = Array.isArray((ragDossier as any).serviceProviders)
      ? (ragDossier as any).serviceProviders as ServiceProviderMention[]
      : [];
    const targetFacts = Array.isArray((ragDossier as any).targetFacts)
      ? (ragDossier as any).targetFacts
      : [];
    if (preflightVerification.status === "blocked") {
      return new Response(JSON.stringify({
        error: preflightVerification.summary,
        verification: preflightVerification,
      }), {
        status: 422,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Report-Verification": preflightVerification.status,
          "X-Report-Generator-Version": REPORT_GENERATOR_VERSION,
        },
      });
    }
    const factPackText = "";
    const evidenceMatrixText = "";
    const knowledgeText = "";
    const factDigest = buildDeterministicFactDigest(groundedRagText);
    const enableAIRepair = Deno.env.get("REPORT_ENABLE_AI_REPAIR") === "1";
    const hardEvidenceSource = [
      ragDossier.text,
      (ragDossier as any).corpus,
      meetingContext,
      factDigest,
      extra,
    ].filter(Boolean).join("\n");

    const system = buildSystemPrompt(indicatorSummary.dimensions);
    const sectionPrompts = buildSectionPrompts(
      project,
      indicatorSummary.dimensions,
      indicatorSummary.text,
      knowledgeText,
      sectionContexts,
      evidenceMatrixText,
      factPackText,
      factDigest,
      scoreSummary,
      meetingContext,
      sourceNames,
      systemRecordNames,
      sourceAliases,
      sourceAliasCandidates,
      serviceProviders,
      extra ?? "",
    );

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sseVerification(preflightVerification)));
        let confirmedDraft = "";
        for (const section of sectionPrompts) {
          let completedSection = "";
          let lastError: unknown = null;

          for (let attempt = 0; attempt < 3; attempt += 1) {
            let streamedSection = "";
            const emitLiveDelta = (chunk: string) => {
              streamedSection += chunk;
              if (attempt === 0) controller.enqueue(encoder.encode(sseData(chunk)));
            };

            try {
              let text = sanitizeSection(attempt === 0
                ? await callReportSectionStream(system, section.prompt, section.maxTokens, emitLiveDelta)
                : await callReportSection(system, section.prompt, section.maxTokens, 1));

              if (section.name === "第三章") {
                text = enableAIRepair
                  ? await auditAndRepairThirdChapter(
                    text,
                    indicatorSummary.dimensions,
                    section.evidenceText,
                    factPackText,
                    factDigest,
                    evidenceMatrixText,
                    scoreSummary,
                    sourceNames,
                  )
                  : applyHardFactCorrections(
                    ensureThirdChapterSubstance(text, indicatorSummary.dimensions, scoreSummary),
                    [section.evidenceText, factDigest, evidenceMatrixText].filter(Boolean).join("\n"),
                    sourceNames,
                    serviceProviders,
                  );
              } else if (section.name === "一至二章") {
                text = enableAIRepair
                  ? await auditAndRepairEvidenceContradictions(
                    text,
                    section.name,
                    section.evidenceText,
                    factDigest,
                    sourceNames,
                  )
                  : applyHardFactCorrections(
                    text,
                    [section.evidenceText, factDigest].filter(Boolean).join("\n"),
                    sourceNames,
                    serviceProviders,
                  );
                text = ensureOpeningChaptersComplete(text, project);
              } else if (section.name === "四至六章") {
                text = ensureFinalChaptersComplete(text, indicatorSummary.dimensions);
              }

              const evidenceCorrected = applyHardFactCorrections(
                text,
                hardEvidenceSource,
                sourceNames,
                serviceProviders,
              );
              const targetCorrected = reconcileAuthoritativeTargetNarrative(
                evidenceCorrected,
                targetFacts,
              );
              const qualityCorrected = applyReportQualityCorrections(
                targetCorrected,
                hardEvidenceSource,
                sourceNames,
                sourceDocuments,
              );
              const sanitizedSection = sanitizeFinalReportText(
                section.name === "第三章"
                  ? reconcileAuthoritativeScoreNarrative(qualityCorrected, scoreResult.snapshot)
                  : qualityCorrected,
                sourceNames,
                sourceAliases,
                sourceAliasCandidates,
              );
              const candidateSection = cleanReportLanguage(
                section.name === "一至二章"
                  ? ensureAllSourcesAcknowledged(sanitizedSection, sourceNames)
                  : sanitizedSection,
              );
              if (containsCorruptedReportText(candidateSection)) {
                console.warn(
                  "report quality gate rejected unreadable lines",
                  corruptedReportLines(candidateSection).slice(0, 3),
                );
                throw new Error("生成内容包含无法阅读的识别文本");
              }
              if (containsGeneratedReportCitation(candidateSection)) {
                console.warn("report quality gate rejected generated-report citation");
                throw new Error("生成内容错误引用了历史生成报告");
              }
              completedSection = candidateSection;
              break;
            } catch (error) {
              lastError = error;
              console.error(`generate-report section failed: ${section.name}, attempt ${attempt + 1}`, error);
              if (attempt === 0 && streamedSection.trim()) {
                controller.enqueue(encoder.encode(sseReplace(confirmedDraft)));
              }
              if (attempt < 2) await sleep(1200 * (attempt + 1));
            }
          }

          if (!completedSection.trim()) {
            const message = lastError instanceof Error ? lastError.message : `报告${section.name}未能完整生成`;
            controller.enqueue(encoder.encode(sseError(`${section.name}生成未完成：${message}`)));
            controller.close();
            return;
          }

          confirmedDraft = `${confirmedDraft}${completedSection.trim()}\n\n`;
          controller.enqueue(encoder.encode(sseReplace(confirmedDraft)));
        }
        const finalVerification = verifyFinalReport(confirmedDraft, ragDossier as any);
        controller.enqueue(encoder.encode(sseVerification(finalVerification)));
        if (finalVerification.status === "blocked") {
          controller.enqueue(encoder.encode(sseError(finalVerification.summary)));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Score-Injected": scoreSummary ? "1" : "0",
        "X-Rag-Materials": String(ragDossier.stats.files),
        "X-Rag-Knowledge": "0",
        "X-Rag-Overview": String(ragDossier.stats.files),
        "X-Rag-Priority-Chunks": String(ragDossier.stats.chunks),
        "X-Rag-Report-Evidence": String(ragDossier.stats.dimensionEvidence),
        "X-Rag-Grounded-Files": String(ragDossier.stats.files),
        "X-Rag-Indexed-Files": String(ragDossier.stats.indexedFiles),
        "X-Rag-Unindexed-Files": String(ragDossier.stats.unindexedFiles),
        "X-Rag-Grounded-Chunks": String(ragDossier.stats.chunks),
        "X-Rag-Grounded-Facts": String(ragDossier.stats.factSignals),
        "X-Rag-Grounded-Evidence": String(ragDossier.stats.dimensionEvidence),
        "X-Rag-Fact-Areas": String(ragDossier.stats.conflicts),
        "X-Rag-Fact-Evidence": String(ragDossier.stats.factSignals),
        "X-Rag-History": "0",
        "X-Rag-Goals": "0",
        "X-Rag-Indexed": String(indexStats.indexed),
        "X-Rag-Index-Failed": String(indexStats.failed),
        "X-Report-Generator-Version": REPORT_GENERATOR_VERSION,
        "X-Report-Service-Providers": String(serviceProviders.length),
        "X-Report-Target-Facts": String(targetFacts.length),
        "X-Report-Verification": preflightVerification.status,
      },
    });
  } catch (e) {
    console.error("generate-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

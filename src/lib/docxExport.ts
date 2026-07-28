// 标准 Word 模板导出工具：专家意见书 / 评估报告 / 工作方案
// 对应交流稿附件 8-1、10-1、3
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageOrientation,
  Header, Footer,
  HeadingLevel, PageBreak, LeaderType, TabStopPosition, TabStopType,
} from "docx";
import { renderTemplate } from "./templates";
import { richTextToPlainText } from "./richText";
import { extractReportTocEntries } from "./reportToc";
import { stripDeprecatedReportMethodSections } from "../../supabase/functions/_shared/reportTemplate";

// LibreOffice 转 PDF 时必须明确写入 eastAsia 字体，否则中文容易被替换成方框。
// 服务器需安装 fonts-noto-cjk；Word 本身若本机没有该字体也会自动兜底显示。
const FONT_NAME = "Noto Sans CJK SC";
const FONT = { ascii: FONT_NAME, hAnsi: FONT_NAME, eastAsia: FONT_NAME, cs: FONT_NAME } as const;
const HEADING_FONT = FONT;
const cleanMarkdown = (value: string) =>
  String(value ?? "")
    .replace(/```[\w-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .trim();

// 文字水印：页眉中央灰色斜体文字，每页都有，便于追溯外发
// wmText 由调用方传入（已通过 watermark.text 模板渲染过）
const buildWatermark = (wmText?: string): { headers: { default: Header }; footers: { default: Footer } } => {
  const text = wmText ?? `${new Date().toLocaleDateString("zh-CN")} · 内部评审使用`;
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text, font: FONT, size: 18, color: "BBBBBB", italics: true })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `— ${text} —`, font: FONT, size: 16, color: "CCCCCC" })],
          }),
        ],
      }),
    },
  };
};

const T = (text: string, opts: Partial<{ bold: boolean; size: number; color: string }> = {}) =>
  new TextRun({
    text: cleanMarkdown(text),
    font: FONT,
    bold: opts.bold,
    size: opts.size ?? 24,
    color: opts.color ?? "000000",
  });

const P = (text: string, opts: Partial<{ align: (typeof AlignmentType)[keyof typeof AlignmentType]; bold: boolean; size: number; spacing: number; indent: boolean }> = {}) =>
  new Paragraph({
    alignment: opts.align,
    spacing: { line: 360, after: opts.spacing ?? 120 },
    indent: opts.indent ? { firstLine: 480 } : undefined,
    children: [T(text, { bold: opts.bold, size: opts.size })],
  });

const H1 = (text: string) => new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 240, after: 240 },
  children: [
    new TextRun({
      text: cleanMarkdown(text),
      font: HEADING_FONT,
      bold: true,
      size: 36,
      color: "000000",
    }),
  ],
});

const H2 = (text: string) => new Paragraph({
  spacing: { before: 200, after: 120 },
  children: [T(text, { bold: true, size: 28 })],
});

const td = (text: string, bold = false, width = 20) => new TableCell({
  width: { size: width, type: WidthType.PERCENTAGE },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [T(text, { bold, size: 22 })] })],
});

const tableRow = (cells: { text: string; bold?: boolean; width?: number }[]) =>
  new TableRow({ children: cells.map(c => td(c.text, c.bold, c.width)) });

const standardTable = (rows: TableRow[]) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  },
  rows,
});

const toDocBlob = async (doc: Document) => Packer.toBlob(doc);

const downloadBlob = async (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const downloadDoc = async (doc: Document, filename: string) => {
  const blob = await toDocBlob(doc);
  await downloadBlob(blob, filename);
};

const NONE_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const COVER_VALUE_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000" },
};

const coverLabelCell = (text: string) => new TableCell({
  width: { size: 22, type: WidthType.PERCENTAGE },
  borders: NONE_BORDER,
  margins: { top: 90, bottom: 90, left: 60, right: 90 },
  children: [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text, font: HEADING_FONT, bold: true, size: 26 })],
    }),
  ],
});

const coverValueCell = (text: string) => new TableCell({
  width: { size: 78, type: WidthType.PERCENTAGE },
  borders: COVER_VALUE_BORDER,
  margins: { top: 90, bottom: 60, left: 90, right: 90 },
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: cleanMarkdown(text), font: HEADING_FONT, bold: true, size: 24 })],
    }),
  ],
});

const coverDateValueCell = (year: string, month: string, day: string) => new TableCell({
  width: { size: 78, type: WidthType.PERCENTAGE },
  borders: NONE_BORDER,
  margins: { top: 90, bottom: 60, left: 60, right: 60 },
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: year, font: HEADING_FONT, bold: true, size: 24, underline: {} }),
        new TextRun({ text: "  年  ", font: HEADING_FONT, bold: true, size: 24 }),
        new TextRun({ text: month, font: HEADING_FONT, bold: true, size: 24, underline: {} }),
        new TextRun({ text: "  月  ", font: HEADING_FONT, bold: true, size: 24 }),
        new TextRun({ text: day, font: HEADING_FONT, bold: true, size: 24, underline: {} }),
        new TextRun({ text: "  日", font: HEADING_FONT, bold: true, size: 24 }),
      ],
    }),
  ],
});

const coverRow = (label: string, value: string) => new TableRow({
  children: [coverLabelCell(`${label}：`), coverValueCell(value)],
});

const stripAppendedReportSkeletonFromPlainText = (value: string) => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const appendix = text.search(/六、附件[\s\S]*?(?:4[.．、]\s*专家组及工作组情况表|4\s*专家组及工作组情况表)/);
  if (appendix < 0) return text;

  const appendixText = text.slice(appendix);
  const marker = appendixText.search(/\n\s*(?:一、评估对象|项目名称：\s*$|项目单位：\s*$|主管部门：\s*$|项目属性：\s*$)/m);
  if (marker < 0) return text;

  return `${text.slice(0, appendix)}${appendixText.slice(0, marker)}`.trim();
};

const stripDuplicateOpeningBeforeThirdChapter = (value: string) => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const third = text.indexOf("三、评估内容与结论");
  if (third < 0) return text;
  const firstOpening = text.indexOf("一、评估对象");
  if (firstOpening < 0 || firstOpening >= third) return text;
  const secondOpening = text.indexOf("一、评估对象", firstOpening + "一、评估对象".length);
  if (secondOpening < 0 || secondOpening >= third) return text;
  return `${text.slice(0, secondOpening).trim()}\n\n${text.slice(third).trim()}`.trim();
};

const headingIndex = (text: string, heading: string) => {
  const direct = text.indexOf(heading);
  if (direct >= 0) return direct;
  const loose = new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"));
  return loose.exec(text)?.index ?? -1;
};

const stripGenericSuggestionTail = (value: string) => {
  const text = String(value ?? "").trim();
  if (!text) return text;
  const four = headingIndex(text, "四、相关建议");
  const five = headingIndex(text, "五、其他需要说明的问题");
  if (four < 0 || five < 0 || five <= four) return text;
  const before = text.slice(0, four);
  const suggestions = text.slice(four, five);
  const after = text.slice(five);
  const genericStart = suggestions.search(/\n\s*1[.．、]\s*针对(?:立项必要性|项目必要性|投入经济性|项目经济性|绩效目标合理性|实施方案可行性|项目可行性|筹资合规性|可持续性|项目效益性)/);
  if (genericStart < 0) return text;
  const formalPart = suggestions.slice(0, genericStart).trim();
  const formalCount = (formalPart.match(/^\s*（[一二三四五六七八九十]+）/gm) ?? []).length;
  if (formalCount < 2) return text;
  return `${before}${formalPart}\n\n${after}`.trim();
};

const stripReportInternalTerms = (value: string) =>
  String(value ?? "")
    .replace(/五维论证逻辑/g, "六维论证逻辑")
    .replace(/DA\/T\s*31-2017\s*与\s*DA\/T\s*31-2017/g, "DA/T 31-2017")
    .replace(/现有生成内容未完整覆盖该部分[，,、]?\s*请结合\s*RAG\s*V2\s*项目证据档案补充完善。?/g, "")
    .replace(/现有生成内容未完整覆盖该部分。?/g, "")
    .replace(/请结合\s*(?:RAG\s*V2\s*)?项目证据档案补充完善。?/g, "")
    .replace(/RAG\s*V2\s*项目证据档案|Grounded\s*RAG\s*证据账本|当前项目证据矩阵/g, "项目资料依据")
    .replace(/资料库\/文件库|文件库|资料库/g, "项目资料")
    .replace(/(?:现有|当前)?(?:正文|资料)?索引(?:未检出|未读取)?(?:，?需人工核对或重新索引)?/g, "根据现有资料暂未见明确依据")
    .replace(/未建索引|索引文件|索引片段|切片|OCR|RAG/g, "资料")
    .replace(/需人工核对或重新索引|重新索引/g, "需补充资料来源并复核")
    .replace(/共查阅项目资料中的资料\s*(\d+)\s*份[，,]\s*资料\s*\d+\s*份[，,]\s*资料\s*\d+\s*份。?/g, "共查阅项目单位提供的相关资料$1份，重点核验项目申报、预算测算、绩效目标、实施方案及专家意见等材料。")
    .replace(/共查阅项目资料中的资料\s*(\d+)\s*份。?/g, "共查阅项目单位提供的相关资料$1份。")
    .trim();

const splitStuckSubheadings = (value: string) =>
  String(value ?? "")
    .replace(/(^|\n)(\s*[1-4][.．、]\s*(?:事实依据|发现的问题|分析判断|综上结论)[：:]?)(?=\S)/g, "$1$2\n")
    .replace(/(^|\n)(\s*（\d+）\s*[^。\n]{2,24}指标)(?=\S)/g, "$1$2\n");

const normalizeAppendixList = (value: string) => {
  const text = String(value ?? "").trim();
  const six = headingIndex(text, "六、附件");
  if (six < 0) return text;

  const before = text.slice(0, six).trim();
  const appendix = [
    "六、附件",
    "（一）事前绩效评估项目预期绩效报告",
    "（二）绩效目标申报表",
    "（三）事前绩效评估专家评估意见书",
    "（四）专家组及工作组情况表",
  ].join("\n");
  return `${before}\n\n${appendix}`.trim();
};

export const normalizeEvaluationReportTextForExport = (value: string) =>
  normalizeAppendixList(stripDeprecatedReportMethodSections(splitStuckSubheadings(stripGenericSuggestionTail(stripReportInternalTerms(stripDuplicateOpeningBeforeThirdChapter(stripAppendedReportSkeletonFromPlainText(
    richTextToPlainText(String(value ?? ""))
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )))))));

const isConciseHeadingText = (line: string, prefixPattern: RegExp) => {
  const text = cleanMarkdown(String(line ?? "").trim());
  const body = text.replace(prefixPattern, "").trim();
  return body.length > 0 && body.length <= 28 && !/[。；;，,：:]/.test(body);
};

const reportParagraphsFromText = (value: string) => {
  const lines = normalizeEvaluationReportTextForExport(value).split("\n");
  return lines.flatMap((raw) => {
    const line = raw.trim();
    if (!line) return [new Paragraph({ spacing: { after: 80 } })];
    if (/^[一二三四五六七八九十]+、/.test(line) && isConciseHeadingText(line, /^[一二三四五六七八九十]+、/)) {
      return [new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 160 },
        children: [new TextRun({ text: line, font: HEADING_FONT, bold: true, size: 28 })],
      })];
    }
    if (/^（[一二三四五六七八九十]+）/.test(line) && isConciseHeadingText(line, /^（[一二三四五六七八九十]+）/)) {
      return [new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 120 },
        children: [new TextRun({ text: line, font: FONT, bold: true, size: 26 })],
      })];
    }
    if (/^\d+\./.test(line) && isConciseHeadingText(line, /^\d+\./)) {
      return [new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 120, after: 80 },
        children: [new TextRun({ text: line, font: FONT, bold: true, size: 24 })],
      })];
    }
    if (/^（\d+）/.test(line) && isConciseHeadingText(line, /^（\d+）/)) {
      return [new Paragraph({
        heading: HeadingLevel.HEADING_4,
        spacing: { before: 80, after: 60 },
        children: [new TextRun({ text: line, font: FONT, bold: true, size: 24 })],
      })];
    }
    return [P(line, { indent: true })];
  });
};

const tocParagraphWithPage = (text: string, level: 1 | 2, page: number) => new Paragraph({
  spacing: { after: 120 },
  indent: level === 2 ? { left: 420 } : undefined,
  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }],
  children: [
    new TextRun({
      text,
      font: level === 1 ? HEADING_FONT : FONT,
      bold: level === 1,
      size: level === 1 ? 26 : 24,
    }),
    new TextRun({ text: "\t", font: FONT, size: 24 }),
    new TextRun({ text: String(page), font: FONT, size: 24 }),
  ],
});

const estimateReportTocPages = (entries: ReturnType<typeof extractReportTocEntries>) => {
  let currentPage = 3; // 封面、目录后正文从第 3 页开始
  return entries.map((entry, index) => {
    if (entry.level === 1 && index > 0) currentPage += 1;
    return { ...entry, page: currentPage };
  });
};

// =========== 1. 专家意见书（附件 8-1 / 8-2） ===========
export interface ExpertOpinionData {
  projectName: string;
  unit: string;
  budget: number;
  expertName: string;
  expertOrg?: string;
  expertTitle?: string;
  scoreRows: { indicator: string; maxScore: number; score: number; deductReason?: string }[];
  totalScore: number;
  maxTotal: number;
  conclusion?: string;
  comments?: string;
  date?: string;
  kind?: "project" | "policy"; // 项目类用附 8-1，政策类用 8-2
  watermark?: string; // 水印文字（默认: 当前用户邮箱+日期）
}

export const exportExpertOpinion = async (d: ExpertOpinionData) => {
  const isPolicy = d.kind === "policy";
  const today = d.date ?? new Date().toLocaleDateString("zh-CN");
  const defaultHead = `${isPolicy ? "政策" : "项目"}事前绩效评估专家意见书`;
  const head = await renderTemplate("opinion.title", { project_name: d.projectName }, defaultHead);
  const footer = await renderTemplate("opinion.footer", { date: today }, `专家签名：____________   日期：${today}`);
  const wm = d.watermark ?? await renderTemplate("watermark.text", { date: today }, `${today} · 内部评审使用`);
  const code = isPolicy ? "附件 8-2" : "附件 8-1";

  const scoreRows: TableRow[] = [
    tableRow([
      { text: "评估指标", bold: true, width: 50 },
      { text: "分值", bold: true, width: 10 },
      { text: "得分", bold: true, width: 10 },
      { text: "扣分理由", bold: true, width: 30 },
    ]),
    ...d.scoreRows.map(r => tableRow([
      { text: r.indicator, width: 50 },
      { text: r.maxScore.toString(), width: 10 },
      { text: r.score.toString(), width: 10 },
      { text: r.deductReason ?? "—", width: 30 },
    ])),
    tableRow([
      { text: "合计", bold: true, width: 50 },
      { text: d.maxTotal.toString(), bold: true, width: 10 },
      { text: d.totalScore.toString(), bold: true, width: 10 },
      { text: "", width: 30 },
    ]),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: {},
      ...buildWatermark(wm),
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(code, { size: 20 })] }),
        H1(head),
        standardTable([
          tableRow([{ text: `${isPolicy ? "政策" : "项目"}名称`, bold: true, width: 18 }, { text: d.projectName, width: 32 }, { text: `${isPolicy ? "实施" : "申请"}单位`, bold: true, width: 18 }, { text: d.unit, width: 32 }]),
          tableRow([{ text: "预算金额", bold: true, width: 18 }, { text: `${(d.budget / 10000).toFixed(2)} 万元`, width: 32 }, { text: "评估专家", bold: true, width: 18 }, { text: `${d.expertName}${d.expertOrg ? `（${d.expertOrg}）` : ""}${d.expertTitle ? ` · ${d.expertTitle}` : ""}`, width: 32 }]),
        ]),
        new Paragraph({ children: [T("")] }),
        H2("一、评分情况"),
        standardTable(scoreRows),
        new Paragraph({ children: [T("")] }),
        H2("二、评估结论"),
        P(d.conclusion, { indent: true }),
        H2("三、专家意见与建议"),
        ...(d.comments ? d.comments.split(/\n+/).map(l => P(l, { indent: true })) : [P("（无）", { indent: true })]),
        new Paragraph({ children: [T("")] }),
        new Paragraph({ children: [T("")] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(footer)] }),
      ],
    }],
  });

  await downloadDoc(doc, `${d.projectName}-${d.expertName}-专家评估意见书.docx`);
};

// =========== 1B. 专家组汇总意见书 ===========
export interface GroupOpinionData {
  projectName: string;
  unit: string;
  budget: number;
  category?: string;
  expertNames: string[];
  summaryRows: { indicator: string; maxScore: number; expertScores: number[]; avgScore: number }[];
  totalPerExpert: number[];
  totalAvg: number;
  maxTotal: number;
  conclusion: string;
  groupComments?: string;
  groupLeader?: string;
  supervisingDepartment?: string;
  evaluator?: string;
  thirdPartyOrg?: string;
  date?: string;
  watermark?: string;
}

const GROUP_DIMENSIONS = ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"] as const;

const parseGroupOpinion = (source?: string) => {
  const sections = new Map<string, string[]>();
  let current = "";
  const unclassified: string[] = [];
  (source ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const dimension = GROUP_DIMENSIONS.find((name) =>
      new RegExp(`^(?:[1-5][.、]|[一二三四五][、.]|（[一二三四五]）)?\\s*${name}[：:]?$`).test(line),
    );
    if (dimension) {
      current = dimension;
      if (!sections.has(current)) sections.set(current, []);
      return;
    }
    if (/^总体意见[：:]?$/.test(line)) {
      current = "总体意见";
      if (!sections.has(current)) sections.set(current, []);
      return;
    }
    if (/^(其他问题和建议|问题和建议)[：:]?$/.test(line)) {
      current = "其他问题和建议";
      if (!sections.has(current)) sections.set(current, []);
      return;
    }
    if (current) sections.get(current)!.push(line);
    else unclassified.push(line);
  });
  if (!sections.get("总体意见")?.length && unclassified.length) {
    sections.set("总体意见", unclassified);
  }
  const fallback = "根据现有会议纪要、专家意见和评分资料，尚未形成该维度的明确分项意见，需由专家组补充确认。";
  return {
    dimensions: GROUP_DIMENSIONS.map((name) => ({
      name,
      paragraphs: sections.get(name)?.length ? sections.get(name)! : [fallback],
    })),
    overall: sections.get("总体意见")?.length
      ? sections.get("总体意见")!
      : [`专家组平均得分为 ${dNumberPlaceholder}，综合评估结论为待确认。`],
    suggestions: sections.get("其他问题和建议")?.length
      ? sections.get("其他问题和建议")!
      : ["请项目单位针对各维度发现的问题逐项完善政策依据、实施方案、预算测算、绩效指标和风险控制措施。"],
  };
};

const dNumberPlaceholder = "__TOTAL_SCORE__";

export const exportGroupOpinion = async (d: GroupOpinionData) => {
  const today = d.date ?? new Date().toLocaleDateString("zh-CN");
  const head = await renderTemplate("group_opinion.title", { project_name: d.projectName }, "财政支出项目事前绩效评估专家组评估意见");
  const footer = await renderTemplate(
    "group_opinion.footer",
    { date: today, group_leader: d.groupLeader ?? "" },
    `专家组组长签字：${d.groupLeader ?? "__________________"}   日期：${today}`,
  );
  const wm = d.watermark ?? await renderTemplate("watermark.text", { date: today }, `${today} · 内部评审使用`);
  const structuredOpinion = parseGroupOpinion(d.groupComments);
  const overall = structuredOpinion.overall.map((line) =>
    line.replace(dNumberPlaceholder, `${d.totalAvg.toFixed(2)} 分`),
  );
  const expertWidth = Math.max(6, Math.floor(52 / Math.max(d.expertNames.length, 1)));
  const rows: TableRow[] = [
    tableRow([
      { text: "评估指标", bold: true, width: 30 },
      { text: "分值", bold: true, width: 8 },
      ...d.expertNames.map((_, index) => ({ text: `专家${index + 1}`, bold: true, width: expertWidth })),
      { text: "平均分", bold: true, width: 10 },
    ]),
    ...d.summaryRows.map((row) => tableRow([
      { text: row.indicator, width: 30 },
      { text: row.maxScore.toFixed(2).replace(/\.00$/, ""), width: 8 },
      ...row.expertScores.map((score) => ({ text: score.toFixed(2).replace(/\.00$/, ""), width: expertWidth })),
      { text: row.avgScore.toFixed(2), width: 10 },
    ])),
    tableRow([
      { text: "合计", bold: true, width: 30 },
      { text: d.maxTotal.toFixed(2).replace(/\.00$/, ""), bold: true, width: 8 },
      ...d.totalPerExpert.map((score) => ({ text: score.toFixed(2).replace(/\.00$/, ""), bold: true, width: expertWidth })),
      { text: d.totalAvg.toFixed(2), bold: true, width: 10 },
    ]),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: {
        page: { size: { orientation: PageOrientation.LANDSCAPE } },
      },
      ...buildWatermark(wm),
      children: [
        H1(head),
        standardTable([
          tableRow([{ text: "项目名称", bold: true, width: 18 }, { text: d.projectName, width: 32 }, { text: "申请单位", bold: true, width: 18 }, { text: d.unit, width: 32 }]),
          tableRow([{ text: "主管部门", bold: true, width: 18 }, { text: d.supervisingDepartment ?? d.unit, width: 32 }, { text: "预算金额", bold: true, width: 18 }, { text: `${(d.budget / 10000).toFixed(2)} 万元`, width: 32 }]),
          tableRow([{ text: "评估机构", bold: true, width: 18 }, { text: d.evaluator ?? "—", width: 32 }, { text: "第三方机构", bold: true, width: 18 }, { text: d.thirdPartyOrg ?? "—", width: 32 }]),
          tableRow([{ text: "项目类别", bold: true, width: 18 }, { text: d.category ?? "—", width: 32 }, { text: "评估结论", bold: true, width: 18 }, { text: d.conclusion, width: 32 }]),
        ]),
        new Paragraph({ children: [T("")] }),
        H2("一、专家组评估计分"),
        standardTable(rows),
        new Paragraph({ children: [T("")] }),
        H2("二、评估得分与结论"),
        P(`评估得分：${d.totalAvg.toFixed(2)} 分`, { bold: true }),
        P(`评估结论：${d.conclusion}`, { bold: true }),
        H2("三、分项意见"),
        ...structuredOpinion.dimensions.flatMap((section, index) => [
          P(`${index + 1}.${section.name}`, { bold: true }),
          ...section.paragraphs.map((line) => P(line, { indent: true })),
        ]),
        H2("四、总体意见"),
        ...overall.map((line) => P(line, { indent: true })),
        H2("五、其他问题和建议"),
        ...structuredOpinion.suggestions.map((line) => P(line, { indent: true })),
        new Paragraph({ children: [T("")] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(footer)] }),
      ],
    }],
  });

  await downloadDoc(doc, `${d.projectName}-专家组评估意见书.docx`);
};

// =========== 2. 评估报告（附件 10-1） ===========
export interface ReportData {
  projectName: string;
  unit: string;
  budget: number;
  category?: string;
  supervisingDepartment?: string;
  evaluator?: string; // 评估机构
  thirdPartyOrg?: string;
  reportContent: string; // markdown / 纯文本
  redlineTemplateName?: string;
  redlineTemplateContent?: string | null;
  conclusion: string;
  unsupportedBudget?: number;
  supportedBudget?: number;
  summaryRemark?: string;
  totalScore?: number;
  maxScore?: number;
  date?: string;
  watermark?: string;
}

const extractRedlineCoverTitle = (templateName?: string, templateContent?: string | null) => {
  const titleFromContent = String(templateContent ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line && !/^目录$/.test(line) && !/^封面$/.test(line) && /(报告|意见书|工作方案)/.test(line));
  return titleFromContent || "财政支出项目事前绩效评估报告";
};

const extractAttachmentLabel = (templateName?: string) => {
  const match = String(templateName ?? "").match(/附件\s*\d+(?:-\d+)?/);
  return match?.[0] ?? "附件 10-1";
};

export const createEvaluationReportBlob = async (d: ReportData) => {
  const today = d.date ?? new Date().toLocaleDateString("zh-CN");
  const footer = await renderTemplate("report.footer", { date: today }, `评估机构（盖章）：__________________   日期：${today}`);
  const wm = d.watermark ?? await renderTemplate("watermark.text", { date: today }, `${today} · 内部评审使用`);
  const coverTitle = extractRedlineCoverTitle(d.redlineTemplateName, d.redlineTemplateContent);
  const attachmentLabel = extractAttachmentLabel(d.redlineTemplateName);
  const [year = "", monthRaw = "", dayRaw = ""] = today.replace(/[./]/g, "-").split("-");
  const month = monthRaw.replace(/^0/, "");
  const day = dayRaw.replace(/^0/, "");
  const coverRows = [
    { label: "项目名称", value: d.projectName?.trim() },
    { label: "项目单位", value: d.unit?.trim() },
    { label: "主管部门", value: d.supervisingDepartment?.trim() },
    { label: "评估机构", value: d.evaluator?.trim() },
    { label: "第三方机构", value: d.thirdPartyOrg?.trim() },
  ].filter((row) => row.value);
  const normalizedReportContent = normalizeEvaluationReportTextForExport(d.reportContent);
  const bodyParagraphs = reportParagraphsFromText(normalizedReportContent);
  const tocEntries = extractReportTocEntries(normalizedReportContent);
  const estimatedTocEntries = estimateReportTocPages(tocEntries);

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } },
      ...buildWatermark(wm),
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(attachmentLabel, { size: 20 })] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 1800, after: 180 },
          children: [new TextRun({ text: coverTitle, font: HEADING_FONT, bold: true, size: 36 })],
        }),
        new Paragraph({ spacing: { after: 3000 } }),
        new Table({
          width: { size: 86, type: WidthType.PERCENTAGE },
          alignment: AlignmentType.CENTER,
          borders: NONE_BORDER,
          rows: [
            ...coverRows.map((row) => coverRow(row.label, row.value!)),
            new TableRow({
              children: [
                coverLabelCell("评估时间："),
                coverDateValueCell(year, month, day),
              ],
            }),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 260 },
          children: [new TextRun({ text: "目 录", font: HEADING_FONT, bold: true, size: 32 })],
        }),
        ...(estimatedTocEntries.length
          ? estimatedTocEntries.map((item) => tocParagraphWithPage(item.text, item.level, item.page))
          : [new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [new TextRun({ text: "正文尚未识别到章节标题", font: FONT, size: 22, color: "666666" })],
            })]),
        new Paragraph({ children: [new PageBreak()] }),
        ...bodyParagraphs,
        new Paragraph({ children: [T("")] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(footer)] }),
      ],
    }],
  });

  return toDocBlob(doc);
};

export const exportEvaluationReport = async (d: ReportData) => {
  const blob = await createEvaluationReportBlob(d);
  await downloadBlob(blob, `${d.projectName}-事前绩效评估报告.docx`);
};

// =========== 3. 工作方案（附件 3） ===========
export interface WorkPlanData {
  projectName: string;
  unit: string;
  groupName: string;
  leader: string;
  members: { name: string; role: string; org?: string; contact?: string }[];
  tasks: { title: string; assignee?: string; start: string; end: string; status: string; notes?: string }[];
  planContent?: string; // 已有 evaluation_plans.content 可注入
  date?: string;
  watermark?: string;
}

const STATUS_CN: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成", blocked: "阻塞" };

export const exportWorkPlan = async (d: WorkPlanData) => {
  const today = d.date ?? new Date().toLocaleDateString("zh-CN");
  const head = await renderTemplate("plan.title", { project_name: d.projectName }, "事前绩效评估工作方案");
  const wm = d.watermark ?? await renderTemplate("watermark.text", { date: today }, `${today} · 内部评审使用`);
  const memberRows: TableRow[] = [
    tableRow([
      { text: "姓名", bold: true, width: 20 },
      { text: "角色", bold: true, width: 20 },
      { text: "所在单位", bold: true, width: 35 },
      { text: "联系方式", bold: true, width: 25 },
    ]),
    ...d.members.map(m => tableRow([
      { text: m.name, width: 20 },
      { text: m.role, width: 20 },
      { text: m.org ?? "—", width: 35 },
      { text: m.contact?.trim() || "—", width: 25 },
    ])),
  ];

  const taskRows: TableRow[] = [
    tableRow([
      { text: "任务", bold: true, width: 36 },
      { text: "负责人", bold: true, width: 14 },
      { text: "起", bold: true, width: 14 },
      { text: "止", bold: true, width: 14 },
      { text: "状态", bold: true, width: 10 },
      { text: "备注", bold: true, width: 12 },
    ]),
    ...d.tasks.map(t => tableRow([
      { text: t.title, width: 36 },
      { text: t.assignee ?? "—", width: 14 },
      { text: t.start, width: 14 },
      { text: t.end, width: 14 },
      { text: STATUS_CN[t.status] ?? t.status, width: 10 },
      { text: t.notes ?? "—", width: 12 },
    ])),
  ];

  const planParas = d.planContent
    ? d.planContent.split(/\n+/).filter(Boolean).map(l => {
        if (/^[一二三四五六七八九十]+、/.test(l.trim())) return H2(l.trim());
        return P(l.replace(/^#+\s*/, "").replace(/\*\*/g, ""), { indent: true });
      })
    : [P("（暂无方案正文，可在『评估方案』页生成后再次导出）", { indent: true })];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } },
      ...buildWatermark(wm),
      children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T("附件 3", { size: 20 })] }),
        H1(head),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [T(`—— ${d.projectName} ——`, { bold: true, size: 28 })] }),
        new Paragraph({ children: [T("")] }),
        P(`一、项目基本情况`, { bold: true }),
        P(`项目名称：${d.projectName}`, { indent: true }),
        P(`申请单位：${d.unit}`, { indent: true }),
        new Paragraph({ children: [T("")] }),
        P(`二、评估工作小组`, { bold: true }),
        P(`小组名称：${d.groupName}`, { indent: true }),
        P(`组长：${d.leader || "—"}`, { indent: true }),
        new Paragraph({ children: [T("")] }),
        standardTable(memberRows),
        new Paragraph({ children: [T("")] }),
        P(`三、工作计划与任务分工`, { bold: true }),
        standardTable(taskRows),
        new Paragraph({ children: [T("")] }),
        P(`四、评估方案要点`, { bold: true }),
        ...planParas,
        new Paragraph({ children: [T("")] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(`编制（盖章）：__________________`)] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [T(`日期：${today}`)] }),
      ],
    }],
  });

  await downloadDoc(doc, `${d.projectName}-工作方案.docx`);
};

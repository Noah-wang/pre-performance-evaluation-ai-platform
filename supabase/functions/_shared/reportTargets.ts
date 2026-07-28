export interface TargetEvidenceRow {
  text: string;
  sourceName: string;
  location?: string | null;
  sourceType?: string | null;
}

export interface TargetEvidenceDocument {
  sourceName: string;
  text: string;
  sourceType?: string | null;
}

export type TargetComparison = "≥" | "≤" | ">" | "<" | "=" | "超" | "";

export interface AuthoritativeTargetFact {
  name: string;
  comparison: TargetComparison;
  value: string;
  unit: string;
  displayValue: string;
  sourceName: string;
  location: string;
  excerpt: string;
  category: "quantity" | "quality" | "progress" | "cost" | "economic" | "social" | "environment" | "sustainable" | "satisfaction" | "other";
  priority: number;
}

const normalizeSpace = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeComparison = (value: string): TargetComparison => {
  const normalized = value.replace(/\s+/g, "");
  if (/^(?:≥|>=|不低于|不少于|至少)$/.test(normalized)) return "≥";
  if (/^(?:≤|<=|不高于|不超过|至多)$/.test(normalized)) return "≤";
  if (/^(?:>|＞)$/.test(normalized)) return ">";
  if (/^(?:<|＜)$/.test(normalized)) return "<";
  if (/^(?:超|超过)$/.test(normalized)) return "超";
  if (/^(?:=|达到|达)$/.test(normalized)) return "=";
  return "";
};

const normalizeUnit = (value: string) => value
  .replace(/％/g, "%")
  .replace(/／/g, "/")
  .replace(/\s+/g, "");

// 指标名称的结尾词，按长的排在前面，避免“制定次数”被“次数”截断。
const METRIC_NAME_ENDING =
  /(?:制定次数|满意度|响应率|满足率|控制率|运行率|达标率|完好率|准确率|合格率|成功率|投诉率|覆盖率|完成率|增长率|次数|比例|占比)/g;

const cleanTargetName = (value: string) => {
  let name = normalizeSpace(value)
    .replace(/[“”"'《》【】()[\]（）]/g, "")
    .replace(/^[\d一二三四五六七八九十]+[.、．)\s-]*/g, "")
    .replace(/^(?:申报表原文|报告原文|资料原文|原文|指标名称|目标名称|绩效目标|具体指标|指标值|目标值)[：:\s]*/g, "")
    // 表格里的指标类别单元格常和指标名连在一起（“效益指标社保业务档案支撑政策制定
    // 次数”），不剥离就会和干净的同名指标重复进入锁定表。
    .replace(
      /^(?:产出指标|投入指标|效果指标|效益指标|数量指标|质量指标|进度指标|成本指标|时效指标|经济效益指标|社会效益指标|生态效益指标|环境效益指标|可持续影响指标|服务对象满意度指标|满意度指标)[：:\s-]*/g,
      "",
    )
    // “确保档案完好率”“实现调阅准确率”这类动词开头的写法同理。
    .replace(/^(?:确保|保证|实现|达到|力争|做到|完成|保持)[：:\s-]*/g, "")
    .replace(/(?:目标值|指标值)$/g, "")
    .replace(/[：:，,；;。]+$/g, "")
    .trim();

  const lastDelimiter = Math.max(
    name.lastIndexOf("。"),
    name.lastIndexOf("；"),
    name.lastIndexOf("，"),
    name.lastIndexOf("、"),
    name.lastIndexOf("："),
    name.lastIndexOf(":"),
  );
  if (lastDelimiter >= 0) name = name.slice(lastDelimiter + 1).trim();
  if (name.includes(" ")) {
    const parts = name.split(/\s+/).filter(Boolean);
    name = parts[parts.length - 1] ?? name;
  }

  // 扫描件 OCR 常把相邻单元格并成一格，得到“…初步响应的比例业务科室档案调取需求
  // 满足率”这种两个指标粘连的名称。下面按长度截断的规则救不回来（贪婪匹配会吞掉
  // 整串），只能按指标名结尾切分：末尾正好是一个完整指标名、且前面还存在另一个
  // 指标名结尾时，只保留末尾那个——数值紧跟其后，属于末尾这个指标。
  const boundaries = Array.from(name.matchAll(METRIC_NAME_ENDING));
  if (boundaries.length > 1) {
    const last = boundaries[boundaries.length - 1];
    const previous = boundaries[boundaries.length - 2];
    const lastEnd = (last.index ?? 0) + last[0].length;
    const previousEnd = (previous.index ?? 0) + previous[0].length;
    const tail = name.slice(previousEnd).trim();
    if (lastEnd === name.length && tail.length >= 4) name = tail;
  }

  if (name.length > 48) {
    const suffix = name.match(/[\u4e00-\u9fa5A-Za-z0-9·（）()/-]{2,48}(?:满意度|响应率|满足率|控制率|运行率|达标率|完好率|准确率|合格率|成功率|投诉率|制定次数|次数|数量|成本|效益)$/)?.[0];
    if (suffix) name = suffix;
  }
  return name;
};

const categoryForTarget = (name: string, unit: string): AuthoritativeTargetFact["category"] => {
  const value = `${name}${unit}`;
  if (/权益追溯.*成功率|社会效益|政策制定|支撑政策|覆盖率/.test(value)) return "social";
  if (/满意度|响应率|满足率|投诉率|服务对象/.test(value)) return "satisfaction";
  if (/节约|经济效益|行政成本|万元\/年|元\/年/.test(value)) return "economic";
  if (/成本|费用|单价|控制率/.test(value)) return "cost";
  if (/进度|时效|完成时间|周期|天|月/.test(value)) return "progress";
  if (/质量|达标率|完好率|准确率|合格率|运行率/.test(value)) return "quality";
  if (/环境|节能|减排|生态/.test(value)) return "environment";
  if (/可持续|长效|稳定运行/.test(value)) return "sustainable";
  if (/数量|次数|人次|户数|件数|份数|项数|档案|移库/.test(value) || /^(?:标箱|次|项|个|户|人|件|份)$/.test(unit)) return "quantity";
  return "other";
};

const sourcePriority = (row: TargetEvidenceRow) => {
  const source = `${row.sourceName} ${row.sourceType ?? ""}`;
  let score = 0;
  if (/绩效目标申报表|绩效目标表|目标申报表/.test(source)) score += 90;
  if (/财政支出预期绩效报告|预期绩效报告/.test(source)) score += 85;
  if (/项目申报书|申报文本/.test(source)) score += 65;
  if (/预算|测算|明细/.test(source)) score += 40;
  if (/report_version|历史稿|生成报告|评估报告/i.test(source)) score -= 100;
  return score;
};

const isGeneratedReportSource = (row: TargetEvidenceRow) => {
  const sourceType = String(row.sourceType ?? "");
  const sourceName = normalizeSpace(row.sourceName);
  if (/report_version|历史稿|系统生成报告/i.test(sourceType)) return true;
  if (/Performance Evaluation Report|第[一二三四五六七八九十\d]+版报告|评估报告\s*[（(]?\d+[）)]?/i.test(sourceName)) {
    return !/财政支出预期绩效报告|预期绩效报告/.test(sourceName);
  }
  return false;
};

const isAuthoritativeTargetSource = (row: TargetEvidenceRow) =>
  sourcePriority(row) >= 60
  || /绩效目标|目标申报|预期绩效报告|项目申报书|申报文本/.test(`${row.sourceName} ${row.sourceType ?? ""}`);

const TARGET_DOCUMENT_HINT =
  /绩效目标|目标申报|预期绩效报告|项目申报书|申报文本|总体目标|数量指标|质量指标|进度指标|成本指标|效益指标|满意度指标/;
const TARGET_VALUE_HINT =
  /(?:目标|指标|数量|质量|进度|成本|效益|满意度|响应率|满足率|控制率|运行率|达标率|完好率|准确率|成功率|投诉率|制定次数)[^。\n]{0,180}(?:≥|≤|>|<|不低于|不高于|不少于|不超过|至少|至多|达到|达|=)?\s*\d+(?:\.\d+)?\s*(?:%|％|标箱|次|万元|元|年|月|天|项|个|户|人|件|份)?/;

const targetEvidenceExcerpt = (value: string, maxChars: number) => {
  const normalized = String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/([；。])\s*/g, "$1\n")
    .replace(/\s+(?=(?:数量指标|质量指标|进度指标|成本指标|经济效益指标|社会效益指标|环境效益指标|可持续影响指标|满意度指标))/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  const lines = normalized.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const selected = new Set<number>();
  lines.forEach((line, index) => {
    if (!TARGET_VALUE_HINT.test(line)) return;
    selected.add(index);
    if (index > 0) selected.add(index - 1);
    if (index + 1 < lines.length) selected.add(index + 1);
  });
  const excerpt = (selected.size
    ? Array.from(selected).sort((left, right) => left - right).map((index) => lines[index]).join("\n")
    : normalized.replace(/\s+/g, " ").trim()
  ).trim();
  return excerpt.slice(0, maxChars);
};

/**
 * Target tables are authoritative and must not compete with dozens of ordinary
 * project files for the same prompt budget.
 */
export const buildAuthoritativeTargetEvidenceDigest = (
  documents: TargetEvidenceDocument[],
  maxCharacters = 12000,
) => {
  const rows = (documents ?? [])
    .filter((document) => {
      const sourceName = normalizeSpace(document?.sourceName);
      const text = normalizeSpace(document?.text);
      if (!sourceName || !text) return false;
      if (isGeneratedReportSource({
        sourceName,
        text,
        sourceType: document.sourceType,
      })) return false;
      return TARGET_DOCUMENT_HINT.test(`${sourceName} ${text.slice(0, 6000)}`);
    })
    .sort((left, right) =>
      sourcePriority({
        sourceName: right.sourceName,
        text: right.text,
        sourceType: right.sourceType,
      }) - sourcePriority({
        sourceName: left.sourceName,
        text: left.text,
        sourceType: left.sourceType,
      })
    );
  if (!rows.length) return "";

  const budget = Math.max(3000, maxCharacters);
  const perDocument = Math.max(1200, Math.min(4200, Math.floor(budget / rows.length)));
  const sections: string[] = [];
  let used = 0;
  for (const row of rows) {
    const remaining = budget - used;
    if (remaining <= 180) break;
    const excerpt = targetEvidenceExcerpt(row.text, Math.min(perDocument, remaining - 120));
    if (!excerpt) continue;
    const section = `来源：《${row.sourceName}》\n${excerpt}`;
    sections.push(section);
    used += section.length;
  }
  if (!sections.length) return "";

  return [
    "【权威目标文件原文证据】",
    "以下内容从目标申报表、预期绩效报告和项目申报资料中单独提取，优先级高于普通资料摘要。报告必须逐项保留指标名称、比较符号、数值和单位。",
    ...sections,
  ].join("\n\n");
};

const sentenceExcerpt = (text: string, index: number, length: number) => {
  const start = Math.max(0, text.lastIndexOf("。", index - 1) + 1);
  const candidates = [
    text.indexOf("。", index + length),
    text.indexOf("；", index + length),
    text.indexOf("\n", index + length),
  ].filter((item) => item >= 0);
  const end = candidates.length ? Math.min(...candidates) + 1 : Math.min(text.length, index + length + 100);
  return normalizeSpace(text.slice(start, end)).slice(0, 260);
};

const TARGET_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9·（）()、\/—_-]{2,64}?(?:满意度|响应率|满足率|控制率|运行率|达标率|完好率|准确率|合格率|成功率|投诉率|制定次数|次数|数量|金额|成本|效益|目标|进度))\s*(?:[（(][^）)\n]{0,160}[）)])?\s*(?:[|｜]\s*)?(?:的)?(?:目标值|指标值)?\s*[：:]?\s*[（(]?\s*(≥|≤|>=|<=|＞|＜|>|<|不低于|不高于|不少于|不超过|至少|至多|超过|超|达到|达|=)?\s*(\d+(?:\.\d+)?)\s*(%|％|标箱|次|万元\s*[\/／]\s*年|元\s*[\/／]\s*年|万元|元|年|月|天|项|个|户|人|件|份)?/g;
const TABLE_ROW_TARGET_PATTERN = /(?:^|[|｜\n])\s*([\u4e00-\u9fa5A-Za-z0-9·、：:\/—_-]{2,64}?)(?:[（(][^）)\n]{0,160}[）)])?\s*[|｜]\s*(≥|≤|>=|<=|＞|＜|>|<|不低于|不高于|不少于|不超过|至少|至多|超过|超|达到|达|=)?\s*(\d+(?:\.\d+)?)\s*(%|％|标箱|次|万元\s*[\/／]\s*年|元\s*[\/／]\s*年|万元|元|年|月|天|项|个|户|人|件|份)/gm;

// 申报表的表头单元格（“年度目标”“其他资金”“一级指标”等）会和相邻单元格的年份
// 粘在一起，被当成“指标名 + 目标值”。这些名称里没有任何可考核的口径。
const TABLE_HEADER_NAME =
  /^(?:万元|元|其他资金|财政拨款|项目资金|资金总额|年度资金|中期资金|年度目标|中期目标|总体目标|项目目标|绩效目标|一级指标|二级指标|三级指标|指标值|目标值|项目名称|项目属性|项目期|实施单位|主管部门)+$/;

const isPlausibleTarget = (
  name: string,
  comparison: TargetComparison,
  value: string,
  unit: string,
) => {
  if (name.length < 2 || name.length > 48) return false;
  if (TABLE_HEADER_NAME.test(name.replace(/\s+/g, ""))) return false;
  // “2026年”是表格里的年份，不是目标值。放进锁定表会要求报告逐字复述它。
  if (/^年$/.test(unit) && /^(?:19|20|21)\d{2}$/.test(value)) return false;
  if (!comparison && !unit) return false;
  return /率|满意度|满足率|次数|数量|金额|成本|效益|目标/.test(name)
    || Boolean(comparison)
    || Boolean(unit);
};

export const extractAuthoritativeTargetFacts = (
  rows: TargetEvidenceRow[],
): AuthoritativeTargetFact[] => {
  const candidates: AuthoritativeTargetFact[] = [];

  for (const row of rows) {
    if (!row?.text || !row?.sourceName) continue;
    if (isGeneratedReportSource(row) || !isAuthoritativeTargetSource(row)) continue;
    const source = String(row.text).replace(/\r/g, "\n");
    for (const pattern of [TARGET_PATTERN, TABLE_ROW_TARGET_PATTERN]) {
      for (const match of source.matchAll(pattern)) {
        const name = cleanTargetName(match[1] ?? "");
        const comparison = normalizeComparison(match[2] ?? "");
        const value = String(match[3] ?? "").replace(/,/g, "");
        const unit = normalizeUnit(match[4] ?? "");
        if (!isPlausibleTarget(name, comparison, value, unit)) continue;
        const displayValue = `${comparison === "=" ? "" : comparison}${value}${unit}`;
        candidates.push({
          name,
          comparison,
          value,
          unit,
          displayValue,
          sourceName: normalizeSpace(row.sourceName),
          location: normalizeSpace(row.location ?? "资料正文"),
          excerpt: sentenceExcerpt(source, match.index ?? 0, match[0].length),
          category: categoryForTarget(name, unit),
          priority: sourcePriority(row),
        });
      }
    }
  }

  const groups = new Map<string, AuthoritativeTargetFact[]>();
  for (const item of candidates) {
    const key = item.name.replace(/\s+/g, "").toLowerCase();
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  const selected = Array.from(groups.values())
    .map((items) => items.sort((a, b) =>
      b.priority - a.priority
      || Number(Boolean(b.comparison)) - Number(Boolean(a.comparison))
      || b.excerpt.length - a.excerpt.length
    )[0])
    .sort((a, b) => b.priority - a.priority || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "zh-CN"));

  const formalCategories = new Set(
    selected
      .filter((item) => item.priority >= 90)
      .map((item) => item.category),
  );
  return selected.filter((item) =>
    item.priority >= 90
    || !formalCategories.has(item.category)
  );
};

export const formatAuthoritativeTargetRegister = (facts: AuthoritativeTargetFact[]) => {
  if (!facts.length) return "";
  return [
    "【绩效目标原值锁定表（权威口径）】",
    "以下每一行的指标名称、比较符号、数值和单位是不可拆分的目标事实。不得把“≥95%”改写为“100%”，不得把响应率与满意度合并，也不得在建议中提出低于原目标的示例值。",
    ...facts.map((fact, index) =>
      `${index + 1}. ${fact.name}｜目标值：${fact.displayValue}｜来源：《${fact.sourceName}》/${fact.location}｜原文：${fact.excerpt}`
    ),
  ].join("\n");
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const factHeading = (fact: AuthoritativeTargetFact) => {
  switch (fact.category) {
    case "quantity": return "（1）产出数量指标";
    case "quality": return "（2）产出质量指标";
    case "progress": return "（3）产出进度指标";
    case "cost": return "（4）产出成本指标";
    case "economic": return "（5）经济效益";
    case "social": return "（6）社会效益指标";
    case "environment": return "（7）环境效益指标";
    case "sustainable": return "（8）可持续影响指标";
    case "satisfaction": return "（9）服务对象满意度指标";
    default: return "2.具体绩效指标";
  }
};

const PERFORMANCE_TARGET_HEADINGS = [
  "（1）产出数量指标",
  "（2）产出质量指标",
  "（3）产出进度指标",
  "（4）产出成本指标",
  "（5）经济效益",
  "（6）社会效益指标",
  "（7）环境效益指标",
  "（8）可持续影响指标",
  "（9）服务对象满意度指标",
];

const targetSectionBody = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const nextStart = PERFORMANCE_TARGET_HEADINGS
    .map((candidate) => text.indexOf(candidate, start + heading.length))
    .filter((index) => index > start)
    .sort((left, right) => left - right)[0];
  const chapterEnd = text.indexOf("（二）项目资金总额", start + heading.length);
  const end = [nextStart, chapterEnd]
    .filter((index): index is number => Number.isFinite(index) && index > start)
    .sort((left, right) => left - right)[0] ?? text.length;
  return text.slice(start + heading.length, end);
};

const insertFactAfterHeading = (text: string, fact: AuthoritativeTargetFact) => {
  const heading = factHeading(fact);
  const statement = `根据《${fact.sourceName}》载明，${fact.name}目标值为${fact.displayValue}。`;
  const pattern = new RegExp(`(${escapeRegExp(heading)}\\s*)`);
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `$1\n${statement}\n`);
};

const insertFactsAfterHeading = (text: string, facts: AuthoritativeTargetFact[]) => {
  if (!facts.length) return text;
  const heading = factHeading(facts[0]);
  const sources = Array.from(new Set(facts.map((fact) => `《${fact.sourceName}》`)));
  const statement = `根据${sources.join("、")}载明，本类指标包括：${
    facts.map((fact) => `${fact.name}目标值为${fact.displayValue}`).join("；")
  }。`;
  const pattern = new RegExp(`(${escapeRegExp(heading)}\\s*)`);
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `$1\n${statement}\n`);
};

const terminalMetricName = (name: string) =>
  name.match(/(?:满意度|响应率|满足率|控制率|运行率|达标率|完好率|准确率|合格率|成功率|投诉率|制定次数|次数|成本|效益)$/)?.[0]
  ?? name;

const numericTargetPattern = /(?:≥|≤|>=|<=|＞|＜|>|<|不低于|不高于|不少于|不超过|至少|至多|超过|超|达到|达|=)?\s*\d+(?:\.\d+)?\s*(?:%|％|次|万元\s*[\/／]\s*年|元\s*[\/／]\s*年|万元|元|年|月|天|项|个|户|人|件|份)?/g;

const normalizeTargetLanguage = (text: string) =>
  String(text ?? "")
    .replace(/目标值为\s*[=＝]\s*/g, "目标值为")
    .replace(/指标值为\s*[=＝]\s*/g, "指标值为")
    .replace(/目标值[：:]\s*[=＝]\s*/g, "目标值：")
    .replace(/([≥≤><])\s+/g, "$1");

const paragraphSimilarity = (left: string, right: string) => {
  const tokenize = (value: string) => new Set(
    value
      .replace(/[，。；：、,.．:;（）()\s]/g, "")
      .match(/[\u4e00-\u9fa5]{2}|[A-Za-z0-9%≥≤><./-]+/g) ?? [],
  );
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
};

const dedupeTargetParagraphs = (text: string, facts: AuthoritativeTargetFact[]) => {
  const lines = String(text ?? "").split("\n");
  const keptByMetric = new Map<string, string[]>();
  const output: string[] = [];
  let activeHeading = "项目绩效目标";
  for (const line of lines) {
    const trimmed = line.trim();
    const matchedHeading = PERFORMANCE_TARGET_HEADINGS.find((heading) => trimmed === heading);
    if (matchedHeading) activeHeading = matchedHeading;
    const fact = facts.find((item) => trimmed.includes(item.name));
    if (!fact || trimmed.length < 14 || /^(?:（\d+）|\d+[.、．])/.test(trimmed)) {
      output.push(line);
      continue;
    }
    // The same metric may legitimately be summarized in another subsection.
    // Only remove repetitions within the same target category.
    const key = `${activeHeading}:${fact.name.replace(/\s+/g, "")}`;
    const previous = keptByMetric.get(key) ?? [];
    const duplicate = previous.length > 0 && previous.some((item) =>
      item === trimmed || paragraphSimilarity(item, trimmed) >= 0.35
    );
    if (duplicate) continue;
    previous.push(trimmed);
    keptByMetric.set(key, previous);
    output.push(line);
  }
  return output.join("\n");
};

export const reconcileAuthoritativeTargetNarrative = (
  report: string,
  facts: AuthoritativeTargetFact[],
) => {
  if (!report.trim() || !facts.length) return report;
  let output = String(report);
  const firstChapterEnd = output.search(/\n\s*二、评估方式和方法/);
  let firstChapter = firstChapterEnd >= 0 ? output.slice(0, firstChapterEnd) : output;

  for (const fact of facts) {
    const exactName = escapeRegExp(fact.name);
    const metricName = terminalMetricName(fact.name);
    const metricPattern = escapeRegExp(metricName);
    const firstChapterFactPattern = new RegExp(
      `(${exactName}(?:[（(][^）)\\n]{0,120}[）)])?[^。；\\n]{0,24}?)(?:目标值为|指标值为|目标为|应达到|需达到|为|[:：])\\s*${numericTargetPattern.source}`,
      "g",
    );
    firstChapter = firstChapter.replace(firstChapterFactPattern, (_full, prefix) =>
      `${String(prefix).replace(/\s*(?:目标值为|指标值为|为|[:：])?\s*$/, "")}目标值为${fact.displayValue}`
    );

    const suggestionPattern = new RegExp(
      `([^。；\\n]{0,60}(?:建议|完善|补充|明确)[^。；\\n]{0,60}${metricPattern}[^。；\\n]{0,60})(?:如|例如|建议值为|目标值为)\\s*${numericTargetPattern.source}`,
      "g",
    );
    output = output.replace(suggestionPattern, (_full, prefix) =>
      `${prefix}，并严格沿用《${fact.sourceName}》载明的目标值${fact.displayValue}`
    );

    const reportTargetPattern = new RegExp(
      `(${exactName}[^。；\\n]{0,48}?)(?:目标值为|指标值为|目标为|应达到|需达到|为|[:：])\\s*${numericTargetPattern.source}`,
      "g",
    );
    output = output.replace(reportTargetPattern, (full, prefix) => {
      if (/(?:实际|实测|实现|完成|监测|调查结果|考核结果)[^。；\n]{0,16}$/.test(String(prefix))) {
        return full;
      }
      return `${String(prefix).replace(/\s*(?:目标值为|指标值为|目标为|应达到|需达到|为|[:：])?\s*$/, "")}目标值为${fact.displayValue}`;
    });
  }

  if (firstChapterEnd >= 0) {
    output = `${firstChapter}${output.slice(firstChapterEnd)}`;
  } else {
    output = firstChapter;
  }

  const refreshedFirstChapterEnd = output.search(/\n\s*二、评估方式和方法/);
  let refreshedFirstChapter = refreshedFirstChapterEnd >= 0 ? output.slice(0, refreshedFirstChapterEnd) : output;
  refreshedFirstChapter = refreshedFirstChapter.replace(
    /(?:^|\n)\s*根据《[^》]+》载明，[^\n。]{2,100}目标值为[^\n。]+。[ \t]*/g,
    "\n",
  );
  const missingByHeading = new Map<string, AuthoritativeTargetFact[]>();
  for (const fact of facts) {
    const heading = factHeading(fact);
    // A metric mentioned elsewhere in the chapter does not make its own
    // category complete. Check the text under the matching heading only.
    if (targetSectionBody(refreshedFirstChapter, heading).includes(fact.name)) continue;
    const current = missingByHeading.get(heading) ?? [];
    current.push(fact);
    missingByHeading.set(heading, current);
  }
  for (const missingFacts of missingByHeading.values()) {
    refreshedFirstChapter = insertFactsAfterHeading(refreshedFirstChapter, missingFacts);
  }
  refreshedFirstChapter = dedupeTargetParagraphs(refreshedFirstChapter, facts);
  if (refreshedFirstChapterEnd >= 0) {
    output = `${refreshedFirstChapter}${output.slice(refreshedFirstChapterEnd)}`;
  } else {
    output = refreshedFirstChapter;
  }

  const economicFacts = facts.filter((fact) => fact.category === "economic");
  if (economicFacts.length) {
    const replacement = economicFacts
      .map((fact) => `根据《${fact.sourceName}》载明，${fact.name}目标值为${fact.displayValue}`)
      .join("；");
    const alreadyPresent = economicFacts.every((fact) => output.includes(fact.name));
    output = output.replace(
      /根据现有资料(?:暂时|暂)?无法确认(?:具体的?)?(?:直接)?经济效益(?:指标)?值[^。；\n]*[。；]?/g,
      alreadyPresent ? "" : `${replacement}。`,
    );
  }

  return normalizeTargetLanguage(output)
    .replace(/（\s*，/g, "（")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

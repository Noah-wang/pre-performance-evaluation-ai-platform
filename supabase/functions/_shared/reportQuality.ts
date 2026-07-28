import { formatSourceCitation } from "./reportEvidence.ts";

const normalizeSpace = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const standardKey = (prefix: string, number: string) =>
  `${prefix.toUpperCase().replace(/\s+/g, "")}${number}`;

export const normalizeUploadedStandardVersions = (report: string, evidence: string) => {
  const versions = new Map<string, { prefix: string; number: string; year: string }>();
  const pattern = /\b(DA\s*\/\s*T|GB\s*\/\s*T|GB|DB\d*\s*\/\s*T)\s*(\d+)\s*[-—]\s*(20\d{2})\b/gi;
  for (const match of String(evidence ?? "").matchAll(pattern)) {
    const key = standardKey(match[1], match[2]);
    const current = versions.get(key);
    if (!current || Number(match[3]) > Number(current.year)) {
      versions.set(key, { prefix: match[1].replace(/\s+/g, ""), number: match[2], year: match[3] });
    }
  }

  let output = String(report ?? "");
  for (const [key, latest] of versions) {
    const reportPattern = /\b(DA\s*\/\s*T|GB\s*\/\s*T|GB|DB\d*\s*\/\s*T)\s*(\d+)\s*[-—]\s*(20\d{2})\b/gi;
    output = output.replace(reportPattern, (full, prefix, number, year) => {
      if (standardKey(prefix, number) !== key || Number(year) >= Number(latest.year)) return full;
      return `${latest.prefix}${latest.number}-${latest.year}`;
    });
  }
  return output;
};

const numericSignals = (value: string) =>
  Array.from(new Set(
    String(value ?? "").match(
      /(?:DA\s*\/\s*T|GB\s*\/\s*T|GB|DB\d*\s*\/\s*T)\s*\d+\s*[-—]\s*20\d{2}|\d+(?:\.\d+)?\s*(?:万人|万元|亿元|万份|万件|平方米|标箱|非标箱|%|％|元(?:\/[\u4e00-\u9fa5A-Za-z0-9]+){1,3}|万元\/年|元|人|户|份|件|箱|套|台|天|月|年|次|项)/gi,
    ) ?? [],
  )).map((item) => item.replace(/\s+/g, "").replace(/％/g, "%"));

const normalizeNumericSignal = (value: string) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/％/g, "%")
    .replace(/(\d+\.\d+)/g, (number) => String(Number(number)))
    .replace(/DA\/?T/gi, "DAT")
    .replace(/GB\/?T/gi, "GBT")
    .toUpperCase();

interface SourceEvidenceBlock {
  sourceName: string;
  text: string;
}

export interface ReportSourceDocument {
  sourceName: string;
  text: string;
}

const normalizedSourceDocuments = (
  documents: ReportSourceDocument[] = [],
) => Array.from(
  new Map(
    documents
      .map((document) => ({
        sourceName: normalizeSpace(document?.sourceName),
        text: String(document?.text ?? "").replace(/\s+/g, ""),
      }))
      .filter((document) =>
        document.sourceName
        && document.text
        && !/^(?:系统生成报告|报告历史稿|Performance Evaluation Report|第[一二三四五六七八九十\d]+版报告)/i.test(document.sourceName)
      )
      .map((document) => [document.sourceName.toLowerCase(), document]),
  ).values(),
);

const sourceBlocks = (
  evidence: string,
  documents: ReportSourceDocument[] = [],
): SourceEvidenceBlock[] => {
  const structured = normalizedSourceDocuments(documents);
  if (structured.length) return structured;
  const source = String(evidence ?? "");
  const marker = /(?:《([^》]+\.(?:docx?|xlsx?|pdf|png|jpe?g))》|“([^”]+\.(?:docx?|xlsx?|pdf|png|jpe?g))”)/gi;
  const matches = Array.from(source.matchAll(marker));
  const blocks: SourceEvidenceBlock[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const sourceName = normalizeSpace(match[1] || match[2]);
    const start = match.index ?? 0;
    const nextStart = matches[index + 1]?.index ?? source.length;
    const end = Math.min(nextStart, start + 2400);
    if (/^(?:系统生成报告|报告历史稿|Performance Evaluation Report|第[一二三四五六七八九十\d]+版报告)/i.test(sourceName)) {
      continue;
    }
    blocks.push({
      sourceName,
      text: source.slice(start, end).replace(/\s+/g, ""),
    });
  }
  return Array.from(
    new Map(blocks.map((item) => [`${item.sourceName}:${item.text}`, item])).values(),
  );
};

export const repairNumericSourceAttributions = (
  report: string,
  evidence: string,
  documents: ReportSourceDocument[] = [],
) => {
  const blocks = sourceBlocks(evidence, documents);
  if (!blocks.length) return report;
  return String(report ?? "").replace(/根据《[^》]+》(?:[、及和]《[^》]+》)*[^。\n]*[。]?/g, (sentence) => {
    const signals = numericSignals(sentence);
    if (!signals.length) return sentence;
    const candidates = blocks
      .map((item) => ({
        ...item,
        hits: signals.filter((signal) => item.text.includes(signal)).length,
      }))
      .filter((item) => item.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.sourceName.localeCompare(b.sourceName, "zh-CN"));
    if (!candidates.length) return sentence;
    const bestHitCount = candidates[0].hits;
    const bestSources = Array.from(new Set(
      candidates.filter((item) => item.hits === bestHitCount).map((item) => item.sourceName),
    )).slice(0, 2);
    if (bestSources.length === 0) return sentence;
    const citation = bestSources.map(formatSourceCitation).join("、");
    return sentence.replace(/^根据《[^》]+》(?:[、及和]《[^》]+》)*/, `根据${citation}`);
  });
};

const insertProjectOverviewStatement = (report: string, statement: string) => {
  const output = String(report ?? "");
  if (output.includes(statement)) return output;
  const headings = [
    /((?:（三）|3[.．、])\s*项目概况\s*)/,
    /(1[.．、]\s*项目背景\s*)/,
  ];
  for (const heading of headings) {
    if (heading.test(output)) {
      return output.replace(heading, `$1\n${statement}\n`);
    }
  }
  return output;
};

export const normalizeProcurementStatement = (
  report: string,
  evidence: string,
  documents: ReportSourceDocument[] = [],
) => {
  const source = [
    String(evidence ?? ""),
    ...normalizedSourceDocuments(documents).map((document) => document.text),
  ].join("\n");
  if (!/(?:项目是否涉及政府采购|是否政府采购)\s*[：:]?\s*是/.test(source)) return report;
  const method = source.match(
    /(?:采购方式|拟采用|采用)\s*[：:]?\s*(公开招标|邀请招标|竞争性谈判|竞争性磋商|询价|单一来源)/,
  )?.[1];
  const precise = method
    ? `项目资料已确认该项目涉及政府采购，并有资料提出拟采用${method}方式；具体采购结论仍应以对应审批、采购或公示文件为准。`
    : "项目资料已确认该项目涉及政府采购，但现有资料未明确具体采购方式，也未见相应采购方式审批或公开文件。";
  const corrected = String(report ?? "")
    .replace(/(?:根据现有资料)?(?:暂未见|未提供|缺少)[^。\n]{0,80}(?:政府采购意向公开|采购方式审批)[^。\n]*。?/g, precise)
    .replace(/项目是否涉及政府采购[^。\n]{0,80}(?:不明确|无法确认)[^。\n]*。?/g, precise);
  if (/(?:涉及政府采购|采购方式)/.test(corrected)) return corrected;
  return insertProjectOverviewStatement(corrected, precise);
};

export const removeUnsupportedNumericClaims = (
  report: string,
  evidence: string,
  documents: ReportSourceDocument[] = [],
) => {
  const evidenceCorpus = [
    String(evidence ?? ""),
    ...normalizedSourceDocuments(documents).map((document) => document.text),
  ].join("\n");
  const supported = new Set(numericSignals(evidenceCorpus).map(normalizeNumericSignal));
  if (!supported.size) return report;

  return String(report ?? "")
    .split("\n")
    .map((line) => line
      .split(/(?<=[。！？!?])/)
      .map((sentence) => {
        const signals = numericSignals(sentence);
        if (!signals.length || signals.every((signal) => supported.has(normalizeNumericSignal(signal)))) {
          return sentence;
        }
        const supportedClauses = sentence
          .replace(/[。！？!?]+$/g, "")
          .split(/[，,；;]/)
          .map((clause) => clause.trim())
          .filter(Boolean)
          .filter((clause) => {
            const clauseSignals = numericSignals(clause);
            return !clauseSignals.length
              || clauseSignals.every((signal) => supported.has(normalizeNumericSignal(signal)));
          });
        if (!supportedClauses.length) return "";
        const joined = supportedClauses.join("，");
        const ending = sentence.match(/[。！？!?]+$/)?.[0] ?? "";
        return `${joined}${ending}`;
      })
      .join(""))
    .filter((line, index, lines) =>
      line.trim() || !lines[index - 1]?.trim()
    )
    .join("\n");
};

const standardApplication = (sourceName: string) => {
  if (/纸质档案数字化/.test(sourceName)) {
    return "用于核验项目涉及纸质档案数字化环节时的技术要求，不作为档案存储服务价格依据";
  }
  if (/库房空气质量/.test(sourceName)) return "用于核验档案库房空气质量检测要求";
  if (/保管外包/.test(sourceName)) return "用于核验档案保管外包服务管理要求";
  if (/服务外包/.test(sourceName)) return "用于核验档案服务外包工作要求";
  if (/社会保险业务档案/.test(sourceName)) return "用于核验社会保险业务档案管理要求";
  if (/机关档案管理/.test(sourceName)) return "用于核验机关档案管理制度要求";
  return "按文件载明的适用范围核验项目实施要求";
};

export const ensureUploadedStandardsReferenced = (
  report: string,
  evidence: string,
  documents: ReportSourceDocument[] = [],
) => {
  const output = String(report ?? "");
  if (!/1\.项目背景|1、项目背景/.test(output)) return output;
  const blocks = sourceBlocks(evidence, documents);
  const standards = blocks
    .filter((item) => /(?:DA\s*\/?\s*T|DAT|GB\s*\/?\s*T|GBT|档案行业标准|国家标准)/i.test(`${item.sourceName}${item.text}`))
    .map((item) => item.sourceName)
    .filter((name, index, values) => values.indexOf(name) === index)
    .slice(0, 6);
  const unappliedStandards = standards.filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`${escaped}[^。\\n]{0,80}(?:用于|适用|核验|作为依据)`).test(output);
  });
  if (!unappliedStandards.length) return output;
  const statement = `政策与标准适用性核验：${unappliedStandards
    .map((name) => `${formatSourceCitation(name)}${standardApplication(name)}`)
    .join("；")}。`;
  const heading = /(1\.项目背景|1、项目背景)\s*/;
  return output.replace(heading, `$1\n${statement}\n`);
};

const POLICY_TITLE = /《([^》]{2,80}(?:法|条例|办法|规定|规范|标准|目录|细则|制度|通知|意见))》/g;

export const removeUnsupportedPolicyClauses = (
  report: string,
  evidence: string,
  documents: ReportSourceDocument[] = [],
) => {
  const corpus = [
    String(evidence ?? ""),
    ...normalizedSourceDocuments(documents).map((document) => `${document.sourceName}\n${document.text}`),
  ].join("\n").replace(/\s+/g, "");

  return String(report ?? "")
    .split("\n")
    .map((line) => line
      .split(/(?<=[。！？!?])/)
      .map((sentence) => {
        const clauses = sentence.replace(/[。！？!?]+$/g, "").split(/[，,；;]/);
        const kept = clauses.filter((clause) => {
          const citedPolicies = Array.from(clause.matchAll(POLICY_TITLE)).map((match) =>
            String(match[1] ?? "").replace(/\s+/g, "")
          );
          if (!citedPolicies.length) return true;
          return citedPolicies.every((policy) => corpus.includes(policy));
        });
        if (!kept.length) return "";
        const joined = kept.join("，").trim();
        const ending = sentence.match(/[。！？!?]+$/)?.[0] ?? "";
        return joined ? `${joined}${ending}` : "";
      })
      .join(""))
    .join("\n");
};

export const cleanReportLanguage = (report: string) =>
  String(report ?? "")
    .replace(/(标箱|非标箱|万元|元|次|项|件|份|人|户)\1/g, "$1")
    .replace(/([^。\n]{8,160}[。])\s*\1/g, "$1")
    .replace(/《([^》]+)》(?:\s*[、，,及和]\s*《\1》)+/g, "《$1》")
    .replace(
      /(?:收费总表|收费明细表|寄存收费明细表|结算清单)(?=[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,48}(?:股份有限公司|有限责任公司|有限公司))/g,
      "",
    )
    .replace(
      /([\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,60}(?:股份有限公司|有限责任公司|有限公司))[。；，,\s]+(?:信息股份有限公司|股份有限公司|有限责任公司|有限公司)[。；，,]?/g,
      "$1。",
    )
    .replace(
      /本项目((?:《[^》]+》)(?:\s*[、，,及和]\s*《[^》]+》)*)\s*(?=立项|预算|绩效|实施)/g,
      "根据$1，本项目",
    )
    .replace(/[；;]\s*[、，,]/g, "；")
    .replace(/([\u4e00-\u9fa5]{2,8})。\1。/g, "$1。")
    .replace(/[；;]\s*[。．]/g, "。")
    .replace(/[。．]{2,}/g, "。")
    .replace(/[；;]{2,}/g, "；")
    .replace(/如下[：:]\s*(?:但|同时|此外)\s*/g, "如下：")
    .replace(/未再次进行三方比价[。；]\s*再次进行三方比价[。；]?/g, "未再次进行三方比价。")
    .replace(/调研发现无发现问题/g, "调研未发现问题")
    .replace(/\s+([，。；：])/g, "$1");

export const corruptedReportLines = (value: unknown) =>
  String(value ?? "")
    .split(/\n+/)
    .filter((line) => {
      if (/^本次评估已逐份查阅并核验以下补充资料/.test(line.trim())) return false;
      if (line.length < 80) return false;
      const latinTokens = line.match(/\b[A-Za-z]{1,5}\b/g) ?? [];
      const noiseMarks = line.match(/[|~_]{1,}|(?:-{3,})/g) ?? [];
      const chineseChars = line.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
      return chineseChars >= 20
        && latinTokens.length >= 8
        && (noiseMarks.length >= 2 || latinTokens.length >= 16);
    });

export const containsCorruptedReportText = (value: unknown) =>
  corruptedReportLines(value).length > 0;

export const containsGeneratedReportCitation = (value: unknown) =>
  /《(?:系统生成报告|报告历史稿|Performance Evaluation Report|第[一二三四五六七八九十百\d]+版(?:事前绩效)?评估报告)[^》]*》|(?:根据|参照|引用)(?:系统生成报告|报告历史稿|Performance Evaluation Report|第[一二三四五六七八九十百\d]+版(?:事前绩效)?评估报告)/i
    .test(String(value ?? ""));

const uniqueSourceNames = (sourceNames: string[]) =>
  Array.from(new Map(
    sourceNames
      .map((name) => String(name ?? "").trim())
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  ).values());

export const auditReportSourceCoverage = (
  report: string,
  sourceNames: string[] = [],
) => {
  const source = String(report ?? "");
  const names = uniqueSourceNames(sourceNames);
  return {
    total: names.length,
    covered: names.filter((name) => source.includes(name)),
    missing: names.filter((name) => !source.includes(name)),
  };
};

const sourceReviewCategory = (sourceName: string) => {
  if (/会议|纪要|录音|转写|专家意见|打分|评分/.test(sourceName)) return "会议纪要及专家意见";
  if (/调研|踏勘|现场|照片/.test(sourceName)) return "现场调研";
  if (/预算|测算|结算|合同|收费|采购|询价|报价/.test(sourceName)) return "预算测算及合同结算";
  if (/绩效目标|预期绩效|申报书|申报文本/.test(sourceName)) return "项目申报及绩效目标";
  if (/实施方案|工作方案|评估方案/.test(sourceName)) return "项目及评估实施方案";
  if (/法|条例|办法|规定|规范|标准|制度|政策|京社保发|DAT|DA.T|GBT|GB.T/i.test(sourceName)) {
    return "政策法规及标准规范";
  }
  return "其他项目支撑资料";
};

const compactSourceReview = (sourceNames: string[]) => {
  const categories = Array.from(new Set(
    uniqueSourceNames(sourceNames).map(sourceReviewCategory),
  ));
  const categoryText = categories.length
    ? categories.join("、")
    : "项目申报、预算测算、绩效目标、实施安排及专家意见";
  return `评估组已查阅${categoryText}等资料，并围绕项目背景、预算构成、绩效目标、实施安排、标准依据和专家意见进行交叉核验。具体文件名称仅在对应事实依据处按实际引用。`;
};

export const ensureAllSourcesAcknowledged = (
  report: string,
  sourceNames: string[] = [],
) => {
  const inventory = compactSourceReview(sourceNames);
  const output = String(report ?? "").replace(
    /本次评估已逐份查阅并核验以下补充资料：[\s\S]*?未形成直接结论的资料仅作为核验范围记录，不据此推定资料中未载明的事实。[ \t]*/g,
    `${inventory}\n`,
  );
  const { missing } = auditReportSourceCoverage(output, sourceNames);
  if (!missing.length || output.includes(inventory)) return output;

  const heading = /(\n[ \t]*2[.．、][ \t]*查阅资料[ \t]*\n)/;
  if (heading.test(output)) {
    return output.replace(heading, `$1${inventory}\n`);
  }
  const nextHeading = /(\n\s*3[.．、]\s*召开专家预评估会)/;
  if (nextHeading.test(output)) {
    return output.replace(nextHeading, `\n2.查阅资料\n${inventory}\n$1`);
  }
  return output;
};

export const applyReportQualityCorrections = (
  report: string,
  evidence: string,
  sourceNames: string[] = [],
  sourceDocuments: ReportSourceDocument[] = [],
) =>
  cleanReportLanguage(
    ensureAllSourcesAcknowledged(
      removeUnsupportedPolicyClauses(
        removeUnsupportedNumericClaims(
          repairNumericSourceAttributions(
            normalizeProcurementStatement(
              ensureUploadedStandardsReferenced(
                normalizeUploadedStandardVersions(
                  report,
                  [
                    evidence,
                    ...normalizedSourceDocuments(sourceDocuments).map((document) =>
                      `${document.sourceName}\n${document.text}`
                    ),
                  ].join("\n"),
                ),
                evidence,
                sourceDocuments,
              ),
              evidence,
              sourceDocuments,
            ),
            evidence,
            sourceDocuments,
          ),
          evidence,
          sourceDocuments,
        ),
        evidence,
        sourceDocuments,
      ),
      sourceNames,
    ),
  )
    .replace(/目标值为\s*[=＝]\s*/g, "目标值为")
    .replace(/指标值为\s*[=＝]\s*/g, "指标值为");

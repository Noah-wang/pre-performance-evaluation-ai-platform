import type { AuthoritativeTargetFact } from "./reportTargets.ts";

export type ReportVerificationStatus = "passed" | "needs_review" | "blocked";

export interface ReportVerificationIssue {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  sourceNames?: string[];
  /** 需要人工拍板的口径问题：给出问题和候选口径，由使用者选择后写入生成指令。 */
  question?: string;
  options?: string[];
}

export interface ReportFileVerification {
  fileId: string;
  fileName: string;
  category: string;
  status: "read" | "unreadable";
  sourceType?: string | null;
  sourceId?: string | null;
  errorMessage?: string | null;
  chunkCount: number;
  factCount: number;
}

export interface ReportDimensionVerification {
  dimension: string;
  evidenceCount: number;
  sourceNames: string[];
}

export interface ComprehensiveReportVerification {
  phase: "preflight" | "final";
  status: ReportVerificationStatus;
  summary: string;
  checkedFiles: number;
  totalFiles: number;
  indexedFiles: number;
  coveredFiles: number;
  targetFactsChecked: number;
  targetFactsPresent: number;
  dimensionsChecked: number;
  dimensionsCovered: number;
  files: ReportFileVerification[];
  dimensions: ReportDimensionVerification[];
  issues: ReportVerificationIssue[];
}

export interface ReportVerificationDossier {
  stats: {
    files: number;
    indexedFiles: number;
    unindexedFiles: number;
    coveredFiles: number;
  };
  fileReviews?: ReportFileVerification[];
  dimensionReviews?: ReportDimensionVerification[];
  conflicts?: Array<{
    code: string;
    detail: string;
    question: string;
    options: string[];
  }>;
  targetFacts?: AuthoritativeTargetFact[];
  sourceNames?: string[];
  corpus?: string;
  /** 评估机构在界面上填写的结论金额等口径：它们是人的决定，不应要求在资料中找到出处。 */
  decisionFigures?: string[];
  serviceProviders?: Array<{ name?: string | null }>;
}

const normalize = (value: unknown) =>
  String(value ?? "")
    .replace(/[，,\s]/g, "")
    .replace(/％/g, "%")
    .replace(/[（(][^）)]*[）)]/g, "")
    .toLowerCase();

const statusForIssues = (issues: ReportVerificationIssue[]): ReportVerificationStatus => {
  if (issues.some((issue) => issue.severity === "error")) return "blocked";
  if (issues.some((issue) => issue.severity === "warning")) return "needs_review";
  return "passed";
};

const summaryFor = (
  status: ReportVerificationStatus,
  checkedFiles: number,
  totalFiles: number,
  issueCount: number,
) => {
  if (status === "blocked") {
    return `全面核验未通过：已检查 ${checkedFiles}/${totalFiles} 份资料，存在必须先处理的问题。`;
  }
  if (status === "needs_review") {
    return `全面核验需人工确认：已检查 ${checkedFiles}/${totalFiles} 份资料，发现 ${issueCount} 项口径或证据问题。`;
  }
  return `全面核验通过：已检查 ${checkedFiles}/${totalFiles} 份资料，未发现阻断问题。`;
};

const buildResult = (
  phase: "preflight" | "final",
  dossier: ReportVerificationDossier,
  issues: ReportVerificationIssue[],
  targetFactsPresent = 0,
): ComprehensiveReportVerification => {
  const files = dossier.fileReviews ?? [];
  const dimensions = dossier.dimensionReviews ?? [];
  const status = statusForIssues(issues);
  const checkedFiles = files.filter((file) => file.status === "read").length;
  return {
    phase,
    status,
    summary: summaryFor(status, checkedFiles, dossier.stats.files, issues.length),
    checkedFiles,
    totalFiles: dossier.stats.files,
    indexedFiles: dossier.stats.indexedFiles,
    coveredFiles: dossier.stats.coveredFiles,
    targetFactsChecked: dossier.targetFacts?.length ?? 0,
    targetFactsPresent,
    dimensionsChecked: dimensions.length,
    dimensionsCovered: dimensions.filter((item) => item.evidenceCount > 0).length,
    files,
    dimensions,
    issues,
  };
};

export const verifyReportPreflight = (
  dossier: ReportVerificationDossier,
): ComprehensiveReportVerification => {
  const issues: ReportVerificationIssue[] = [];
  const files = dossier.fileReviews ?? [];

  if (dossier.stats.files === 0) {
    issues.push({
      code: "NO_PROJECT_FILES",
      severity: "error",
      title: "没有可核验资料",
      detail: "当前项目没有可用于报告生成的资料，已停止生成。",
    });
  }

  const unreadableFiles = files.filter((file) => file.status === "unreadable");
  if (dossier.stats.unindexedFiles > 0 || unreadableFiles.length > 0) {
    issues.push({
      code: "UNREADABLE_FILES",
      severity: "error",
      title: "存在未完成解析的资料",
      detail: `有 ${Math.max(dossier.stats.unindexedFiles, unreadableFiles.length)} 份资料没有可读取正文，不能静默跳过后继续生成。`,
      sourceNames: unreadableFiles.map((file) =>
        file.errorMessage ? `${file.fileName}（${file.errorMessage}）` : file.fileName
      ),
    });
  }

  if (dossier.stats.coveredFiles < dossier.stats.files) {
    issues.push({
      code: "INCOMPLETE_FILE_COVERAGE",
      severity: "error",
      title: "逐文件核验未覆盖全部资料",
      detail: `仅建立了 ${dossier.stats.coveredFiles}/${dossier.stats.files} 份资料的核验记录。`,
    });
  }

  const uncoveredDimensions = (dossier.dimensionReviews ?? [])
    .filter((item) => item.evidenceCount <= 0);
  if (uncoveredDimensions.length) {
    issues.push({
      code: "DIMENSION_WITHOUT_EVIDENCE",
      severity: "warning",
      title: "部分评估指标缺少直接证据",
      detail: `以下指标尚未检索到直接正文依据：${uncoveredDimensions.map((item) => item.dimension).join("、")}。`,
    });
  }

  // 口径冲突不该只抛一段文字让人自己琢磨：每条都带上问题和候选口径，
  // 使用者选定后作为生成指令写进报告，避免模型自行挑一个版本。
  for (const conflict of dossier.conflicts ?? []) {
    issues.push({
      code: conflict.code || "SOURCE_CONFLICTS",
      severity: "warning",
      title: "资料存在口径冲突，需人工确认",
      detail: conflict.detail,
      question: conflict.question,
      options: conflict.options,
    });
  }

  return buildResult("preflight", dossier, issues);
};

const requiredHeadings = [
  "一、评估对象",
  "二、评估方式和方法",
  "三、评估内容与结论",
  "四、相关建议",
];

const businessSignals = (value: string) => {
  const matches = [
    ...value.matchAll(/(?:≥|≤|>|<|超|超过)?\s*\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元|万|%|％|标箱|非标箱|箱|件|份|个|套|人|户|小时|次|项)/g),
    ...value.matchAll(/(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi),
  ].map((match) => String(match[0] ?? "").trim());
  return Array.from(new Set(matches.map(normalize))).filter(Boolean);
};

const targetFactPresent = (report: string, fact: AuthoritativeTargetFact) => {
  const reportKey = normalize(report);
  const valueKey = normalize(`${fact.comparison}${fact.value}${fact.unit}`);
  const displayKey = normalize(fact.displayValue);
  const nameKey = normalize(fact.name);
  return Boolean(
    nameKey
    && reportKey.includes(nameKey)
    && ((valueKey && reportKey.includes(valueKey)) || (displayKey && reportKey.includes(displayKey)))
  );
};


// 报告里出现的"依据"分两种：上传资料的文件名，以及法规/标准/办法/目录这类
// 外部权威名称。前者已有清单可比对，后者最容易被凭空造出来——模型需要给某个
// 单价或结论找背书时，会写出一个听起来正规、但资料里根本不存在的出处。
const CITATION_PATTERN = /[《""]([^》""]{4,60})[》""]/g;
// 只追究"外部权威依据"这一类：法律法规、国标行标、管理办法、采购目录。
// "方案""意见""制度"这类词大量出现在上传资料的文件名里（实施方案.docx、
// 专家意见书.docx），纳入判定会把真实资料误报成编造。
const EXTERNAL_AUTHORITY = /法$|法律|条例|办法|规范|标准|准则|细则|指南|目录|号令|通知$/;
// 带扩展名的一律是上传文件，不属于外部权威依据。
const UPLOADED_FILE_NAME = /\.(?:docx?|xlsx?|xlsm|xlsb|csv|pdf|png|jpe?g|txt)$/i;

const citationKey = (value: string) =>
  String(value ?? "")
    .replace(/\.(docx?|xlsx?|xlsm|xlsb|csv|pdf|png|jpe?g|txt)$/i, "")
    .replace(/[\s《》""''（）()【】\[\]：:，,。；;、_-]/g, "")
    .toLowerCase();

/** 挑出报告里引用了、但资料中查无此名的出处。 */
const unsupportedCitations = (report: string, dossier: ReportVerificationDossier) => {
  const known = new Set<string>();
  for (const name of dossier.sourceNames ?? []) {
    const key = citationKey(name);
    if (key) known.add(key);
  }
  // 语料里出现过的名称同样算有据可查：政策依据常写在资料正文里而非文件名。
  const corpus = String(dossier.corpus ?? "");
  const corpusKey = citationKey(corpus);

  const seen = new Set<string>();
  const suspects: string[] = [];
  for (const match of String(report ?? "").matchAll(CITATION_PATTERN)) {
    const raw = String(match[1] ?? "").trim();
    const key = citationKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (known.has(key)) continue;
    if (corpusKey.includes(key)) continue;
    if (UPLOADED_FILE_NAME.test(raw)) continue;
    if (!EXTERNAL_AUTHORITY.test(raw)) continue;
    suspects.push(raw);
  }
  return suspects;
};

export const verifyFinalReport = (
  report: string,
  dossier: ReportVerificationDossier,
): ComprehensiveReportVerification => {
  const text = String(report ?? "").trim();
  const issues: ReportVerificationIssue[] = [];
  const preflight = verifyReportPreflight(dossier);
  issues.push(...preflight.issues);

  const missingHeadings = requiredHeadings.filter((heading) => !text.includes(heading));
  const missingDimensions = (dossier.dimensionReviews ?? [])
    .filter((item) => !text.includes(item.dimension))
    .map((item) => item.dimension);
  if (missingHeadings.length || missingDimensions.length) {
    issues.push({
      code: "INCOMPLETE_REPORT_STRUCTURE",
      severity: "error",
      title: "报告章节不完整",
      detail: [...missingHeadings, ...missingDimensions].join("、"),
    });
  }

  const targetFacts = dossier.targetFacts ?? [];
  const presentTargets = targetFacts.filter((fact) => targetFactPresent(text, fact));
  const missingTargets = targetFacts.filter((fact) => !targetFactPresent(text, fact));
  if (missingTargets.length) {
    issues.push({
      code: "MISSING_AUTHORITATIVE_TARGETS",
      severity: "error",
      title: "权威绩效目标未完整进入报告",
      detail: missingTargets
        .slice(0, 12)
        .map((fact) => `${fact.name}${fact.displayValue}`)
        .join("、"),
      sourceNames: Array.from(new Set(missingTargets.map((fact) => fact.sourceName))),
    });
  }

  // 支持金额、不予支持金额这类数字来自评估机构的判断，本就不存在于项目资料中。
  // 不纳入可信来源就会被判成"查无出处"，把人自己填的结论拦下来。
  const evidenceSignals = new Set(businessSignals([
    dossier.corpus,
    ...(dossier.decisionFigures ?? []),
    ...(dossier.targetFacts ?? []).map((fact) =>
      `${fact.name}${fact.comparison}${fact.value}${fact.unit}`
    ),
  ].filter(Boolean).join("\n")));
  const unsupportedSignals = businessSignals(text)
    .filter((signal) => !evidenceSignals.has(signal))
    .filter((signal) => !/^(?:1|2|3|4|5|6|7|8|9|10)(?:年|月|天|次|项)$/.test(signal))
    // 零值是"没有/无"的如实表述：申报表里"其他资金"一栏为空，报告写成
    // "其他资金0万元"是准确的，但语料里不会有"0万元"这个字面，会被误判成编造。
    .filter((signal) => !/^(?:≥|≤|>|<|=)?0(?:\.0+)?[^\d]/.test(signal));
  if (unsupportedSignals.length) {
    issues.push({
      code: "UNSUPPORTED_NUMERIC_CLAIMS",
      severity: "error",
      title: "报告存在无法回溯到资料的数字或标准号",
      detail: `${unsupportedSignals.slice(0, 12).join("、")}。这些数字在项目资料中查不到出处，定稿前必须核实或删除。`,
    });
  }

  const fabricatedCitations = unsupportedCitations(text, dossier);
  if (fabricatedCitations.length) {
    issues.push({
      code: "UNSUPPORTED_CITATIONS",
      severity: "error",
      title: "报告引用了资料中不存在的依据",
      detail: `${fabricatedCitations.slice(0, 8).join("、")}。这些名称在已上传资料和正文中均未出现，属于模型自行引用的外部依据，定稿前必须核实或删除。`,
      sourceNames: fabricatedCitations.slice(0, 8),
    });
  }

  const missingProviders = (dossier.serviceProviders ?? [])
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean)
    .filter((name) => !text.includes(name));
  if (missingProviders.length) {
    issues.push({
      code: "MISSING_SERVICE_PROVIDER",
      severity: "warning",
      title: "已识别服务商未在报告中体现",
      detail: missingProviders.join("、"),
    });
  }

  const uniqueIssues = Array.from(
    new Map(issues.map((issue) => [`${issue.code}:${issue.detail}`, issue])).values(),
  );
  return buildResult("final", dossier, uniqueIssues, presentTargets.length);
};

export interface EvidenceSourceRow {
  text: string;
  sourceName?: string | null;
}

export interface ServiceProviderMention {
  name: string;
  sourceName: string;
  excerpt: string;
  supportingSources?: string[];
  evidenceCount?: number;
  confidenceScore?: number;
}

export interface AuthoritativeIndicatorScore {
  name: string;
  average: number;
  maxAverage: number;
  expertCount: number;
  reasons: string[];
}

export interface AuthoritativeScoreSnapshot {
  average: number;
  maxAverage: number;
  expertCount: number;
  indicators: AuthoritativeIndicatorScore[];
}

export type SourceAliasMap = Record<string, string>;
export type SourceAliasCandidates = Record<string, string[]>;

export interface SourceAliasEntry {
  alias: string;
  fileName: string;
}

export const normalizeSourceKey = (value: unknown) =>
  String(value ?? "")
    .replace(/\.(docx?|xlsx?|xlsm|xlsb|csv|pdf|png|jpe?g|txt)$/i, "")
    .replace(/[《》“”"'‘’\s（）()【】[\]：:，,。；;、_-]/g, "")
    .toLowerCase();

const SYSTEM_RECORD_SOURCE_TYPES = new Set([
  "meeting_minute",
  "meeting_recording",
  "field_record",
  "field_audio",
  "evaluation_plan",
]);

export const isSystemRecordEvidence = (row: any) => {
  const sourceType = String(
    row?.source_type
      ?? row?.sourceType
      ?? row?.metadata?.source_type
      ?? row?.metadata?.sourceType
      ?? "",
  ).toLowerCase();
  return Boolean(row?.is_generated ?? row?.metadata?.generated)
    || SYSTEM_RECORD_SOURCE_TYPES.has(sourceType);
};

export const actualSourceFileName = (row: any) => {
  if (isSystemRecordEvidence(row)) return "";
  return String(row?.file_name || row?.fileName || row?.sourceFileName || "").trim();
};

export const sourceDisplayName = (row: any) =>
  actualSourceFileName(row)
  || String(row?.title || row?.sourceTitle || "未命名资料").trim();

export const formatSourceCitation = (value: unknown) => {
  const name = String(value ?? "").trim();
  if (!name) return "项目资料";
  // Some uploaded filenames already contain Chinese book-title brackets.
  // Wrapping those names again creates malformed nested citations.
  return /[《》]/.test(name) ? `“${name}”` : `《${name}》`;
};

export const buildSourceAliasEntries = (rows: any[]): SourceAliasEntry[] => {
  const candidates = new Map<string, { aliases: Set<string>; fileNames: Set<string> }>();

  for (const row of rows ?? []) {
    const fileName = actualSourceFileName(row);
    if (!fileName) continue;

    const aliases = [row?.title, row?.sourceTitle, row?.materialName]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

    for (const alias of aliases) {
      const key = normalizeSourceKey(alias);
      if (!key || key === normalizeSourceKey(fileName)) continue;
      const current = candidates.get(key) ?? {
        aliases: new Set<string>(),
        fileNames: new Set<string>(),
      };
      current.aliases.add(alias);
      current.fileNames.add(fileName);
      candidates.set(key, current);
    }
  }

  return Array.from(candidates.values())
    .filter((candidate) => candidate.fileNames.size === 1)
    .map((candidate) => ({
      alias: Array.from(candidate.aliases)[0],
      fileName: Array.from(candidate.fileNames)[0],
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias, "zh-CN"));
};

export const buildSourceAliasMap = (rows: any[]): SourceAliasMap =>
  Object.fromEntries(
    buildSourceAliasEntries(rows).map((entry) => [
      normalizeSourceKey(entry.alias),
      entry.fileName,
    ]),
  );

export const buildSourceAliasCandidates = (rows: any[]): SourceAliasCandidates => {
  const candidates = new Map<string, Set<string>>();

  for (const row of rows ?? []) {
    const fileName = actualSourceFileName(row);
    if (!fileName) continue;
    for (const rawAlias of [row?.title, row?.sourceTitle, row?.materialName]) {
      const alias = String(rawAlias ?? "").trim();
      const key = normalizeSourceKey(alias);
      if (!key || key === normalizeSourceKey(fileName)) continue;
      const current = candidates.get(key) ?? new Set<string>();
      current.add(fileName);
      candidates.set(key, current);
    }
  }

  return Object.fromEntries(
    Array.from(candidates.entries())
      .map(([key, fileNames]) => [
        key,
        Array.from(fileNames).sort(),
      ])
      .filter(([, fileNames]) => fileNames.length > 0),
  );
};

const compactExcerpt = (value: string, max = 260) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const COMPANY_SUFFIX = "(?:股份有限公司|有限责任公司|有限公司)";
const PROCUREMENT_CONTEXT = /服务商|供应商|中标|成交|承接|委托|询价|采购|合同|结算|托管|保管|外包|合作/;

const cleanCompanyName = (value: string) =>
  String(value ?? "")
    .replace(/^(?:本项目|项目|相关|原|现有|历史|延续)+/, "")
    .replace(
      /^(?:收费总表|收费明细表|寄存收费明细表|结算清单|合同清单|服务商|供应商|中标单位|成交单位|承接单位|受托单位)(?:名称)?(?:为|是|：|:)?/,
      "",
    )
    .trim();

const extractCompanyNames = (text: string) => {
  const names: string[] = [];
  const patterns = [
    new RegExp(`(?:服务商|供应商|中标单位|成交单位|承接单位|受托单位|合作方)(?:名称)?\\s*(?:为|是|涉及|：|:)?\\s*([\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{2,48}?${COMPANY_SUFFIX})`, "g"),
    new RegExp(`(?:由|委托|选择|确定|延续使用|继续使用|合作|涉及)\\s*([\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{2,48}?${COMPANY_SUFFIX})`, "g"),
    new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{2,48}?${COMPANY_SUFFIX})[-—_（）()\\s]{0,8}(?:档案)?(?:托管|保管|外包|服务|合同|结算|报价|收费|中标|成交)`, "g"),
    new RegExp(`《([^》]{2,60}?${COMPANY_SUFFIX})(?:[-—_（(][^》]*)?》`, "g"),
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = cleanCompanyName(match[1] ?? "");
      if (name.length >= 4) names.push(name);
    }
  }

  return Array.from(new Set(names));
};

export const extractServiceProviderMentions = (
  rows: EvidenceSourceRow[],
): ServiceProviderMention[] => {
  const mentions: ServiceProviderMention[] = [];

  for (const row of rows ?? []) {
    const text = String(row?.text ?? "").trim();
    if (!text || !PROCUREMENT_CONTEXT.test(text)) continue;
    const sourceName = String(row?.sourceName ?? "").trim() || "项目资料";
    for (const name of extractCompanyNames(text)) {
      mentions.push({
        name,
        sourceName,
        excerpt: compactExcerpt(text),
      });
    }
  }

  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = `${mention.name.toLowerCase()}::${mention.sourceName.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const rankServiceProviderMentions = (
  mentions: ServiceProviderMention[],
): ServiceProviderMention[] => {
  const grouped = new Map<string, {
    mention: ServiceProviderMention;
    score: number;
    sources: Set<string>;
  }>();

  for (const mention of mentions ?? []) {
    const name = String(mention.name ?? "").trim();
    const sourceName = String(mention.sourceName ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const directFileName = normalizeSourceKey(sourceName).includes(normalizeSourceKey(name));
    const sourceWeight = /合同|结算|实施方案|中标|成交|采购结果|收费明细|寄存明细/.test(sourceName)
      ? 8
      : /询价|报价|预算|测算/.test(sourceName)
      ? 4
      : 1;
    const statementWeight = /(?:本项目|项目)?(?:由|委托|选择|确定)|(?:服务商|供应商|中标单位|成交单位|承接单位|受托单位)(?:为|是|：|:)/.test(
      mention.excerpt,
    )
      ? 8
      : 0;
    const current = grouped.get(key) ?? {
      mention,
      score: 0,
      sources: new Set<string>(),
    };
    current.sources.add(sourceName);
    current.score += 5 + sourceWeight + statementWeight + (directFileName ? 12 : 0);
    if (mention.excerpt.length > current.mention.excerpt.length) current.mention = mention;
    grouped.set(key, current);
  }

  const ranked = Array.from(grouped.values())
    .sort((left, right) =>
      right.score - left.score
      || right.sources.size - left.sources.size
      || left.mention.name.localeCompare(right.mention.name, "zh-CN")
    )
    .map((item) => ({
      ...item.mention,
      supportingSources: Array.from(item.sources).filter(Boolean).sort(),
      evidenceCount: item.sources.size,
      confidenceScore: item.score,
    }));
  const credible = ranked.filter((item) =>
    Number(item.evidenceCount ?? 0) >= 2 || Number(item.confidenceScore ?? 0) >= 20
  );
  return credible.length ? credible : ranked.slice(0, 1);
};

export const ensureServiceProviderDisclosure = (
  text: string,
  serviceProviders: ServiceProviderMention[] = [],
) => {
  const report = String(text ?? "").trim();
  const provider = serviceProviders.find((item) => String(item?.name ?? "").trim());
  const providerName = String(provider?.name ?? "").trim();
  if (!report || !providerName || report.includes(providerName)) return report;
  // Sectional generation runs this correction for opening, evaluation and
  // closing fragments. Provider disclosure belongs in the project overview,
  // never after recommendations or attachments in a closing fragment.
  if (!/(?:一、\s*项目基本情况|项目基本情况|项目概况)/.test(report)) return report;

  const sourceNames = Array.from(new Set([
    provider?.sourceName,
    ...(provider?.supportingSources ?? []),
  ].map((item) => String(item ?? "").trim()).filter(Boolean))).slice(0, 3);
  const sourceText = sourceNames.length
    ? `，依据${sourceNames.map(formatSourceCitation).join("、")}`
    : "";
  const paragraph = `项目资料显示，项目相关服务商为${providerName}${sourceText}。具体服务范围、采购方式、合作期限及结算口径以对应原始文件载明内容为准。`;

  const headingPatterns = [
    /（三）\s*项目概况\s*/,
    /三、\s*项目概况\s*/,
    /3[.．、]\s*项目概况\s*/,
  ];
  for (const pattern of headingPatterns) {
    if (pattern.test(report)) {
      return report.replace(pattern, (heading) => `${heading}\n${paragraph}\n`);
    }
  }

  const nextSection = /(\n\s*（四）\s*项目绩效目标)/;
  if (nextSection.test(report)) {
    return report.replace(nextSection, `\n${paragraph}\n$1`);
  }

  return report;
};

const MATERIAL_CITATION_PATTERN =
  /(?:报告|方案|申报|申请|预算|测算|明细|目标|会议|纪要|意见|合同|清单|表|资料|附件|论证|可行性|实施|绩效|专家|评分|结算|询价|报价|制度|规定|规划|计划|文本)/;

const buildCitationLookup = (sourceNames: string[]) => {
  const lookup = new Map<string, string>();
  for (const name of sourceNames.map((item) => String(item ?? "").trim()).filter(Boolean)) {
    const base = name.replace(/\.(docx?|xlsx?|xlsm|xlsb|csv|pdf|png|jpe?g|txt)$/i, "");
    for (const alias of [name, base]) {
      const key = normalizeSourceKey(alias);
      if (key && !lookup.has(key)) lookup.set(key, name);
    }
  }
  return lookup;
};

export const rewriteProjectMaterialCitations = (
  text: string,
  sourceNames: string[] = [],
  sourceAliases: SourceAliasMap = {},
  sourceAliasCandidates: SourceAliasCandidates = {},
) => {
  const lookup = buildCitationLookup(sourceNames);
  const normalizedSources = sourceNames
    .map((name) => ({ name, key: normalizeSourceKey(name) }))
    .filter((item) => item.name && item.key);

  const resolveCanonical = (rawName: unknown) => {
    const name = String(rawName ?? "").trim();
    const key = normalizeSourceKey(name);
    const fuzzy = key.length >= 5
      ? normalizedSources
        .filter((item) => item.key.includes(key) || key.includes(item.key))
        .sort((left, right) => right.key.length - left.key.length)[0]
      : null;
    return lookup.get(key) || sourceAliases[key] || fuzzy?.name || "";
  };

  let output = String(text ?? "")
    // System records are valid first-party evidence, but they are not uploaded
    // files. Never present their former synthetic .docx names as attachments.
    .replace(
      /《会议纪要-(?:会议纪要：)?([^》]+?)(?:\.docx?)?》/gi,
      (_full, title) => `系统内已保存的“${String(title).replace(/\.docx?$/i, "")}”会议纪要`,
    )
    .replace(
      /《会议纪要：([^》]+?)(?:\.docx?)?》/gi,
      (_full, title) => `系统内已保存的“${String(title).replace(/\.docx?$/i, "")}”会议纪要`,
    )
    .replace(
      /《评估方案-(?:评估方案：)?([^》]+?)(?:\.docx?)?》/gi,
      (_full, title) => `系统内已保存的“${String(title).replace(/\.docx?$/i, "")}”评估方案`,
    )
    .replace(
      /《评估方案：([^》]+?)(?:\.docx?)?》/gi,
      (_full, title) => `系统内已保存的“${String(title).replace(/\.docx?$/i, "")}”评估方案`,
    );
  // Collapse malformed nested citations before resolving ordinary citations.
  for (let pass = 0; pass < 6 && /《[^《》]*《/.test(output); pass += 1) {
    output = output.replace(/《([^《》]*)《([^《》]+)》([^《》]*)》/g, (_full, before, inner, after) => {
      const combined = `${before}${inner}${after}`.trim();
      const canonical = resolveCanonical(combined) || resolveCanonical(inner);
      return canonical ? formatSourceCitation(canonical) : formatSourceCitation(inner);
    });
  }

  // Do the same for filenames that use Chinese quotation marks because their
  // literal filename already contains book-title brackets.
  for (let pass = 0; pass < 6 && /“[^“”]*“/.test(output); pass += 1) {
    output = output.replace(/“([^“”]*)“([^“”]+)”([^“”]*)”/g, (_full, before, inner, after) => {
      const combined = `${before}${inner}${after}`.trim();
      const canonical = resolveCanonical(combined) || resolveCanonical(inner);
      return canonical ? formatSourceCitation(canonical) : `“${inner}”`;
    });
  }

  const protectedCitations: string[] = [];
  output = output.replace(/“([^“”]{2,240})”/g, (full, rawName) => {
    const canonical = resolveCanonical(rawName);
    if (!canonical) return full;
    const token = `__SOURCE_CITATION_${protectedCitations.length}__`;
    protectedCitations.push(formatSourceCitation(canonical));
    return token;
  });

  output = output.replace(/《([^《》]{2,180})》/g, (full, rawName) => {
    const name = String(rawName ?? "").trim();
    const key = normalizeSourceKey(name);
    const canonical = resolveCanonical(name);
    if (canonical) return formatSourceCitation(canonical);
    const candidates = sourceAliasCandidates[key] ?? [];
    if (candidates.length) {
      return candidates.map(formatSourceCitation).join("、");
    }
    if (!MATERIAL_CITATION_PATTERN.test(name)) return full;
    if (
      /法律|法规|条例|办法|规定|预算法|政府采购法|档案法/.test(name)
      && !/(可行性研究报告|申报|申请|预算|测算|明细|目标|会议|纪要|意见|合同|清单|实施方案|绩效)/.test(name)
    ) {
      return full;
    }
    if (/会议|纪要|录音|转写/.test(name)) return "已形成的会议文字记录";
    return "已上传项目资料";
  });

  output = output
    .replace(/__SOURCE_CITATION_(\d+)__/g, (_full, index) =>
      protectedCitations[Number(index)] ?? _full
    )
    .replace(/已上传项目资料/g, "相关项目资料");
  return output;
};

export interface EvidenceCoverageFile {
  id?: string | null;
  title?: string | null;
  file_name?: string | null;
  category?: string | null;
  summary?: string | null;
  status?: string | null;
  chunk_count?: number | null;
  source_type?: string | null;
  source_id?: string | null;
  error_message?: string | null;
}

export interface EvidenceCoverageChunk {
  file_id?: string | null;
  chunk_index?: number | null;
  content?: string | null;
  fact_signals?: string[] | null;
  priority?: number | null;
}

export interface EvidenceCoverageItem {
  fileId: string;
  fileName: string;
  materialTitle: string;
  category: string;
  status: string;
  sourceType?: string | null;
  sourceId?: string | null;
  errorMessage?: string | null;
  indexedChunkCount: number;
  keyFacts: string[];
  excerpts: Array<{
    location: string;
    text: string;
  }>;
}

const compactEvidenceText = (value: unknown, max: number) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
};

const genericFactSignals = (value: unknown) => {
  const text = String(value ?? "");
  const patterns = [
    /[\u4e00-\u9fa5A-Za-z0-9（）()·-]{4,60}(?:股份有限公司|有限责任公司|有限公司)/g,
    /(?:人民币)?\s*\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元|万)/g,
    /\d[\d,]*(?:\.\d+)?\s*(?:标箱|非标箱|箱|件|份|个|套|人|户|天|月|年|小时|%|％)/g,
    /(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi,
    /20\d{2}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g,
    /(?:服务商|供应商|中标单位|成交单位|承接单位|受托单位|采购方式|询价|比价|单一来源)[^。\n；]{0,90}/g,
    /(?:目标值|达标率|完好率|准确率|响应率|满意度|投诉率|抽检合格率)[^。\n；]{0,70}/g,
  ];
  const facts: string[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const fact = compactEvidenceText(match[0], 120)
        .replace(/^(?:本项目|项目)?(?:服务商|供应商|中标单位|成交单位|承接单位|受托单位)?(?:由|为|是|：|:)+/, "")
        .trim();
      if (fact.length >= 3) facts.push(fact);
    }
  }
  return Array.from(new Set(facts.map((fact) => fact.toLowerCase())))
    .map((normalized) => facts.find((fact) => fact.toLowerCase() === normalized)!)
    .slice(0, 20);
};

const collectBalancedFacts = (
  chunks: EvidenceCoverageChunk[],
  allContent: string,
) => {
  const perChunkFacts = chunks.map((chunk) =>
    Array.from(new Set([
      ...(chunk.fact_signals ?? []),
      ...genericFactSignals(chunk.content),
    ].map((fact) => compactEvidenceText(fact, 120)).filter(Boolean)))
  );
  const balanced: string[] = [];
  const maxDepth = Math.max(0, ...perChunkFacts.map((facts) => facts.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const facts of perChunkFacts) {
      if (facts[depth]) balanced.push(facts[depth]);
    }
  }
  balanced.push(...genericFactSignals(allContent));
  return Array.from(new Set(balanced.map((fact) => fact.toLowerCase())))
    .map((normalized) => balanced.find((fact) => fact.toLowerCase() === normalized)!)
    .filter(Boolean);
};

const fitFactsToBudget = (facts: string[], maxCharacters: number) => {
  const selected: string[] = [];
  let used = 0;
  for (const fact of facts) {
    const next = used + fact.length + (selected.length ? 1 : 0);
    if (selected.length >= 4 && next > maxCharacters) continue;
    selected.push(fact);
    used = next;
    if (selected.length >= 18 || used >= maxCharacters) break;
  }
  return selected;
};

const evidenceChunkScore = (chunk: EvidenceCoverageChunk, position: number, total: number) => {
  const content = String(chunk.content ?? "");
  const keywordHits = content.match(
    /预算|金额|万元|单价|服务商|供应商|中标|合同|结算|询价|标准|DA\/T|GB\/T|目标值|标箱|实施|会议|意见|周期|风险|问题|建议/gi,
  )?.length ?? 0;
  return Number(chunk.priority ?? 0)
    + (chunk.fact_signals?.length ?? 0) * 4
    + Math.min(20, keywordHits * 2)
    + (position === 0 ? 8 : 0)
    + (position === total - 1 ? 3 : 0);
};

const pickCoverageChunks = (chunks: EvidenceCoverageChunk[], limit = 3) => {
  const ordered = chunks
    .filter((chunk) => String(chunk.content ?? "").trim())
    .slice()
    .sort((left, right) => Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0));
  if (!ordered.length) return [];

  const ranked = ordered
    .map((chunk, position) => ({
      chunk,
      score: evidenceChunkScore(chunk, position, ordered.length),
    }))
    .sort((left, right) =>
      right.score - left.score
      || Number(left.chunk.chunk_index ?? 0) - Number(right.chunk.chunk_index ?? 0)
    );

  const selected: EvidenceCoverageChunk[] = [ordered[0]];
  for (const row of ranked) {
    if (selected.includes(row.chunk)) continue;
    selected.push(row.chunk);
    if (selected.length >= limit) break;
  }
  return selected;
};

// 报告要论证的是预算、绩效目标、实施方案和采购，这些只存在于少数几份核心资料里。
// 法律条文、任命书、签到表这类文件篇幅可能很长，但对结论几乎没有信息量。
// 直接决定结论的资料：预算构成、绩效目标、实施与采购口径都出自这几类。
const DECISIVE_EVIDENCE = /申报书|绩效目标|预算|测算|明细|实施方案|可行性|论证|合同|结算|询价|报价|采购/;
// 佐证类：能支撑判断，但不是数字和口径的来源。
const SUPPORTING_EVIDENCE = /方案|评估报告|专家|会议|纪要|调研|意见/;
// 通用文本：法规和标准原文往往篇幅最长，对本项目结论几乎没有增量信息。
const GENERIC_EVIDENCE = /档案法|法律|法规|条例|办法|规范|标准|规定|通知|任命|签到|授权|承诺|执照|资质|证书/;

const evidenceWeight = (file: EvidenceCoverageFile) => {
  const label = `${file.title ?? ""} ${file.file_name ?? ""} ${file.category ?? ""}`;
  if (DECISIVE_EVIDENCE.test(label)) return 8;
  if (GENERIC_EVIDENCE.test(label)) return 1;
  if (SUPPORTING_EVIDENCE.test(label)) return 3;
  return 2;
};

export const buildPerFileEvidenceCoverage = (
  files: EvidenceCoverageFile[],
  chunks: EvidenceCoverageChunk[],
  options: { totalCharacters?: number; maxFiles?: number } = {},
): EvidenceCoverageItem[] => {
  const maxFiles = options.maxFiles ?? 160;
  const rows = (files ?? []).slice(0, maxFiles);
  const chunksByFile = new Map<string, EvidenceCoverageChunk[]>();
  for (const chunk of chunks ?? []) {
    const key = String(chunk.file_id ?? "");
    if (!key) continue;
    chunksByFile.set(key, [...(chunksByFile.get(key) ?? []), chunk]);
  }

  // 平均分配会让核心资料和无关文本拿到一样的篇幅：40 份资料时每份只剩几百字，
  // 一份十页的申报书只能进去约 8% 的正文，预算构成、环境效益这类论证依据直接被
  // 截断，模型据此写出“资料未提供”。按重要性加权后，核心资料能拿到数千字。
  const totalCharacters = Math.max(12000, options.totalCharacters ?? 24000);
  const contentLength = (file: EvidenceCoverageFile) =>
    (chunksByFile.get(String(file.id ?? "")) ?? [])
      .reduce((sum, chunk) => sum + String(chunk.content ?? "").length, 0);

  // 两轮分配：先按权重给份额，但不超过该文件实际拥有的正文量；短文件用不完的额度
  // 收回来，再按权重分给正文超出份额的文件。否则一堆几百字的小文件会各占一份大额度，
  // 真正需要篇幅的申报书反而不够用。
  const weights = new Map(rows.map((file) => [String(file.id ?? ""), evidenceWeight(file)]));
  const weightSum = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0) || 1;
  const budgets = new Map<string, number>();
  let leftover = 0;
  let hungryWeight = 0;
  for (const file of rows) {
    const id = String(file.id ?? "");
    const weight = weights.get(id) ?? 2;
    const share = Math.max(280, Math.floor((totalCharacters * weight) / weightSum));
    const needed = Math.max(280, contentLength(file));
    budgets.set(id, Math.min(share, needed));
    if (needed < share) leftover += share - needed;
    else hungryWeight += weight;
  }
  if (leftover > 0 && hungryWeight > 0) {
    for (const file of rows) {
      const id = String(file.id ?? "");
      const weight = weights.get(id) ?? 2;
      const current = budgets.get(id) ?? 280;
      if (current >= Math.max(280, contentLength(file))) continue;
      budgets.set(id, Math.min(
        Math.max(280, contentLength(file)),
        current + Math.floor((leftover * weight) / hungryWeight),
      ));
    }
  }
  const budgetFor = (file: EvidenceCoverageFile) =>
    Math.min(6000, budgets.get(String(file.id ?? "")) ?? 280);

  return rows.map((file) => {
    const perFileCharacters = budgetFor(file);
    const fileId = String(file.id ?? "");
    const fileName = sourceDisplayName(file);
    const materialTitle = String(file.title ?? "").trim();
    const fileChunks = (chunksByFile.get(fileId) ?? [])
      .slice()
      .sort((left, right) => Number(left.chunk_index ?? 0) - Number(right.chunk_index ?? 0));
    const allContent = [
      fileName,
      materialTitle,
      file.category,
      file.summary,
      ...fileChunks.map((chunk) => chunk.content),
    ].filter(Boolean).join("\n");
    const keyFacts = fitFactsToBudget(
      collectBalancedFacts(fileChunks, allContent),
      Math.max(180, Math.min(420, Math.floor(perFileCharacters * 0.48))),
    );
    const excerptBudget = Math.max(150, perFileCharacters - Math.min(260, keyFacts.join("、").length) - 120);
    // 摘录条数跟着预算走：预算大的资料多取几段，否则每段会被压到一两百字，
    // 金额、指标值这些恰好落在句子中后段的事实会被截掉。
    const excerptCount = Math.max(3, Math.min(8, Math.floor(excerptBudget / 420)));
    const selectedChunks = pickCoverageChunks(fileChunks, excerptCount);
    const excerpts = selectedChunks.length
      ? selectedChunks.map((chunk) => ({
        location: Number.isFinite(Number(chunk.chunk_index))
          ? `片段${Number(chunk.chunk_index) + 1}`
          : "正文片段",
        text: compactEvidenceText(chunk.content, Math.max(100, Math.floor(excerptBudget / selectedChunks.length))),
      }))
      : [{
        location: "资料摘要",
        text: compactEvidenceText(file.summary || materialTitle || fileName, excerptBudget),
      }];

    return {
      fileId,
      fileName,
      materialTitle,
      category: String(file.category ?? "项目资料"),
      status: String(file.status ?? "uploaded"),
      sourceType: file.source_type ?? null,
      sourceId: file.source_id ?? null,
      errorMessage: file.error_message ?? null,
      indexedChunkCount: fileChunks.length,
      keyFacts,
      excerpts,
    };
  });
};

export const formatPerFileEvidenceCoverage = (items: EvidenceCoverageItem[]) =>
  (items ?? []).map((item, index) => {
    const titleRelation = item.materialTitle
      && normalizeSourceKey(item.materialTitle) !== normalizeSourceKey(item.fileName)
      ? `；资料项：${item.materialTitle}`
      : "";
    const facts = item.keyFacts.length ? `；关键事实：${item.keyFacts.join("、")}` : "";
    const excerpts = item.excerpts
      .filter((excerpt) => excerpt.text)
      .map((excerpt) => `${excerpt.location}原文：${excerpt.text}`)
      .join("；");
    return `${index + 1}. ${formatSourceCitation(item.fileName)}[${item.category}｜${item.indexedChunkCount}片段${titleRelation}]${facts}${excerpts ? `；${excerpts}` : ""}`;
  }).join("\n");

const escapeRegularExpression = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatAuthoritativeScore = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "0.00";

const buildAuthoritativeIndicatorSentence = (
  indicator: AuthoritativeIndicatorScore,
  snapshot: AuthoritativeScoreSnapshot,
) => {
  const prefix = `当前系统汇总的${snapshot.expertCount}位专家评分显示，${indicator.name}平均得分为${formatAuthoritativeScore(indicator.average)}分（满分${formatAuthoritativeScore(indicator.maxAverage)}分）`;
  if (indicator.reasons.length) {
    return `${prefix}；当前评分记录中的扣分理由包括“${indicator.reasons.join("”“")}”。`;
  }
  if (indicator.average + 0.005 < indicator.maxAverage) {
    return `${prefix}；当前评分记录未填写具体扣分理由。`;
  }
  return `${prefix}；当前评分记录未显示该指标存在扣分。`;
};

/**
 * Current database scores are authoritative. Uploaded historical opinion
 * documents may still be cited for narrative context, but cannot override
 * the current aggregate score or attach stale deduction reasons to it.
 */
export const reconcileAuthoritativeScoreNarrative = (
  report: string,
  snapshot?: AuthoritativeScoreSnapshot | null,
) => {
  if (!snapshot?.indicators?.length || !String(report ?? "").trim()) return String(report ?? "");

  let output = String(report);
  for (const indicator of snapshot.indicators) {
    const name = escapeRegularExpression(indicator.name);
    const sentence = buildAuthoritativeIndicatorSentence(indicator, snapshot);
    const sentencePattern = new RegExp(
      `[^。；\\n]{0,48}${name}[^。；\\n]{0,70}(?:平均得分|得分为|得分)[^。；\\n]{0,100}[。；]?`,
      "g",
    );
    output = output.replace(sentencePattern, sentence);

    if (indicator.average + 0.005 >= indicator.maxAverage && !indicator.reasons.length) {
      const sectionPattern = new RegExp(
        `(（[一二三四五六七八九十]+）\\s*${name}[\\s\\S]*?)(?=\\n\\s*（[一二三四五六七八九十]+）|$)`,
      );
      output = output.replace(sectionPattern, (section) =>
        String(section)
          .replace(
            /(发现的问题[：:]\s*)(?:部分)?专家(?:评分摘要|评分|评议意见书|评议意见|意见)?(?:中)?(?:指出|认为|反映|提出)[：，,]?\s*/g,
            "$1当前系统评分未记录该指标扣分；从资料完整性角度仍需关注：",
          )
          .replace(
            /(?:部分)?专家(?:评分摘要|评分|评议意见书|评议意见|意见)?(?:中)?(?:指出|认为|反映|提出)[：，,]?\s*/g,
            "资料核验中仍需关注：",
          )
      );
    }
  }

  const totalSentence = `经${snapshot.expertCount}位专家评分汇总，本项目总平均得分为${formatAuthoritativeScore(snapshot.average)}分（满分${formatAuthoritativeScore(snapshot.maxAverage)}分）。`;
  output = output.replace(
    /经(?:专家组|[\d一二三四五六七八九十]+位专家)[^。\n]{0,40}(?:总平均得分|平均总分|平均得分)[^。\n]{0,60}。?/g,
    totalSentence,
  );

  return output;
};

import { isRichTextHtml, sanitizeRichText, textToEditableHtml } from "@/lib/richText";

export interface ReportCitationCandidate {
  text: string;
  sourceTitle: string;
  fileName?: string | null;
  category?: string | null;
  snippet?: string | null;
  location?: string | null;
}

export interface ReportCitationEvidence {
  text: string;
  source: string;
  snippet: string;
}

export interface ReportEvidenceCard {
  fileId?: string | null;
  sourceTitle: string;
  fileName?: string | null;
  category?: string | null;
  status: "referenced" | "available";
  matchedReportPhrases: string[];
  facts: string[];
  snippets: Array<{
    location: string;
    text: string;
    matchedTerms: string[];
  }>;
}

const normalizeSpace = (value: string) => value.replace(/\s+/g, " ").trim();

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

const extractLocalCitationPhrases = (text: string) => {
  const source = String(text ?? "");
  const patterns = [
    /《[^》]{4,80}》/g,
    /(?:DA\/T|DAT|GB\/T|GB|DB\d+\/T|ISO)\s*[\w\-./—－]+/gi,
    /(?:京|国|财|档|发改|社保)[\u4e00-\u9fa5]{0,10}(?:发|规|函|办|通)?[〔\[]?20\d{2}[〕\]]?\s*\d{1,5}\s*号/g,
    /(?:人民币)?\s*\d[\d,]*(?:\.\d+)?\s*(?:万元|元|万)/g,
    /\d[\d,]*(?:\.\d+)?\s*(?:标箱|箱|件|份|个|套|人|天|月|年|%|％)/g,
    /(?:预算金额|合同金额|结算金额|保管费|运输费|服务费|收费标准|单价|目标值|完好率|达标率|响应率|满意度)[^。；，\n]{0,36}/g,
    /(?:数量指标|质量指标|成本指标|进度指标|效益指标|满意度指标|可持续影响指标)[^。；，\n]{0,36}/g,
  ];

  const phrases: string[] = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = normalizeSpace(match[0] ?? "").replace(/^《|》$/g, "");
      if (value.length >= 3 && value.length <= 90) phrases.push(value);
    }
  }
  return uniqueBy(phrases, (item) => item.toLowerCase()).slice(0, 24);
};

const sourceLabel = (citation: ReportCitationCandidate) => [
  citation.fileName || citation.sourceTitle || "未命名资料",
  citation.location,
  citation.category,
].filter(Boolean).join(" · ");

const shouldSkipNode = (node: Node) => {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest("script,style,a,.report-citation,[data-report-citation='true']"));
};

export const hasReportCitations = (content: string) =>
  /data-report-citation=["']true["']/.test(content);

export const stripReportCitations = (content: string) => {
  if (!content.trim() || typeof DOMParser === "undefined" || !hasReportCitations(content)) return content;
  const doc = new DOMParser().parseFromString(sanitizeRichText(content), "text/html");
  for (const node of Array.from(doc.querySelectorAll<HTMLElement>("[data-report-citation='true']"))) {
    node.replaceWith(doc.createTextNode(node.textContent ?? ""));
  }
  return sanitizeRichText(doc.body.innerHTML);
};

export const extractReportCitationEvidence = (content: string): ReportCitationEvidence[] => {
  if (!content.trim() || typeof DOMParser === "undefined" || !hasReportCitations(content)) return [];
  const doc = new DOMParser().parseFromString(sanitizeRichText(content), "text/html");
  return uniqueBy(
    Array.from(doc.querySelectorAll<HTMLElement>("[data-report-citation='true']"))
      .map((node) => ({
        text: normalizeSpace(node.textContent ?? ""),
        source: normalizeSpace(node.getAttribute("data-source") ?? ""),
        snippet: normalizeSpace(node.getAttribute("data-snippet") ?? ""),
      }))
      .filter((item) => item.text && item.source),
    (item) => `${item.text}::${item.source}`,
  );
};

export const citationCandidatesToEvidence = (citations: ReportCitationCandidate[]): ReportCitationEvidence[] =>
  uniqueBy(
    citations.map((citation) => ({
      text: normalizeSpace(citation.text ?? ""),
      source: sourceLabel(citation),
      snippet: normalizeSpace(citation.snippet ?? ""),
    })).filter((item) => item.text && item.source),
    (item) => `${item.text}::${item.source}`,
  );

export const buildLocalReportCitations = (
  content: string,
  files: any[],
  chunks: any[],
  limit = 90,
): ReportCitationCandidate[] => {
  const reportText = normalizeSpace(content);
  if (!reportText) return [];
  const fileMap = new Map((files ?? []).map((file: any) => [file.id, file]));
  const candidates: Array<ReportCitationCandidate & { score: number }> = [];

  const add = (phrase: string, row: any, scoreBoost = 0) => {
    const text = normalizeSpace(phrase).replace(/^《|》$/g, "");
    if (text.length < 3 || text.length > 90 || !reportText.includes(text)) return;
    const file = row.file_id ? fileMap.get(row.file_id) ?? {} : row;
    const sourceTitle = file.file_name || file.title || row.file_name || row.title || "未命名资料";
    candidates.push({
      text,
      sourceTitle,
      fileName: file.file_name ?? row.file_name ?? null,
      category: file.category ?? row.category ?? null,
      snippet: normalizeSpace(row.content || file.summary || sourceTitle).slice(0, 240),
      location: Number.isFinite(Number(row.chunk_index)) ? `片段 ${Number(row.chunk_index) + 1}` : "资料摘要",
      score: text.length + scoreBoost,
    });
  };

  for (const chunk of chunks ?? []) {
    const file = fileMap.get(chunk.file_id) ?? {};
    const searchable = [file.title, file.file_name, file.category, file.summary, chunk.content].filter(Boolean).join(" ");
    for (const phrase of extractLocalCitationPhrases(searchable)) add(phrase, chunk, 18);
  }

  for (const file of files ?? []) {
    const title = file.file_name || file.title || "";
    if (title) add(title, file, 10);
    for (const phrase of extractLocalCitationPhrases([title, file.category, file.summary].filter(Boolean).join(" "))) {
      add(phrase, file, 8);
    }
  }

  return uniqueBy(
    candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length).slice(0, limit),
    (item) => `${item.text.toLowerCase()}::${item.sourceTitle}`,
  ).map(({ score: _score, ...item }) => item);
};

const textTokens = (text: string) =>
  Array.from(new Set(
    String(text ?? "")
      .toLowerCase()
      .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) ?? [],
  )).filter((token) => !["项目", "资料", "评估", "报告", "情况", "相关", "内容"].includes(token));

const matchedTermsFor = (tokens: string[], content: string) => {
  const lower = String(content ?? "").toLowerCase();
  return tokens.filter((token) => lower.includes(token)).slice(0, 10);
};

export const buildLocalReportEvidenceCards = (
  content: string,
  files: any[],
  chunks: any[],
  limit = 120,
): ReportEvidenceCard[] => {
  const reportText = normalizeSpace(content);
  const reportTokens = textTokens(reportText);
  const chunksByFile = new Map<string, any[]>();
  for (const chunk of chunks ?? []) {
    const key = String(chunk.file_id ?? "");
    if (!key) continue;
    const current = chunksByFile.get(key) ?? [];
    current.push(chunk);
    chunksByFile.set(key, current);
  }

  return (files ?? [])
    .map((file: any) => {
      const sourceTitle = file.file_name || file.title || "未命名资料";
      const fileChunks = (chunksByFile.get(String(file.id)) ?? []).map((chunk: any) => {
        const searchable = [sourceTitle, file.file_name, file.category, file.summary, chunk.content].filter(Boolean).join(" ");
        const phrases = extractLocalCitationPhrases(searchable);
        const matchedReportPhrases = phrases.filter((phrase) => reportText.includes(normalizeSpace(phrase)));
        const matchedTerms = matchedTermsFor(reportTokens, searchable);
        const score = matchedReportPhrases.length * 25 + matchedTerms.length * 4 + Number(chunk.chunk_index === 0 ? 3 : 0);
        return { ...chunk, matchedReportPhrases, matchedTerms, score };
      });
      const sortedChunks = fileChunks
        .filter((chunk: any) => String(chunk.content ?? "").trim())
        .sort((a: any, b: any) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(a.chunk_index ?? 0) - Number(b.chunk_index ?? 0));
      const selectedChunks = sortedChunks.slice(0, 3);
      const matchedReportPhrases = uniqueBy(
        selectedChunks.flatMap((chunk: any) => chunk.matchedReportPhrases ?? []),
        (item) => item.toLowerCase(),
      ).slice(0, 12);
      const facts = uniqueBy(
        extractLocalCitationPhrases([sourceTitle, file.category, file.summary, ...selectedChunks.map((chunk: any) => chunk.content)].filter(Boolean).join(" ")),
        (item) => item.toLowerCase(),
      ).slice(0, 16);
      const snippets = selectedChunks.length
        ? selectedChunks.map((chunk: any) => ({
          location: Number.isFinite(Number(chunk.chunk_index)) ? `片段 ${Number(chunk.chunk_index) + 1}` : "资料摘要",
          text: normalizeSpace(chunk.content ?? "").slice(0, 520),
          matchedTerms: chunk.matchedTerms ?? [],
        }))
        : [{
          location: "资料摘要",
          text: normalizeSpace(file.summary || sourceTitle).slice(0, 520),
          matchedTerms: matchedTermsFor(reportTokens, [file.summary, sourceTitle].filter(Boolean).join(" ")),
        }];
      const status = matchedReportPhrases.length || snippets.some((snippet) => snippet.matchedTerms.length >= 2)
        ? "referenced"
        : "available";
      return {
        fileId: file.id ?? null,
        sourceTitle,
        fileName: file.file_name ?? null,
        category: file.category ?? null,
        status,
        matchedReportPhrases,
        facts,
        snippets,
      } satisfies ReportEvidenceCard;
    })
    .sort((a, b) =>
      (a.status === "referenced" ? -1 : 1) - (b.status === "referenced" ? -1 : 1)
      || b.matchedReportPhrases.length - a.matchedReportPhrases.length
      || b.facts.length - a.facts.length
      || a.sourceTitle.localeCompare(b.sourceTitle, "zh-CN")
    )
    .slice(0, limit);
};

export const applyReportCitations = (
  content: string,
  citations: ReportCitationCandidate[],
) => {
  if (!content.trim() || !citations.length || typeof DOMParser === "undefined") return content;

  const html = isRichTextHtml(content) ? sanitizeRichText(content) : textToEditableHtml(content);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sorted = citations
    .map((item) => ({ ...item, text: normalizeSpace(item.text ?? "") }))
    .filter((item) => item.text.length >= 3)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 120);

  const used = new Set<string>();

  for (const citation of sorted) {
    const key = `${citation.text}::${citation.sourceTitle}`;
    if (used.has(key)) continue;

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (!shouldSkipNode(node)) {
        const text = node.textContent ?? "";
        const index = text.indexOf(citation.text);
        if (index >= 0) {
          const parent = node.parentNode;
          if (!parent) break;

          const before = text.slice(0, index);
          const matched = text.slice(index, index + citation.text.length);
          const after = text.slice(index + citation.text.length);
          const mark = doc.createElement("span");
          mark.setAttribute("data-report-citation", "true");
          mark.setAttribute("data-source", sourceLabel(citation));
          mark.setAttribute("data-snippet", normalizeSpace(citation.snippet ?? ""));
          const snippet = normalizeSpace(citation.snippet ?? "");
          mark.setAttribute("title", `出处：${sourceLabel(citation)}${snippet ? `\n原文：${snippet}` : ""}`);
          mark.className = "report-citation";
          mark.textContent = matched;

          if (before) parent.insertBefore(doc.createTextNode(before), node);
          parent.insertBefore(mark, node);
          if (after) parent.insertBefore(doc.createTextNode(after), node);
          parent.removeChild(node);
          used.add(key);
          break;
        }
      }
      node = walker.nextNode();
    }
  }

  return sanitizeRichText(doc.body.innerHTML);
};

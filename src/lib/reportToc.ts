import { isRichTextHtml, richTextToPlainText, sanitizeRichText } from "./richText";

export interface ReportTocEntry {
  text: string;
  level: 1 | 2;
}

const normalizeHeadingText = (value: string) =>
  value
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const parseHeading = (raw: string, hintedLevel?: 1 | 2): ReportTocEntry | null => {
  const text = normalizeHeadingText(raw);
  if (!text) return null;

  if (hintedLevel === 1 && /^[一二三四五六七八九十]+、/.test(text)) {
    return { text, level: 1 };
  }
  if (hintedLevel === 2 && /^（[一二三四五六七八九十]+）/.test(text)) {
    return { text, level: 2 };
  }
  if (/^[一二三四五六七八九十]+、/.test(text)) {
    return { text, level: 1 };
  }
  if (/^（[一二三四五六七八九十]+）/.test(text)) {
    return { text, level: 2 };
  }
  return null;
};

export const extractReportTocEntries = (content: string): ReportTocEntry[] => {
  if (!content.trim()) return [];

  const seen = new Set<string>();
  const entries: ReportTocEntry[] = [];
  const pushEntry = (candidate: ReportTocEntry | null) => {
    if (!candidate || seen.has(candidate.text)) return;
    seen.add(candidate.text);
    entries.push(candidate);
  };

  if (isRichTextHtml(content)) {
    const doc = new DOMParser().parseFromString(sanitizeRichText(content), "text/html");
    doc.querySelectorAll("h1,h2,p").forEach((node) => {
      const hintedLevel =
        node.tagName === "H1" ? 1 : node.tagName === "H2" ? 2 : undefined;
      pushEntry(parseHeading(node.textContent ?? "", hintedLevel));
    });
    if (entries.length) return entries;
  }

  richTextToPlainText(content)
    .split(/\n+/)
    .forEach((line) => pushEntry(parseHeading(line)));

  return entries;
};

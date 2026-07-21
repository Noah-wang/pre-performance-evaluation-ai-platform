import { isRichTextHtml, plainTextToHtml, sanitizeRichText } from "@/lib/richText";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const wrapDocument = (title: string, body: string) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 25mm 24mm; }
  body { font-family: SimSun, serif; font-size: 12pt; line-height: 1.8; color: #111; }
  .doc-title { font-family: SimHei, sans-serif; font-size: 18pt; text-align: center; margin: 0 0 24pt; }
  h1 { font-family: SimHei, sans-serif; font-size: 14pt; font-weight: bold; margin: 18pt 0 8pt; }
  h2 { font-family: SimHei, sans-serif; font-size: 13pt; font-weight: bold; margin: 14pt 0 6pt; }
  h3, h4, h5, h6 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt; }
  p { margin: 5pt 0; text-align: justify; }
  ul, ol { margin: 6pt 0 8pt 24pt; padding-left: 18pt; }
  li { margin: 3pt 0; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3pt solid #999; color: #333; }
  pre { font-family: "Courier New", monospace; font-size: 10pt; background: #f3f3f3; padding: 8pt; }
  code { font-family: "Courier New", monospace; }
  table { width: 100%; border-collapse: collapse; margin: 12pt 0; }
  th, td { border: 1px solid #333; padding: 6pt; vertical-align: top; }
  th { font-weight: bold; background: #f2f2f2; text-align: center; }
</style>
</head>
<body>
<h1 class="doc-title">${escapeHtml(title)}</h1>
${body}
</body>
</html>`;

const inlineMarkdownToHtml = (value: string) => {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
};

const isMarkdownTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const splitMarkdownTableRow = (line: string) => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
};

const markdownTableToHtml = (rows: string[][]) => {
  if (!rows.length) return "";
  const [headers, ...body] = rows;
  const headerHtml = `<tr>${headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr>`;
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table>`;
};

const renderParagraph = (line: string) => {
  if (/^[一二三四五六七八九十]+、/.test(line)) return `<h1>${inlineMarkdownToHtml(line)}</h1>`;
  if (/^（[一二三四五六七八九十]+）/.test(line)) return `<h2>${inlineMarkdownToHtml(line)}</h2>`;
  if (/^\d+\./.test(line)) return `<h3>${inlineMarkdownToHtml(line)}</h3>`;
  if (/^（\d+）/.test(line)) return `<h4>${inlineMarkdownToHtml(line)}</h4>`;
  return `<p>${inlineMarkdownToHtml(line)}</p>`;
};

const markdownToHtml = (value: string) => {
  if (!value.trim()) return "";
  if (isRichTextHtml(value)) return sanitizeRichText(value);

  const lines = value.replace(/\r/g, "").split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test((lines[i] ?? "").trim())) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isMarkdownTableSeparator(lines[i + 1] ?? "")) {
      const rows: string[][] = [splitMarkdownTableRow(line)];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().includes("|")) {
        rows.push(splitMarkdownTableRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push(markdownTableToHtml(rows));
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      const level = Math.min(match?.[1].length ?? 1, 6);
      blocks.push(`<h${level}>${inlineMarkdownToHtml(match?.[2] ?? line)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push(`<li>${inlineMarkdownToHtml((lines[i] ?? "").replace(/^\s*[-*+]\s+/, "").trim())}</li>`);
        i += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) {
        items.push(`<li>${inlineMarkdownToHtml((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, "").trim())}</li>`);
        i += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trim())) {
        quote.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(`<blockquote>${quote.map((item) => `<p>${inlineMarkdownToHtml(item)}</p>`).join("")}</blockquote>`);
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (
      i < lines.length
      && (lines[i] ?? "").trim()
      && !/^```/.test((lines[i] ?? "").trim())
      && !/^#{1,6}\s+/.test((lines[i] ?? "").trim())
      && !/^\s*[-*+]\s+/.test(lines[i] ?? "")
      && !/^\s*\d+[.)]\s+/.test(lines[i] ?? "")
      && !/^>\s?/.test((lines[i] ?? "").trim())
      && !(i + 1 < lines.length && (lines[i] ?? "").trim().includes("|") && isMarkdownTableSeparator(lines[i + 1] ?? ""))
    ) {
      paragraphLines.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push(renderParagraph(paragraphLines.join(" ")));
  }

  return sanitizeRichText(blocks.join(""));
};

export const enableDocxFieldUpdates = async (blob: Blob): Promise<Blob> => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(blob);
  const settingsFile = zip.file("word/settings.xml");
  if (settingsFile) {
    const settingsXml = await settingsFile.async("string");
    if (!settingsXml.includes("<w:updateFields")) {
      zip.file(
        "word/settings.xml",
        settingsXml.replace("</w:settings>", '<w:updateFields w:val="true"/></w:settings>'),
      );
    }
  } else {
    zip.file(
      "word/settings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:updateFields w:val="true"/>
</w:settings>`,
    );
    const relsFile = zip.file("word/_rels/document.xml.rels");
    if (relsFile) {
      const relsXml = await relsFile.async("string");
      zip.file(
        "word/_rels/document.xml.rels",
        relsXml.replace(
          "</Relationships>",
          '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        ),
      );
    }
    const contentTypesFile = zip.file("[Content_Types].xml");
    if (contentTypesFile) {
      const contentTypesXml = await contentTypesFile.async("string");
      zip.file(
        "[Content_Types].xml",
        contentTypesXml.replace(
          "</Types>",
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        ),
      );
    }
  }
  return zip.generateAsync({ type: "blob" });
};

export const createTextDocxBlob = async (title: string, text: string): Promise<Blob> => {
  const { asBlob } = await import("html-docx-js-typescript");
  const html = /(^|\n)\s{0,3}#{1,6}\s+|(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*\||(^|\n)\s*[-*+]\s+|(^|\n)\s*\d+[.)]\s+|`|\*\*|__/.test(text)
    ? markdownToHtml(text)
    : plainTextToHtml(text);
  const blob = await asBlob(wrapDocument(title, html)) as Blob;
  return enableDocxFieldUpdates(blob);
};

export const createRichDocxBlob = async (title: string, html: string): Promise<Blob> => {
  const { asBlob } = await import("html-docx-js-typescript");
  const blob = await asBlob(wrapDocument(title, sanitizeRichText(html))) as Blob;
  return enableDocxFieldUpdates(blob);
};

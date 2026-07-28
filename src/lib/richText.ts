import DOMPurify from "dompurify";

export const isRichTextHtml = (value: string) =>
  /<(p|h[1-6]|table|img|ul|ol|blockquote)\b/i.test(value);

export const plainTextToHtml = (value: string) => {
  if (!value.trim()) return "";
  if (isRichTextHtml(value)) return value;

  return value
    .replace(/\r/g, "")
    .split(/\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return "<p></p>";
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (/^[一二三四五六七八九十]+、/.test(line)) return `<h1>${escaped}</h1>`;
      if (/^（[一二三四五六七八九十]+）/.test(line)) return `<h2>${escaped}</h2>`;
      if (/^\d+\./.test(line)) return `<h3>${escaped}</h3>`;
      if (/^（\d+）/.test(line)) return `<h4>${escaped}</h4>`;
      return `<p>${escaped}</p>`;
    })
    .join("");
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inlineMarkdownToHtml = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

const isMarkdownTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const splitMarkdownTableRow = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

export const markdownToRichHtml = (value: string) => {
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

    if (i + 1 < lines.length && line.includes("|") && isMarkdownTableSeparator(lines[i + 1] ?? "")) {
      const rows = [splitMarkdownTableRow(line)];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().includes("|")) {
        rows.push(splitMarkdownTableRow(lines[i] ?? ""));
        i += 1;
      }
      const [headers, ...body] = rows;
      blocks.push([
        "<table><tbody>",
        `<tr>${headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr>`,
        body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`).join(""),
        "</tbody></table>",
      ].join(""));
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      const level = Math.min(match?.[1].length ?? 1, 4);
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

    if (/^```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test((lines[i] ?? "").trim())) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const paragraphLines = [line];
    i += 1;
    while (
      i < lines.length
      && (lines[i] ?? "").trim()
      && !/^#{1,6}\s+/.test((lines[i] ?? "").trim())
      && !/^\s*[-*+]\s+/.test(lines[i] ?? "")
      && !/^\s*\d+[.)]\s+/.test(lines[i] ?? "")
      && !/^>\s?/.test((lines[i] ?? "").trim())
      && !/^```/.test((lines[i] ?? "").trim())
      && !(i + 1 < lines.length && (lines[i] ?? "").trim().includes("|") && isMarkdownTableSeparator(lines[i + 1] ?? ""))
    ) {
      paragraphLines.push((lines[i] ?? "").trim());
      i += 1;
    }

    const paragraph = paragraphLines.join(" ");
    if (/^[一二三四五六七八九十]+、/.test(paragraph)) blocks.push(`<h1>${inlineMarkdownToHtml(paragraph)}</h1>`);
    else if (/^（[一二三四五六七八九十]+）/.test(paragraph)) blocks.push(`<h2>${inlineMarkdownToHtml(paragraph)}</h2>`);
    else if (/^\d+\./.test(paragraph)) blocks.push(`<h3>${inlineMarkdownToHtml(paragraph)}</h3>`);
    else if (/^（\d+）/.test(paragraph)) blocks.push(`<h4>${inlineMarkdownToHtml(paragraph)}</h4>`);
    else blocks.push(`<p>${inlineMarkdownToHtml(paragraph)}</p>`);
  }

  return sanitizeRichText(blocks.join(""));
};

export const textToEditableHtml = (value: string) => {
  if (!value.trim()) return "";
  if (isRichTextHtml(value)) return sanitizeRichText(value);
  return /(^|\n)\s{0,3}#{1,6}\s+|(^|\n)\s*\|.+\|\s*\n\s*\|?\s*:?-{3,}:?\s*\||(^|\n)\s*[-*+]\s+|(^|\n)\s*\d+[.)]\s+|`|\*\*|__/.test(value)
    ? markdownToRichHtml(value)
    : plainTextToHtml(value);
};

export const sanitizeRichText = (value: string) =>
  DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["style", "class", "title", "colspan", "rowspan", "data-report-citation", "data-source", "data-snippet"],
    ALLOW_DATA_ATTR: true,
  });

export const richTextToPlainText = (value: string) => {
  if (!isRichTextHtml(value)) return value;
  const doc = new DOMParser().parseFromString(sanitizeRichText(value), "text/html");
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr,blockquote").forEach((node) => {
    node.append("\n");
  });
  return doc.body.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
};

const blockSelector = "p,h1,h2,h3,h4,h5,h6,li,blockquote";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const flexibleTextPattern = (value: string) => {
  const tokens = value.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  return tokens.length ? new RegExp(tokens.join("\\s+"), "m") : null;
};

export const replacePlainTextInHtml = (
  html: string,
  targetText: string,
  replacementText: string,
): { html: string; replaced: boolean } => {
  const target = targetText.trim();
  const replacement = replacementText.trim();
  if (!target || !replacement) return { html, replaced: false };

  if (!isRichTextHtml(html)) {
    const pattern = flexibleTextPattern(target);
    if (!pattern?.test(html)) return { html, replaced: false };
    return { html: html.replace(pattern, replacement), replaced: true };
  }

  const doc = new DOMParser().parseFromString(sanitizeRichText(html), "text/html");
  const blocks = Array.from(doc.body.querySelectorAll<HTMLElement>(blockSelector));
  const targetCompact = target.replace(/\s+/g, "");
  const pattern = flexibleTextPattern(target);

  for (const block of blocks) {
    const blockText = block.textContent?.trim() ?? "";
    if (!blockText) continue;

    const blockCompact = blockText.replace(/\s+/g, "");
    const containsTarget = pattern?.test(blockText) || blockCompact.includes(targetCompact);
    if (!containsTarget) continue;

    const replaceWholeBlock = targetCompact.length >= Math.max(12, Math.floor(blockCompact.length * 0.65));
    if (replaceWholeBlock) {
      block.outerHTML = textToEditableHtml(replacement);
    } else if (pattern?.test(blockText)) {
      block.textContent = blockText.replace(pattern, replacement);
    } else {
      block.textContent = replacement;
    }

    return { html: sanitizeRichText(doc.body.innerHTML), replaced: true };
  }

  return { html, replaced: false };
};

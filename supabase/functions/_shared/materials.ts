import JSZip from "npm:jszip@3.10.1";
import XLSX from "npm:xlsx@0.18.5";

const envNumber = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number(Deno.env.get(name) ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const extractTextMaxChars = () => envNumber("EXTRACT_TEXT_MAX_CHARS", 120000, 12000, 500000);
const sheetExtractMaxRows = () => envNumber("SHEET_EXTRACT_MAX_ROWS", 2000, 100, 50000);
const documentExtractorMaxPages = () => envNumber("DOCUMENT_EXTRACTOR_MAX_PAGES", 35, 1, 200);
const documentExtractorTimeBudgetSeconds = () => envNumber("DOCUMENT_EXTRACTOR_TIME_BUDGET_SECONDS", 80, 10, 240);

export const compactText = (value: string, maxChars = extractTextMaxChars()) =>
  value
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);

const PLAIN_TEXT_EXT = /\.(txt|md|csv|json|xml|html?)$/i;
const DOCX_EXT = /\.docx$/i;
const SHEET_EXT = /\.(xlsx|xls|xlsm|xlsb)$/i;
const DOCUMENT_EXTRACTOR_EXT = /\.(pdf|png|jpe?g|webp|bmp|tif?f|doc|docx|docm|dot|dotx|ppt|pptx)$/i;

export const isSupportedKnowledgeFile = (fileName = "") =>
  /\.(txt|md|csv|json|xml|html?|doc|docx|docm|dot|dotx|xls|xlsx|xlsm|xlsb|ppt|pptx|pdf|png|jpe?g|webp|bmp|tif?f)$/i
    .test(fileName);

const toBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export interface ExtractionProgress {
  totalPages: number | null;
  nextStartPage: number | null;
}

const requestLocalOcr = async (
  blob: Blob,
  fileName: string,
  startPage = 0,
): Promise<{ text: string; progress: ExtractionProgress }> => {
  const empty: ExtractionProgress = { totalPages: null, nextStartPage: null };
  if (Deno.env.get("ENABLE_DOCUMENT_EXTRACTOR") !== "true") return { text: "", progress: empty };

  const baseUrl = (Deno.env.get("DOCUMENT_EXTRACTOR_BASE_URL") || Deno.env.get("LOCAL_OCR_BASE_URL"))?.trim();
  if (!baseUrl) return { text: "", progress: empty };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("document extraction timeout"),
    envNumber("DOCUMENT_EXTRACTOR_TIMEOUT_MS", 120000, 10000, 300000),
  );

  let response: Response | null = null;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        fileName,
        mimeType: blob.type || "application/octet-stream",
        fileBase64: toBase64(await blob.arrayBuffer()),
        maxChars: extractTextMaxChars(),
        maxPages: documentExtractorMaxPages(),
        timeBudgetSeconds: documentExtractorTimeBudgetSeconds(),
        startPage,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) {
    throw new Error(`DOCUMENT_EXTRACTOR ${response?.status ?? "NO_RESPONSE"}`);
  }
  const json = await response.json().catch(() => ({}));
  return {
    text: compactText(String(json.text ?? json.result ?? json.content ?? json.data?.text ?? "")),
    progress: {
      totalPages: Number.isFinite(Number(json.totalPages)) ? Number(json.totalPages) : null,
      nextStartPage: Number.isFinite(Number(json.nextStartPage)) ? Number(json.nextStartPage) : null,
    },
  };
};

export const extractBlobText = async (
  blob: Blob,
  fileName: string,
  fallback = "",
  startPage = 0,
): Promise<{ text: string; progress: ExtractionProgress }> => {
  const done: ExtractionProgress = { totalPages: null, nextStartPage: null };
  if (PLAIN_TEXT_EXT.test(fileName)) {
    return { text: compactText(await blob.text()), progress: done };
  }
  if (DOCX_EXT.test(fileName)) {
    try {
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const xml = await zip.file("word/document.xml")?.async("string");
      if (xml) {
        const text = xml
          .replace(/<w:tab\/>/g, " ")
          .replace(/<\/w:p>/g, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">");
        const compacted = compactText(text);
        if (compacted) return { text: compacted, progress: done };
      }
    } catch (error) {
      console.warn("docx text extraction failed", fileName, error);
    }
  }
  if (SHEET_EXT.test(fileName)) {
    try {
      const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array", dense: true });
      const lines: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        lines.push(`[工作表] ${sheetName}`);
        const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
          header: 1,
          defval: "",
          raw: false,
        });
        for (const row of rows.slice(0, sheetExtractMaxRows())) {
          const cells = row
            .map((cell) => String(cell ?? "").trim())
            .filter(Boolean);
          if (cells.length) lines.push(cells.join(" | "));
        }
      }
      if (lines.length) return { text: compactText(lines.join("\n")), progress: done };
    } catch (error) {
      console.warn("sheet text extraction failed", fileName, error);
    }
  }

  if (DOCUMENT_EXTRACTOR_EXT.test(fileName) || SHEET_EXT.test(fileName)) {
    try {
      const extracted = await requestLocalOcr(blob, fileName, startPage);
      if (extracted.text) return extracted;
    } catch (error) {
      console.warn("document extractor failed", fileName, error);
      throw new Error(`文档解析失败：${String((error as { message?: unknown })?.message ?? error)}`);
    }
    return { text: "", progress: done };
  }

  return { text: compactText(fallback), progress: done };
};

export const extractMaterialText = async (
  supabase: any,
  material: {
    id?: string;
    file_path?: string | null;
    file_name?: string | null;
    review_note?: string | null;
  },
) => {
  const fallback = compactText(material.review_note ?? "");
  if (!material.file_path) return fallback;
  try {
    const { data, error } = await supabase.storage.from("project-materials").download(material.file_path);
    if (error || !data) return fallback;
    const fileName = String(material.file_name ?? material.file_path).toLowerCase();
    return (await extractBlobText(data, fileName, fallback)).text;
  } catch (error) {
    console.warn("material text extraction failed", material.id ?? material.file_path, error);
    return fallback;
  }
};

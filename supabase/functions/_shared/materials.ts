import JSZip from "npm:jszip@3.10.1";
import XLSX from "npm:xlsx@0.18.5";

export const compactText = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 12000);

const OFFICE_FALLBACK_EXT = /\.(doc|docm|dot|dotx|xls|xlsx|xlsm|xlsb|csv|ppt|pptx)$/i;

const toBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const requestLocalOcr = async (blob: Blob, fileName: string) => {
  const baseUrl = Deno.env.get("LOCAL_OCR_BASE_URL")?.trim();
  if (!baseUrl) return "";

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      mimeType: blob.type || "application/octet-stream",
      fileBase64: toBase64(await blob.arrayBuffer()),
    }),
  });
  if (!response.ok) {
    throw new Error(`LOCAL_OCR ${response.status}`);
  }
  const json = await response.json().catch(() => ({}));
  return compactText(String(json.text ?? json.result ?? json.content ?? ""));
};

export const extractBlobText = async (blob: Blob, fileName: string, fallback = "") => {
  if (/\.(txt|md|csv|json|xml|html?)$/i.test(fileName)) {
    return compactText(await blob.text());
  }
  if (/\.docx$/i.test(fileName)) {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return compactText(fallback);
    const text = xml
      .replace(/<w:tab\/>/g, " ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    return compactText(text);
  }
  if (/\.(xlsx|xls|xlsm|xlsb)$/i.test(fileName)) {
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
        for (const row of rows.slice(0, 200)) {
          const cells = row
            .map((cell) => String(cell ?? "").trim())
            .filter(Boolean);
          if (cells.length) lines.push(cells.join(" | "));
        }
      }
      if (lines.length) return compactText(lines.join("\n"));
    } catch (error) {
      console.warn("sheet text extraction failed", fileName, error);
    }
  }
  if (/\.(pdf|png|jpe?g|webp|bmp|tif?f)$/i.test(fileName)) {
    try {
      const ocrText = await requestLocalOcr(blob, fileName);
      if (ocrText) return ocrText;
    } catch (error) {
      console.warn("local OCR failed", fileName, error);
    }
  }
  if (OFFICE_FALLBACK_EXT.test(fileName)) {
    try {
      const officeText = await requestLocalOcr(blob, fileName);
      if (officeText) return officeText;
    } catch (error) {
      console.warn("office fallback extraction failed", fileName, error);
    }
  }
  return compactText(fallback);
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
    return await extractBlobText(data, fileName, fallback);
  } catch (error) {
    console.warn("material text extraction failed", material.id ?? material.file_path, error);
    return fallback;
  }
};

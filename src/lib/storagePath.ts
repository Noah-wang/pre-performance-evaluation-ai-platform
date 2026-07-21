const splitExtension = (value: string) => {
  const trimmed = value.trim();
  const index = trimmed.lastIndexOf(".");
  if (index <= 0 || index === trimmed.length - 1) return { base: trimmed, ext: "" };
  return {
    base: trimmed.slice(0, index),
    ext: trimmed.slice(index + 1),
  };
};

const sanitizeSegment = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|_+$/g, "");
  return normalized;
};

export const safeStorageFileName = (value: string, fallback = "file") => {
  const { base, ext } = splitExtension(value || fallback);
  const safeBase = sanitizeSegment(base).slice(0, 80) || fallback;
  const safeExt = sanitizeSegment(ext).slice(0, 16).toLowerCase();
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
};

export const sanitizeDownloadFileName = (value?: string | null, fallback = "下载文件") => {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
};

export const downloadBlobFromUrl = async (url: string, fileName?: string | null, fallback = "下载文件") => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败：${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = sanitizeDownloadFileName(fileName, fallback);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
};

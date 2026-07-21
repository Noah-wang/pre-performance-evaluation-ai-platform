// 现场照片硬水印烧录 — 把 GPS / 时间 / 用户信息绘制到右下角
// 输出 JPEG Blob（保持画质 0.92）。同时返回提取的基础 EXIF（如果可读）

export interface BurnOptions {
  gpsLng?: number | null;
  gpsLat?: number | null;
  takenAt?: Date;
  userLabel: string;
  projectLabel?: string;
  locationLabel?: string;
}

export interface BurnResult {
  blob: Blob;
  exif: {
    width: number;
    height: number;
    sourceType: string;
    sourceSize: number;
    burnedAt: string;
  };
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });

const fmt = (n: number) => n.toFixed(6);

export const burnWatermark = async (file: File, opts: BurnOptions): Promise<BurnResult> => {
  const img = await loadImage(file);
  // 限制最大边 2048，避免内存与上传过大
  const MAX = 2048;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (Math.max(w, h) > MAX) {
    const r = MAX / Math.max(w, h);
    w = Math.round(w * r); h = Math.round(h * r);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  // 水印面板（右下角）
  const lines: string[] = [];
  const ts = (opts.takenAt ?? new Date()).toLocaleString("zh-CN", { hour12: false });
  lines.push(`📍 ${opts.locationLabel ?? "未填地点"}`);
  if (opts.gpsLng != null && opts.gpsLat != null) {
    lines.push(`经度 ${fmt(opts.gpsLng)}  纬度 ${fmt(opts.gpsLat)}`);
  } else {
    lines.push(`未获取 GPS 坐标`);
  }
  lines.push(`时间 ${ts}`);
  lines.push(`采集 ${opts.userLabel}${opts.projectLabel ? "  · " + opts.projectLabel : ""}`);

  const fontSize = Math.max(14, Math.round(w / 60));
  const lineH = Math.round(fontSize * 1.35);
  const padX = Math.round(fontSize * 0.9);
  const padY = Math.round(fontSize * 0.7);

  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  const widths = lines.map(t => ctx.measureText(t).width);
  const boxW = Math.max(...widths) + padX * 2;
  const boxH = lineH * lines.length + padY * 2;
  const x = w - boxW - 16;
  const y = h - boxH - 16;

  // 半透明背景
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, boxW, boxH);
  // 左侧红色竖条（公文取证视觉）
  ctx.fillStyle = "rgba(220,38,38,0.95)";
  ctx.fillRect(x, y, 4, boxH);

  // 文本
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.textBaseline = "top";
  lines.forEach((t, i) => ctx.fillText(t, x + padX, y + padY + i * lineH));

  // 全图斜向重复"防盗用"文字水印
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-22 * Math.PI) / 180);
  ctx.font = `700 ${Math.round(fontSize * 1.2)}px -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.textAlign = "center";
  const tile = `${opts.userLabel} · 取证留痕 · ${ts}`;
  const stepX = Math.max(360, Math.round(w / 2.2));
  const stepY = Math.max(180, Math.round(h / 4));
  for (let yy = -h; yy < h; yy += stepY) {
    for (let xx = -w; xx < w; xx += stepX) {
      ctx.fillText(tile, xx, yy);
    }
  }
  ctx.restore();

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("水印生成失败")), "image/jpeg", 0.92),
  );

  return {
    blob,
    exif: {
      width: w, height: h,
      sourceType: file.type || "image/*",
      sourceSize: file.size,
      burnedAt: new Date().toISOString(),
    },
  };
};

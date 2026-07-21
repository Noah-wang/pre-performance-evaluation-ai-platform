// 用户姓名水印组件 + DOCX 水印工具
// 用于：在线预览（报告/资料）覆盖一层斜向半透明文字，威慑外发截图
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { renderTemplate } from "@/lib/templates";

interface WatermarkOverlayProps {
  text?: string; // 显式覆盖
  opacity?: number;
  density?: number;
  children?: React.ReactNode;
  className?: string;
}

/**
 * 给任意可滚动内容覆盖一层斜向水印。
 * 文本来源：props.text > doc_templates(watermark.text) > 邮箱+日期
 */
export const WatermarkOverlay = ({
  text, opacity = 0.08, density = 6, children, className = "",
}: WatermarkOverlayProps) => {
  const { user } = useAuth();
  const today = new Date().toLocaleDateString("zh-CN");
  const fallback = `${user?.email ?? "未登录"} · ${today}`;
  const [wmText, setWmText] = useState<string>(text ?? fallback);

  useEffect(() => {
    if (text) { setWmText(text); return; }
    let alive = true;
    renderTemplate("watermark.text", { user_email: user?.email ?? "未登录", date: today }, fallback)
      .then(t => { if (alive) setWmText(t); });
    return () => { alive = false; };
  }, [text, user?.email, today, fallback]);


  const svgUrl = useMemo(() => {
    const w = 360, h = 220;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>
      <text x='${w / 2}' y='${h / 2}' fill='hsl(var(--foreground))' fill-opacity='${opacity}'
        font-family='SimHei, sans-serif' font-size='18' font-weight='bold'
        text-anchor='middle' transform='rotate(-22 ${w / 2} ${h / 2})'>${escapeXml(wmText)}</text>
    </svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  }, [wmText, opacity]);

  return (
    <div className={`relative ${className}`}>
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{ backgroundImage: svgUrl, backgroundRepeat: "repeat" }}
      />
    </div>
  );
};

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

/** 供 docx 导出时附加的"水印段落字符串"（页眉里重复展示） */
export const buildDocxWatermarkText = (userEmail?: string | null) =>
  `${userEmail ?? "未登录"} · ${new Date().toLocaleDateString("zh-CN")} · 仅供内部评审使用`;

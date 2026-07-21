interface SealProps {
  /** @deprecated Kept for backward compatibility; favicon image is used instead. */
  text?: string;
  size?: number;
  className?: string;
}

/**
 * 全站统一品牌印章 — 使用 /favicon.png（红色「评估」印章）。
 * 保留 text/size/className API 兼容旧调用点。
 */
export const Seal = ({ size = 40, className = "" }: SealProps) => (
  <div
    className={`relative inline-flex items-center justify-center overflow-hidden ${className}`}
    style={{
      width: size,
      height: size,
      borderRadius: 10,
      boxShadow:
        "0 0 0 1px hsl(var(--cyan) / 0.35), 0 6px 18px -6px hsl(var(--navy-deep) / 0.55)",
    }}
    aria-label="事前绩效评估"
  >
    <img
      src="/favicon.png"
      alt="评估"
      width={size}
      height={size}
      className="block w-full h-full object-cover"
      draggable={false}
    />
    <span
      className="absolute inset-[2px] rounded-[8px] pointer-events-none"
      style={{ border: "1px solid hsl(var(--cyan) / 0.25)" }}
    />
  </div>
);

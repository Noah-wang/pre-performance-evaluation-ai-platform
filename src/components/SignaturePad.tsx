import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Eraser, Check, PenLine } from "lucide-react";

interface Props {
  onSave: (dataUrl: string) => void;
  height?: number;
}

export const SignaturePad = ({ onSave, height = 160 }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 用 navy-deep 墨色，更具科技/正式感
    ctx.strokeStyle = "hsl(217, 60%, 16%)";
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    drawing.current = true;
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(x, y);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const { x, y } = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const save = () => {
    if (!hasInk) return;
    onSave(canvasRef.current!.toDataURL("image/png"));
    clear();
  };

  return (
    <div className="surface-card p-3 space-y-2">
      {/* 顶部 eyebrow */}
      <div className="flex items-center justify-between px-1">
        <span className="section-eyebrow">
          <PenLine className="h-3 w-3" />
          E-Signature
        </span>
        <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
          {hasInk ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="status-dot" style={{ color: "hsl(var(--success) / 0.25)", background: "hsl(var(--success))" }} />
              <span className="text-success">SIGNING</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="status-dot" />
              <span>READY</span>
            </span>
          )}
        </span>
      </div>

      {/* 画布容器 - 网格底纹 + 内描边 */}
      <div
        className="relative rounded-md overflow-hidden border border-accent/30"
        style={{
          background:
            "linear-gradient(hsl(var(--accent) / 0.06) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--accent) / 0.06) 1px, transparent 1px), linear-gradient(180deg, hsl(0 0% 100%) 0%, hsl(214 32% 99%) 100%)",
          backgroundSize: "20px 20px, 20px 20px, 100% 100%",
          boxShadow:
            "inset 0 0 0 1px hsl(var(--cyan) / 0.12), inset 0 1px 4px hsl(var(--navy-deep) / 0.06)",
        }}
      >
        {/* 中央基线提示 */}
        {!hasInk && (
          <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-muted-foreground/30 to-transparent" />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
              在此签字
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-muted-foreground/30 to-transparent" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ height, width: "100%", touchAction: "none" }}
          className="block cursor-crosshair relative z-10"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] font-mono text-muted-foreground/70">
          手写或触控笔均可 · PNG 输出
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={clear} disabled={!hasInk}>
            <Eraser className="mr-1 h-3.5 w-3.5" />重写
          </Button>
          <Button size="sm" variant="hero" onClick={save} disabled={!hasInk}>
            <Check className="mr-1 h-3.5 w-3.5" />确认签字
          </Button>
        </div>
      </div>
    </div>
  );
};

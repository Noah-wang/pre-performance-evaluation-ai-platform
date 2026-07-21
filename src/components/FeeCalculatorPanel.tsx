import { useMemo } from "react";
import { Plus, Trash2, Calculator, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import {
  FeeCalculation,
  FeeTier,
  DEFAULT_FEE,
  FEE_PRESETS,
  applyFeePreset,
  calcFee,
  formatYuan,
  getFeeVersionLabel,
  normalizeFeeCalculation,
} from "@/lib/fee";
import { cn } from "@/lib/utils";

interface Props {
  budget: number;
  value: FeeCalculation;
  onChange: (v: FeeCalculation) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const FeeCalculatorPanel = ({ budget, value, onChange, open, onOpenChange }: Props) => {
  const fee = useMemo(() => normalizeFeeCalculation(value ?? DEFAULT_FEE), [value]);
  const result = useMemo(() => calcFee(budget, fee), [budget, fee]);
  const compareRows = useMemo(
    () =>
      FEE_PRESETS.map((preset) => ({
        ...preset,
        total: calcFee(budget, preset.fee).total,
        active: fee.presetKey === preset.key,
      })),
    [budget, fee.presetKey],
  );

  const updateTier = (i: number, patch: Partial<FeeTier>) => {
    const tiers = fee.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    onChange({ ...fee, tiers, presetKey: null });
  };
  const addTier = () => {
    const last = fee.tiers[fee.tiers.length - 1];
    const newTier: FeeTier = { upTo: (last?.upTo ?? 1_000_000) * 2, rate: 1 };
    // 在最后一个无上限档之前插入
    const tiers = [...fee.tiers];
    if (last && last.upTo === null) tiers.splice(tiers.length - 1, 0, newTier);
    else tiers.push(newTier);
    onChange({ ...fee, tiers, presetKey: null });
  };
  const removeTier = (i: number) => {
    if (fee.tiers.length <= 1) return;
    onChange({ ...fee, tiers: fee.tiers.filter((_, idx) => idx !== i), presetKey: null });
  };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <Calculator className="h-4 w-4 text-cyan" />
            收费规则计算
            {fee.enabled && result.total > 0 && (
              <span className="font-mono text-cyan tabular-nums">→ {formatYuan(result.total)}</span>
            )}
          </span>
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-3">
        {/* 启用开关 */}
        <div className="flex items-center justify-between rounded-md bg-muted/15 px-3 py-2 border border-border/50">
          <div>
            <Label className="text-sm">启用阶梯累进收费</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              基于项目预算金额，按分档比例累进计算评估服务费
            </p>
          </div>
          <Switch checked={fee.enabled} onCheckedChange={(v) => onChange({ ...fee, enabled: v })} />
        </div>

        {fee.enabled && (
          <>
            <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">收费模板与版本对比</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    当前规则：{getFeeVersionLabel(fee)}
                  </p>
                </div>
                {fee.presetKey && (
                  <span className="text-[11px] font-mono text-cyan">已套用模板</span>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {compareRows.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => onChange(applyFeePreset(preset.key))}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      preset.active
                        ? "border-cyan bg-cyan/8 shadow-[0_0_12px_hsl(var(--accent)/0.18)]"
                        : "border-border/60 bg-card hover:border-cyan/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{preset.name}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">版本 {preset.version}</div>
                      </div>
                      {preset.active && <CheckCircle2 className="h-4 w-4 text-cyan shrink-0" />}
                    </div>
                    <div className="mt-2 text-xs text-foreground/80 leading-relaxed">{preset.description}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground">适用：{preset.recommendedFor}</div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">按当前预算测算</span>
                      <span className="font-mono text-sm text-cyan">{budget > 0 ? formatYuan(preset.total) : "待预算"}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 分档表格 */}
            <div className="rounded-md border border-border/60 overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_40px] gap-2 px-3 py-2 bg-muted/30 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <span>分档上限（元，留空=无上限）</span>
                <span>费率（‰）</span>
                <span></span>
              </div>
              <div className="divide-y divide-border/50">
                {fee.tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_40px] gap-2 px-3 py-2 items-center">
                    <Input
                      type="number"
                      value={t.upTo ?? ""}
                      placeholder="无上限"
                      onChange={(e) => updateTier(i, {
                        upTo: e.target.value === "" ? null : Number(e.target.value),
                        })}
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      step="0.1"
                      value={t.rate}
                      onChange={(e) => updateTier(i, { rate: Number(e.target.value) })}
                      className="h-8 text-sm font-mono tabular-nums"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeTier(i)}
                      disabled={fee.tiers.length <= 1}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addTier}
                className="w-full rounded-none border-t border-border/50 h-8 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" /> 增加分档
              </Button>
            </div>

            {/* 折扣 + 调整 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">折扣系数（0-1）</Label>
                <Input
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={fee.discount}
                  onChange={(e) => onChange({ ...fee, discount: Number(e.target.value), presetKey: null })}
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">人工调整（元）</Label>
                <Input
                  type="number"
                  value={fee.adjustment}
                  onChange={(e) => onChange({ ...fee, adjustment: Number(e.target.value), presetKey: null })}
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>

            {/* 计算明细 */}
            {budget > 0 && result.breakdown.length > 0 && (
              <div className="rounded-md border border-cyan/30 bg-cyan/5 p-3 space-y-1.5">
                <div className="text-[11px] font-mono uppercase tracking-wider text-cyan mb-2">
                  实时计算明细 · 预算 {formatYuan(budget)}
                </div>
                {result.breakdown.map((b, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs font-mono tabular-nums">
                    <span className="text-muted-foreground">{b.range}</span>
                    <span>{formatYuan(b.amount)} × {b.rate}‰</span>
                    <span className="text-foreground font-medium w-24 text-right">= {formatYuan(b.subtotal)}</span>
                  </div>
                ))}
                <div className="border-t border-cyan/30 pt-2 mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    × 折扣 {fee.discount} + 调整 {formatYuan(fee.adjustment)}
                  </span>
                  <span className="font-display text-lg text-cyan font-semibold tabular-nums">
                    {formatYuan(result.total)}
                  </span>
                </div>
              </div>
            )}

            {budget <= 0 && (
              <div className="text-[11px] text-muted-foreground italic px-1">
                输入预算金额后，将自动按上方分档实时计算
              </div>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

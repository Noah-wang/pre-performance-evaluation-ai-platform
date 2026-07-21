// 财政评估收费分档计算 · 参考《国家发展改革委关于建设项目前期工作咨询收费暂行规定》分档累进
// 用户可在新增/编辑项目时自定义分档与比例，默认按下方阶梯
export interface FeeTier {
  /** 分档上限金额（元）；最后一档传 Infinity 或 null 表示无上限 */
  upTo: number | null;
  /** 该档费率（千分比，如 5 表示 5‰） */
  rate: number;
}

export interface FeeCalculation {
  /** 是否启用收费计算 */
  enabled: boolean;
  /** 分档配置 */
  tiers: FeeTier[];
  /** 折扣系数 0-1，默认 1 */
  discount: number;
  /** 最终自定义调整金额（可正可负） */
  adjustment: number;
  /** 当前采用的收费模板键 */
  presetKey?: string | null;
  /** 当前采用的模板版本 */
  presetVersion?: string | null;
}

export interface FeePresetDefinition {
  key: string;
  name: string;
  version: string;
  description: string;
  recommendedFor: string;
  fee: FeeCalculation;
}

export const DEFAULT_FEE: FeeCalculation = {
  enabled: false,
  tiers: [
    { upTo: 1_000_000, rate: 5.0 },      // ≤100万：5‰
    { upTo: 5_000_000, rate: 3.5 },      // 100-500万：3.5‰
    { upTo: 10_000_000, rate: 2.5 },     // 500-1000万：2.5‰
    { upTo: 50_000_000, rate: 1.8 },     // 1000-5000万：1.8‰
    { upTo: null, rate: 1.0 },           // >5000万：1‰
  ],
  discount: 1,
  adjustment: 0,
  presetKey: "standard_2026",
  presetVersion: "2026.1",
};

export const FEE_PRESETS: FeePresetDefinition[] = [
  {
    key: "standard_2026",
    name: "标准收费模板",
    version: "2026.1",
    description: "适用于绝大多数常规事前绩效评估项目，按现有系统默认阶梯执行。",
    recommendedFor: "常规项目、单项目评估",
    fee: {
      enabled: true,
      tiers: [
        { upTo: 1_000_000, rate: 5.0 },
        { upTo: 5_000_000, rate: 3.5 },
        { upTo: 10_000_000, rate: 2.5 },
        { upTo: 50_000_000, rate: 1.8 },
        { upTo: null, rate: 1.0 },
      ],
      discount: 1,
      adjustment: 0,
      presetKey: "standard_2026",
      presetVersion: "2026.1",
    },
  },
  {
    key: "batch_2026",
    name: "批量项目模板",
    version: "2026.1",
    description: "适用于一包多项目或集中复核场景，默认给予一定批量折扣。",
    recommendedFor: "评估包、同口径批量评估",
    fee: {
      enabled: true,
      tiers: [
        { upTo: 1_000_000, rate: 4.5 },
        { upTo: 5_000_000, rate: 3.2 },
        { upTo: 10_000_000, rate: 2.3 },
        { upTo: 50_000_000, rate: 1.6 },
        { upTo: null, rate: 0.9 },
      ],
      discount: 0.95,
      adjustment: 0,
      presetKey: "batch_2026",
      presetVersion: "2026.1",
    },
  },
  {
    key: "complex_2026",
    name: "重点复杂项目模板",
    version: "2026.1",
    description: "适用于跨部门、资料体量大、论证复杂的重点项目，单价略高。",
    recommendedFor: "重点建设、复杂论证项目",
    fee: {
      enabled: true,
      tiers: [
        { upTo: 1_000_000, rate: 5.8 },
        { upTo: 5_000_000, rate: 4.0 },
        { upTo: 10_000_000, rate: 2.9 },
        { upTo: 50_000_000, rate: 2.0 },
        { upTo: null, rate: 1.2 },
      ],
      discount: 1,
      adjustment: 0,
      presetKey: "complex_2026",
      presetVersion: "2026.1",
    },
  },
];

export const getFeePreset = (key?: string | null) =>
  FEE_PRESETS.find((item) => item.key === key) ?? null;

const cloneDefaultTiers = () => DEFAULT_FEE.tiers.map((tier) => ({ ...tier }));

export const normalizeFeeCalculation = (value?: Partial<FeeCalculation> | null): FeeCalculation => {
  const raw = (value ?? {}) as Partial<FeeCalculation> & { tiers?: unknown };
  const fallbackPreset = raw.presetKey ? getFeePreset(raw.presetKey) : null;
  const fallback = fallbackPreset?.fee ?? DEFAULT_FEE;
  const rawTiers = Array.isArray(raw.tiers) ? raw.tiers : fallback.tiers;
  const tiers = rawTiers
    .map((tier) => {
      const current = tier as Partial<FeeTier> | null | undefined;
      const upToValue = current?.upTo;
      const rateValue = Number(current?.rate);
      return {
        upTo: upToValue === null || upToValue === undefined || upToValue === "" ? null : Number(upToValue),
        rate: Number.isFinite(rateValue) ? rateValue : 0,
      };
    })
    .filter((tier) => tier.upTo === null || (Number.isFinite(tier.upTo) && tier.upTo >= 0));

  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    tiers: tiers.length ? tiers : cloneDefaultTiers(),
    discount: Number.isFinite(Number(raw.discount)) ? Number(raw.discount) : fallback.discount,
    adjustment: Number.isFinite(Number(raw.adjustment)) ? Number(raw.adjustment) : fallback.adjustment,
    presetKey: raw.presetKey ?? fallback.presetKey ?? null,
    presetVersion: raw.presetVersion ?? fallback.presetVersion ?? null,
  };
};

export const cloneFeeCalculation = (fee: FeeCalculation): FeeCalculation => {
  const normalized = normalizeFeeCalculation(fee);
  return {
    enabled: normalized.enabled,
    tiers: normalized.tiers.map((tier) => ({ ...tier })),
    discount: normalized.discount,
    adjustment: normalized.adjustment,
    presetKey: normalized.presetKey ?? null,
    presetVersion: normalized.presetVersion ?? null,
  };
};

export const applyFeePreset = (presetKey: string): FeeCalculation => {
  const preset = getFeePreset(presetKey);
  return cloneFeeCalculation(preset?.fee ?? DEFAULT_FEE);
};

export const getFeeVersionLabel = (fee?: FeeCalculation | null) => {
  const normalized = normalizeFeeCalculation(fee);
  const preset = getFeePreset(normalized.presetKey);
  if (preset) return `${preset.name} ${preset.version}`;
  if (normalized.presetVersion) return `自定义规则 ${normalized.presetVersion}`;
  return "自定义规则";
};

/** 按阶梯累进算总费用（元） */
export function calcFee(budget: number, fee: FeeCalculation): {
  total: number;
  breakdown: { range: string; amount: number; rate: number; subtotal: number }[];
} {
  const normalized = normalizeFeeCalculation(fee);
  if (!normalized.enabled || budget <= 0) return { total: 0, breakdown: [] };
  let remaining = budget;
  let prev = 0;
  let total = 0;
  const breakdown: { range: string; amount: number; rate: number; subtotal: number }[] = [];
  for (const tier of normalized.tiers) {
    if (remaining <= 0) break;
    const cap = tier.upTo ?? Infinity;
    const slice = Math.min(remaining, cap - prev);
    if (slice <= 0) { prev = cap; continue; }
    const subtotal = (slice * tier.rate) / 1000;
    total += subtotal;
    breakdown.push({
      range: `${(prev / 10000).toFixed(0)}万 ~ ${cap === Infinity ? "∞" : (cap / 10000).toFixed(0) + "万"}`,
      amount: slice,
      rate: tier.rate,
      subtotal,
    });
    remaining -= slice;
    prev = cap;
  }
  total = total * (normalized.discount ?? 1) + (normalized.adjustment ?? 0);
  return { total: Math.max(0, total), breakdown };
}

export const formatYuan = (n: number) =>
  n >= 10000 ? `¥${(n / 10000).toFixed(2)}万` : `¥${n.toFixed(2)}`;

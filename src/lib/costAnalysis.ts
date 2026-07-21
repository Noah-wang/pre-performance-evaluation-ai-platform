export type EvidenceSource =
  | "government_procurement"
  | "public_resource"
  | "cost_standard"
  | "market_quote"
  | "historical_contract"
  | "policy_standard"
  | "other";

export interface BudgetCostItem {
  id: string;
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  declaredUnitPrice: number;
  evidenceSource: EvidenceSource;
  evidenceTitle: string;
  evidenceUrl: string;
  evidenceDate: string;
  benchmarkUnitPrice: number;
  adjustmentRate: number;
  adjustmentNote: string;
}

export interface CostAnalysisData {
  items: BudgetCostItem[];
  overallNote: string;
  updatedAt: string;
}

export interface CostItemResult extends BudgetCostItem {
  declaredAmount: number;
  adjustedBenchmarkUnitPrice: number;
  reasonableAmount: number | null;
  potentialSaving: number;
  deviationRate: number | null;
  hasEvidence: boolean;
  judgment: "证据不足" | "价格偏高" | "基本合理" | "价格偏低";
}

export const EVIDENCE_SOURCE_LABELS: Record<EvidenceSource, string> = {
  government_procurement: "政府采购中标公告",
  public_resource: "公共资源交易结果",
  cost_standard: "造价信息/价格信息",
  market_quote: "市场询价",
  historical_contract: "历史合同/同类项目",
  policy_standard: "政策定额/收费标准",
  other: "其他客观来源",
};

export const emptyCostItem = (): BudgetCostItem => ({
  id: crypto.randomUUID(),
  name: "",
  specification: "",
  unit: "项",
  quantity: 1,
  declaredUnitPrice: 0,
  evidenceSource: "government_procurement",
  evidenceTitle: "",
  evidenceUrl: "",
  evidenceDate: "",
  benchmarkUnitPrice: 0,
  adjustmentRate: 0,
  adjustmentNote: "",
});

const numeric = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeCostAnalysis = (customFields: unknown): CostAnalysisData => {
  const root = customFields && typeof customFields === "object"
    ? customFields as Record<string, unknown>
    : {};
  const raw = root.cost_analysis && typeof root.cost_analysis === "object"
    ? root.cost_analysis as Record<string, unknown>
    : {};
  const items = Array.isArray(raw.items)
    ? raw.items.map((item, index) => {
        const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const source = String(row.evidenceSource ?? "government_procurement") as EvidenceSource;
        return {
          id: String(row.id ?? `cost-${index}`),
          name: String(row.name ?? ""),
          specification: String(row.specification ?? ""),
          unit: String(row.unit ?? "项"),
          quantity: numeric(row.quantity),
          declaredUnitPrice: numeric(row.declaredUnitPrice),
          evidenceSource: source in EVIDENCE_SOURCE_LABELS ? source : "other",
          evidenceTitle: String(row.evidenceTitle ?? ""),
          evidenceUrl: String(row.evidenceUrl ?? ""),
          evidenceDate: String(row.evidenceDate ?? ""),
          benchmarkUnitPrice: numeric(row.benchmarkUnitPrice),
          adjustmentRate: numeric(row.adjustmentRate),
          adjustmentNote: String(row.adjustmentNote ?? ""),
        };
      })
    : [];

  return {
    items,
    overallNote: String(raw.overallNote ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
  };
};

export const calculateCostItems = (items: BudgetCostItem[]): CostItemResult[] =>
  items.map((item) => {
    const quantity = Math.max(numeric(item.quantity), 0);
    const declaredUnitPrice = Math.max(numeric(item.declaredUnitPrice), 0);
    const benchmarkUnitPrice = Math.max(numeric(item.benchmarkUnitPrice), 0);
    const declaredAmount = quantity * declaredUnitPrice;
    const hasEvidence = benchmarkUnitPrice > 0
      && Boolean(item.evidenceTitle.trim() || item.evidenceUrl.trim());
    const adjustedBenchmarkUnitPrice = benchmarkUnitPrice * (1 + numeric(item.adjustmentRate) / 100);
    const benchmarkAmount = quantity * Math.max(adjustedBenchmarkUnitPrice, 0);
    const reasonableAmount = hasEvidence ? Math.min(declaredAmount, benchmarkAmount) : null;
    const potentialSaving = hasEvidence ? Math.max(declaredAmount - benchmarkAmount, 0) : 0;
    const deviationRate = hasEvidence && adjustedBenchmarkUnitPrice > 0
      ? (declaredUnitPrice - adjustedBenchmarkUnitPrice) / adjustedBenchmarkUnitPrice
      : null;

    let judgment: CostItemResult["judgment"] = "证据不足";
    if (deviationRate !== null) {
      if (deviationRate > 0.05) judgment = "价格偏高";
      else if (deviationRate < -0.3) judgment = "价格偏低";
      else judgment = "基本合理";
    }

    return {
      ...item,
      declaredAmount,
      adjustedBenchmarkUnitPrice,
      reasonableAmount,
      potentialSaving,
      deviationRate,
      hasEvidence,
      judgment,
    };
  });

export const summarizeCostAnalysis = (items: BudgetCostItem[]) => {
  const results = calculateCostItems(items);
  const declaredTotal = results.reduce((sum, item) => sum + item.declaredAmount, 0);
  const evidencedDeclaredTotal = results
    .filter((item) => item.hasEvidence)
    .reduce((sum, item) => sum + item.declaredAmount, 0);
  const potentialSaving = results.reduce((sum, item) => sum + item.potentialSaving, 0);
  const reasonableTotal = Math.max(declaredTotal - potentialSaving, 0);
  const evidenceCount = results.filter((item) => item.hasEvidence).length;
  const coverage = declaredTotal > 0 ? evidencedDeclaredTotal / declaredTotal : 0;
  const savingRate = declaredTotal > 0 ? potentialSaving / declaredTotal : 0;

  return {
    results,
    declaredTotal,
    reasonableTotal,
    potentialSaving,
    evidenceCount,
    coverage,
    savingRate,
  };
};


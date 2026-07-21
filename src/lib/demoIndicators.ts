export interface DemoIndicator {
  id: string;
  system_id: string;
  parent_id: string | null;
  level: number;
  code: string | null;
  name: string;
  weight: number;
}

interface PerformanceTarget {
  id?: string;
  name?: string;
  code?: string | null;
  weight?: number | null;
  scoring_method?: string | null;
  required_materials?: string | null;
  notes?: string | null;
}

const DIMENSIONS = [
  { code: "1", name: "项目必要性", weight: 30, keywords: ["必要", "政策", "依据", "立项", "需求", "痛点", "背景"] },
  { code: "2", name: "项目可行性", weight: 15, keywords: ["可行", "实施", "条件", "组织", "方案", "技术", "路径"] },
  { code: "3", name: "项目经济性", weight: 15, keywords: ["经济", "预算", "成本", "测算", "节约", "价格", "合理性"] },
  { code: "4", name: "项目效率性", weight: 25, keywords: ["效率", "进度", "时效", "管理", "执行", "安排"] },
  { code: "5", name: "项目效益性", weight: 15, keywords: ["效益", "产出", "效果", "服务", "满意", "影响", "目标"] },
] as const;

const normalizeTarget = (item: unknown): PerformanceTarget | null => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  if (!name) return null;
  return {
    id: String(record.id ?? ""),
    name,
    code: String(record.code ?? "").trim() || null,
    weight: Number.isFinite(Number(record.weight)) ? Number(record.weight) : null,
    scoring_method: String(record.scoring_method ?? "").trim() || null,
    required_materials: String(record.required_materials ?? "").trim() || null,
    notes: String(record.notes ?? "").trim() || null,
  };
};

const parseTargets = (customFields: unknown) => {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return [] as PerformanceTarget[];
  const record = customFields as Record<string, unknown>;
  if (!Array.isArray(record.performance_targets)) return [] as PerformanceTarget[];
  return record.performance_targets
    .map(normalizeTarget)
    .filter((item): item is PerformanceTarget => Boolean(item));
};

const pickDimension = (target: PerformanceTarget) => {
  const corpus = [target.name, target.notes, target.scoring_method, target.required_materials]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const best = DIMENSIONS
    .map((dimension) => ({
      dimension,
      score: dimension.keywords.reduce((sum, keyword) => sum + (corpus.includes(keyword) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.dimension : DIMENSIONS[0];
};

export const buildDemoIndicators = (projectId: string, customFields: unknown): DemoIndicator[] => {
  const systemId = `demo:${projectId}`;
  const topIndicators: DemoIndicator[] = DIMENSIONS.map((dimension) => ({
    id: `${systemId}:${dimension.code}`,
    system_id: systemId,
    parent_id: null,
    level: 1,
    code: dimension.code,
    name: dimension.name,
    weight: dimension.weight,
  }));

  const targets = parseTargets(customFields);
  if (!targets.length) return topIndicators;

  const grouped = new Map<string, PerformanceTarget[]>();
  targets.forEach((target) => {
    const dimension = pickDimension(target);
    const list = grouped.get(dimension.code) ?? [];
    list.push(target);
    grouped.set(dimension.code, list);
  });

  const childIndicators: DemoIndicator[] = [];
  DIMENSIONS.forEach((dimension) => {
    const list = grouped.get(dimension.code) ?? [];
    if (!list.length) return;
    const weightedTargets = list.filter((target) => Number(target.weight) > 0);
    const evenWeight = Number((dimension.weight / list.length).toFixed(2));
    const weightedSum = weightedTargets.reduce((sum, target) => sum + Number(target.weight || 0), 0);
    list.forEach((target, index) => {
      const computedWeight = weightedTargets.length
        ? Number(target.weight || 0) || Number((dimension.weight / Math.max(1, weightedTargets.length)).toFixed(2))
        : evenWeight;
      childIndicators.push({
        id: `${systemId}:${dimension.code}:${target.id || index + 1}`,
        system_id: systemId,
        parent_id: `${systemId}:${dimension.code}`,
        level: 2,
        code: target.code || `${dimension.code}.${index + 1}`,
        name: target.name || `${dimension.name}指标 ${index + 1}`,
        weight: weightedTargets.length && weightedSum > 0
          ? Number(((computedWeight / weightedSum) * dimension.weight).toFixed(2))
          : computedWeight,
      });
    });
  });

  return childIndicators.length ? [...topIndicators, ...childIndicators] : topIndicators;
};


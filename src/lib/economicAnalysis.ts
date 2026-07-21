import {
  EVIDENCE_SOURCE_LABELS,
  normalizeCostAnalysis,
  summarizeCostAnalysis,
} from "@/lib/costAnalysis";

export interface EconomicProject {
  id: string;
  name: string;
  unit: string;
  budget: number;
  custom_fields?: unknown;
}

const formatWan = (yuan: number) => `${(yuan / 10000).toFixed(2)} 万元`;

export const buildEconomicAnalysis = (
  project: EconomicProject | null | undefined,
  _allProjects: EconomicProject[] = [],
) => {
  if (!project) return "";

  const analysis = normalizeCostAnalysis(project.custom_fields);
  const summary = summarizeCostAnalysis(analysis.items);
  const projectBudget = Number(project.budget || 0);
  const paragraphs: string[] = [];

  if (!analysis.items.length) {
    paragraphs.push(
      "尚未建立预算明细成本分析，无法对资金合理性和成本节约空间作出有事实支撑的判断。应补充预算项目、数量、申报单价，以及政府采购中标公告、公共资源交易结果、造价信息、市场询价、历史合同或政策定额等客观证据。",
    );
    return [
      "项目经济性客观分析口径：",
      ...paragraphs,
      "成稿要求：资料不足时须明确披露证据缺口，不得由 AI 虚构市场价格或直接认定预算合理。",
    ].join("\n");
  }

  paragraphs.push(
    `已分析 ${analysis.items.length} 项预算明细，明细申报金额合计 ${formatWan(summary.declaredTotal)}；其中 ${summary.evidenceCount} 项具备可追溯价格证据，按金额计算的证据覆盖率为 ${(summary.coverage * 100).toFixed(1)}%。`,
  );

  if (projectBudget > 0) {
    const gap = summary.declaredTotal - projectBudget;
    if (Math.abs(gap) > 1) {
      paragraphs.push(
        `预算明细合计与项目申报预算 ${formatWan(projectBudget)} 相差 ${formatWan(Math.abs(gap))}，应先核对是否存在漏项、重复项或金额口径不一致。`,
      );
    }
  }

  summary.results.forEach((item, index) => {
    if (!item.hasEvidence) {
      paragraphs.push(
        `${index + 1}. ${item.name || "未命名预算项"}：申报金额 ${formatWan(item.declaredAmount)}，尚缺有效参考价格或来源信息，暂不判断其价格合理性。`,
      );
      return;
    }
    const source = EVIDENCE_SOURCE_LABELS[item.evidenceSource];
    const deviation = item.deviationRate === null ? "" : `${Math.abs(item.deviationRate * 100).toFixed(1)}%`;
    const direction = (item.deviationRate ?? 0) >= 0 ? "高于" : "低于";
    paragraphs.push(
      `${index + 1}. ${item.name || "未命名预算项"}：申报单价 ${item.declaredUnitPrice.toFixed(2)} 元/${item.unit}，参考${source}“${item.evidenceTitle || "已录入来源"}”并进行可比性调整后的参考单价为 ${item.adjustedBenchmarkUnitPrice.toFixed(2)} 元/${item.unit}${item.adjustmentNote ? `（调整说明：${item.adjustmentNote}）` : ""}，申报单价${direction}参考价 ${deviation}，判断为“${item.judgment}”${item.potentialSaving > 0 ? `，测算可优化金额 ${formatWan(item.potentialSaving)}` : ""}。`,
    );
  });

  if (summary.coverage < 0.6) {
    paragraphs.push(
      `当前客观价格证据覆盖率不足 60%，只能形成阶段性判断。建议优先补齐金额较大的预算项，并记录服务范围、规格、时间和地域差异后再作最终结论。`,
    );
  } else if (summary.potentialSaving > 0) {
    paragraphs.push(
      `在现有证据和可比性调整口径下，预算建议合理金额约为 ${formatWan(summary.reasonableTotal)}，潜在节约空间约为 ${formatWan(summary.potentialSaving)}，占明细申报金额 ${(summary.savingRate * 100).toFixed(1)}%。建议通过核减偏高单价、整合重复采购、优化数量配置或竞争性采购实现节约。`,
    );
  } else {
    paragraphs.push(
      "在现有证据覆盖范围内，未测算出明确的价格压减空间，可初步认为已核验部分处于合理区间；仍应结合预算完整性、采购方式和实施边界判断成本可控性。",
    );
  }

  if (analysis.overallNote.trim()) {
    paragraphs.push(`人工补充说明：${analysis.overallNote.trim()}`);
  }
  return [
    "项目经济性客观分析口径：",
    ...paragraphs,
    "成稿要求：将上述事实写入第三章“（三）项目经济性”，并保留证据来源和可比性调整说明；不得虚构价格或以无来源数据替代客观证据。",
  ].join("\n");
};

export const buildEconomicOpinion = (
  project: EconomicProject | null | undefined,
) => {
  const analysis = buildEconomicAnalysis(project);
  if (!analysis) return "";
  return analysis
    .split("\n")
    .filter((line) => line !== "项目经济性客观分析口径：" && !line.startsWith("成稿要求："))
    .join("\n")
    .trim();
};

export const mergeEconomicOpinion = (source: string, economicOpinion: string) => {
  if (!economicOpinion.trim()) return source;
  const text = source.trim();
  const section = `3.项目经济性\n${economicOpinion.trim()}`;
  const start = text.search(/(?:^|\n)\s*3[.、]\s*项目经济性\s*/);
  const end = text.search(/(?:^|\n)\s*4[.、]\s*项目效率性\s*/);

  if (start >= 0 && end > start) {
    const prefix = text.slice(0, start).trimEnd();
    const suffix = text.slice(end).trimStart();
    return [prefix, section, suffix].filter(Boolean).join("\n");
  }
  if (start >= 0) {
    const prefix = text.slice(0, start).trimEnd();
    return [prefix, section].filter(Boolean).join("\n");
  }
  return [text, section].filter(Boolean).join("\n\n");
};

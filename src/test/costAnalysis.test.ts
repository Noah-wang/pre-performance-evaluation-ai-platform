import { describe, expect, it } from "vitest";
import {
  BudgetCostItem,
  calculateCostItems,
  normalizeCostAnalysis,
  summarizeCostAnalysis,
} from "@/lib/costAnalysis";
import {
  buildEconomicAnalysis,
  buildEconomicOpinion,
  mergeEconomicOpinion,
} from "@/lib/economicAnalysis";

const item = (patch: Partial<BudgetCostItem> = {}): BudgetCostItem => ({
  id: "1",
  name: "系统开发服务",
  specification: "一年服务期",
  unit: "项",
  quantity: 2,
  declaredUnitPrice: 100_000,
  evidenceSource: "government_procurement",
  evidenceTitle: "同类项目中标公告",
  evidenceUrl: "https://example.gov.cn/notice",
  evidenceDate: "2026-01-01",
  benchmarkUnitPrice: 80_000,
  adjustmentRate: 10,
  adjustmentNote: "本项目服务范围增加 10%",
  ...patch,
});

describe("cost analysis", () => {
  it("calculates adjusted benchmark and potential saving", () => {
    const [result] = calculateCostItems([item()]);

    expect(result.adjustedBenchmarkUnitPrice).toBeCloseTo(88_000);
    expect(result.declaredAmount).toBe(200_000);
    expect(result.potentialSaving).toBeCloseTo(24_000);
    expect(result.judgment).toBe("价格偏高");
  });

  it("does not claim savings without objective evidence", () => {
    const summary = summarizeCostAnalysis([
      item({ evidenceTitle: "", evidenceUrl: "", benchmarkUnitPrice: 80_000 }),
    ]);

    expect(summary.evidenceCount).toBe(0);
    expect(summary.potentialSaving).toBe(0);
    expect(summary.results[0].judgment).toBe("证据不足");
  });

  it("normalizes saved project custom fields", () => {
    const normalized = normalizeCostAnalysis({
      other_field: "keep",
      cost_analysis: {
        items: [item()],
        overallNote: "采用竞争性采购",
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0].name).toBe("系统开发服务");
    expect(normalized.overallNote).toBe("采用竞争性采购");
  });

  it("produces a report-ready evidence-based opinion", () => {
    const content = buildEconomicAnalysis({
      id: "p1",
      name: "测试项目",
      unit: "测试单位",
      budget: 200_000,
      custom_fields: {
        cost_analysis: {
          items: [item()],
          overallNote: "建议公开比选",
          updatedAt: "",
        },
      },
    });

    expect(content).toContain("同类项目中标公告");
    expect(content).toContain("潜在节约空间");
    expect(content).toContain("不得虚构价格");
  });

  it("merges objective cost evidence into the formal economic section", () => {
    const opinion = buildEconomicOpinion({
      id: "p1",
      name: "测试项目",
      unit: "测试单位",
      budget: 200_000,
      custom_fields: {
        cost_analysis: {
          items: [item()],
          overallNote: "建议公开比选",
          updatedAt: "",
        },
      },
    });
    const merged = mergeEconomicOpinion(
      "1.项目必要性\n依据充分。\n2.项目可行性\n方案可行。\n3.项目经济性\n原有空泛判断。\n4.项目效率性\n进度合理。",
      opinion,
    );

    expect(merged).toContain("同类项目中标公告");
    expect(merged).toContain("潜在节约空间");
    expect(merged).not.toContain("原有空泛判断");
    expect(merged).toContain("4.项目效率性");
    expect(merged).not.toContain("成稿要求");
  });
});

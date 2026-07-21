import { describe, expect, it } from "vitest";
import { parseExpertScoreSheetRows } from "@/lib/expertScoreSheet";

const indicators = [
  { id: "i1", code: "1", name: "立项必要性", weight: 30 },
  { id: "i2", code: "2", name: "项目可行性", weight: 20 },
];

describe("expert score sheet parser", () => {
  it("parses the exported blank score sheet layout", () => {
    const result = parseExpertScoreSheetRows([
      ["测试项目专家空白打分表"],
      ["项目名称：测试项目"],
      [],
      ["序号", "指标编号", "一级指标", "分值", "专家评分", "扣分理由"],
      [1, "1", "立项必要性", 30, 27.5, "论证资料需补充"],
      [2, "2", "项目可行性", 20, 18, ""],
      ["", "", "合计", 50, 45.5, ""],
    ], indicators);

    expect(result.rows).toEqual([
      { indicatorId: "i1", maxScore: 30, score: 27.5, deductReason: "论证资料需补充" },
      { indicatorId: "i2", maxScore: 20, score: 18, deductReason: "" },
    ]);
    expect(result.totalScore).toBe(45.5);
  });

  it("uses the spreadsheet max score when the system weight is zero", () => {
    const result = parseExpertScoreSheetRows([
      ["指标名称", "分值", "得分", "评分说明"],
      ["立项必要性", 25, 22, "基本充分"],
    ], [{ ...indicators[0], weight: 0 }]);

    expect(result.rows[0]).toMatchObject({ maxScore: 25, score: 22 });
  });

  it("rejects files without a recognizable score table", () => {
    expect(() => parseExpertScoreSheetRows([["项目名称", "测试项目"]], indicators))
      .toThrow("未找到");
  });
});

import { describe, expect, it } from "vitest";
import {
  checkReportCompleteness,
  normalizeReportFormalTail,
} from "./reportCompleteness";

const dimensions = ["立项必要性", "投入经济性"];

const substantiveReport = `一、评估对象
项目名称：测试项目

二、评估方式和方法
（一）评估程序

三、评估内容与结论
（一）立项必要性
1.事实依据：资料明确。
2.发现的问题：仍需完善。
3.分析判断：基本合理。
4.综上结论：具备必要性。
（二）投入经济性
1.事实依据：预算资料明确。
2.发现的问题：测算依据需补充。
3.分析判断：成本基本可控。
4.综上结论：经济性一般。
（三）总体结论
项目具备实施基础。

四、相关建议
1.补充政策依据。
2.完善实施方案。
3.细化预算测算。
4.量化绩效目标。`;

describe("report completeness", () => {
  it("normalizes the fixed formal tail before validation", () => {
    const normalized = normalizeReportFormalTail(`${substantiveReport}

五、其他需要说明的问题
本报告仅供参考。

六、附件
（一）旧附件写法`);

    expect(checkReportCompleteness(normalized, dimensions)).toEqual({
      complete: true,
      missing: [],
    });
  });

  it("reports the exact missing project indicator", () => {
    const incomplete = normalizeReportFormalTail(
      substantiveReport.replace(/（二）投入经济性[\s\S]*?(?=（三）总体结论)/, ""),
    );

    expect(checkReportCompleteness(incomplete, dimensions)).toEqual({
      complete: false,
      missing: ["第三章：投入经济性"],
    });
  });

  it("does not turn a truncated report into a complete report", () => {
    const truncated = normalizeReportFormalTail(substantiveReport.split("四、相关建议")[0]);
    const result = checkReportCompleteness(truncated, dimensions);

    expect(result.complete).toBe(false);
    expect(result.missing).toContain("四、相关建议");
  });
});

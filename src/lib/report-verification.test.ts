import { describe, expect, it } from "vitest";
import {
  verifyFinalReport,
  verifyReportPreflight,
} from "../../supabase/functions/_shared/reportVerification";

const dossier = {
  stats: {
    files: 2,
    indexedFiles: 2,
    unindexedFiles: 0,
    coveredFiles: 2,
  },
  fileReviews: [
    { fileId: "1", fileName: "绩效目标申报表.xlsx", category: "绩效目标", status: "read" as const, chunkCount: 3, factCount: 2 },
    { fileId: "2", fileName: "预算测算说明.docx", category: "预算成本", status: "read" as const, chunkCount: 4, factCount: 2 },
  ],
  dimensionReviews: [
    { dimension: "项目必要性", evidenceCount: 2, sourceNames: ["绩效目标申报表.xlsx"] },
  ],
  targetFacts: [{
    name: "服务对象满意度",
    comparison: "≥" as const,
    value: "95",
    unit: "%",
    displayValue: "≥95%",
    sourceName: "绩效目标申报表.xlsx",
    location: "片段1",
    excerpt: "服务对象满意度≥95%",
    category: "satisfaction" as const,
    priority: 100,
  }],
  corpus: "服务对象满意度≥95%。项目预算90.2万元。",
  conflicts: [],
  serviceProviders: [],
};

describe("comprehensive report verification", () => {
  it("blocks generation when any project file is unreadable", () => {
    const result = verifyReportPreflight({
      ...dossier,
      stats: { ...dossier.stats, indexedFiles: 1, unindexedFiles: 1 },
      fileReviews: [
        ...dossier.fileReviews.slice(0, 1),
        { ...dossier.fileReviews[1], status: "unreadable" as const, chunkCount: 0 },
      ],
    });

    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "UNREADABLE_FILES")).toBe(true);
    expect(result.issues.find((issue) => issue.code === "UNREADABLE_FILES")?.sourceNames)
      .toContain("预算测算说明.docx");
  });

  it("passes a complete report whose target value and numeric claims are grounded", () => {
    const report = `一、评估对象
项目预算90.2万元。
二、评估方式和方法
三、评估内容与结论
（一）项目必要性
服务对象满意度≥95%。
四、相关建议`;
    const result = verifyFinalReport(report, dossier);

    expect(result.status).toBe("passed");
    expect(result.targetFactsPresent).toBe(1);
  });

  it("blocks a report that changes an authoritative target value", () => {
    const report = `一、评估对象
二、评估方式和方法
三、评估内容与结论
（一）项目必要性
服务对象满意度100%。
四、相关建议`;
    const result = verifyFinalReport(report, dossier);

    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "MISSING_AUTHORITATIVE_TARGETS")).toBe(true);
  });

  it("blocks finalizing when a number cannot be traced back to the materials", () => {
    const report = `一、评估对象
项目预算90.2万元。
二、评估方式和方法
三、评估内容与结论
（一）项目必要性
服务对象满意度≥95%，另称可节约88万元。
四、相关建议`;
    const result = verifyFinalReport(report, dossier);

    // 查无出处的数字会被当成事实读，只提示不拦截等于放行。这里阻断的是定稿，
    // 正文照常生成，人核实修改后即可定稿。
    expect(result.status).toBe("blocked");
    expect(result.issues.some((issue) => issue.code === "UNSUPPORTED_NUMERIC_CLAIMS")).toBe(true);
  });

  it("blocks finalizing when the report cites a source that does not exist", () => {
    const report = `一、评估对象
项目预算90.2万元。
二、评估方式和方法
三、评估内容与结论
（一）项目必要性
单价符合《中央财政档案事务补助资金管理办法》规定的区间。
四、相关建议`;
    const result = verifyFinalReport(report, dossier);

    expect(result.status).toBe("blocked");
    const issue = result.issues.find((item) => item.code === "UNSUPPORTED_CITATIONS");
    expect(issue?.detail).toContain("中央财政档案事务补助资金管理办法");
  });

  it("does not flag citations that appear in the uploaded materials", () => {
    const report = `一、评估对象
项目预算90.2万元。
二、评估方式和方法
三、评估内容与结论
（一）项目必要性
依据《中华人民共和国档案法》开展存储管理。
四、相关建议`;
    const result = verifyFinalReport(
      report,
      { ...dossier, corpus: `${dossier.corpus ?? ""}\n依据中华人民共和国档案法执行。` },
    );

    expect(result.issues.some((item) => item.code === "UNSUPPORTED_CITATIONS")).toBe(false);
  });
});

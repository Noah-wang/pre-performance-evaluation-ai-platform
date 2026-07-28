import { describe, expect, it } from "vitest";
import {
  buildAuthoritativeTargetEvidenceDigest,
  extractAuthoritativeTargetFacts,
  formatAuthoritativeTargetRegister,
  reconcileAuthoritativeTargetNarrative,
} from "../../supabase/functions/_shared/reportTargets";
import {
  applyReportCitations,
  extractReportCitationEvidence,
  stripReportCitations,
} from "./reportCitations";
import {
  applyReportQualityCorrections,
  normalizeProcurementStatement,
  normalizeUploadedStandardVersions,
  repairNumericSourceAttributions,
  ensureUploadedStandardsReferenced,
  removeUnsupportedPolicyClauses,
} from "../../supabase/functions/_shared/reportQuality";

const rows = [
  {
    sourceName: "事前绩效评估绩效目标申报表.docx",
    location: "片段 2",
    text: [
      "参保群众权益追溯响应满意度≥95%",
      "参保群众权益追溯响应率：100%（1.0）",
      "社保业务档案支撑政策制定次数：≥2次",
      "全年档案存储成本控制率：≤98%",
      "档案存储设施稳定运行率：≤99%",
      "业务科室档案调取需求满足率：100%",
    ].join("\n"),
  },
  {
    sourceName: "财政支出预期绩效报告.docx",
    location: "片段 4",
    text: "服务对象满意度（≥95%）。通过成本控制（延续合作、动态预算），节约行政成本超13万元/年。",
  },
];

describe("authoritative report targets", () => {
  it("keeps names, comparison operators and values as one fact", () => {
    const facts = extractAuthoritativeTargetFacts(rows);
    const byName = new Map(facts.map((fact) => [fact.name, fact]));

    expect(byName.get("参保群众权益追溯响应满意度")?.displayValue).toBe("≥95%");
    expect(byName.get("参保群众权益追溯响应率")?.displayValue).toBe("100%");
    expect(byName.get("社保业务档案支撑政策制定次数")?.displayValue).toBe("≥2次");
    expect(byName.get("全年档案存储成本控制率")?.displayValue).toBe("≤98%");
    expect(byName.get("档案存储设施稳定运行率")?.displayValue).toBe("≤99%");
    expect(byName.get("业务科室档案调取需求满足率")?.displayValue).toBe("100%");
    expect(byName.get("节约行政成本")?.displayValue).toBe("超13万元/年");
  });

  it("drops table headers and calendar years that OCR turned into fake targets", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "2026年预算项目支出绩效目标申报表（签章版）.pdf",
      text: [
        "项目资金(万元) 年度资金总额: 其他资金 其他资金 年度目标 2026年",
        "总体目标 中期目标 2026年",
        "档案完好率 100%",
      ].join("\n"),
    }]);
    const names = facts.map((fact) => fact.name);
    expect(names).toContain("档案完好率");
    expect(names.some((name) => /其他资金|年度目标|中期目标|总体目标/.test(name))).toBe(false);
    expect(facts.some((fact) => fact.displayValue === "2026年")).toBe(false);
  });

  it("merges category prefixes and verb prefixes into the same indicator", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "绩效目标申报表.pdf",
      text: [
        "参保群众权益追溯成功率 ≥98%",
        "效果指标参保群众权益追溯成功率 ≥98%",
        "效益指标社保业务档案支撑政策制定次数 ≥2次",
        "确保档案完好率 100%",
        "档案完好率 100%",
      ].join("\n"),
    }]);
    const names = facts.map((fact) => fact.name);
    expect(names).toContain("参保群众权益追溯成功率");
    expect(names).toContain("社保业务档案支撑政策制定次数");
    expect(names).toContain("档案完好率");
    expect(names.some((name) => /^(?:效果指标|效益指标|确保)/.test(name))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it("splits indicator names that OCR merged from two neighbouring table cells", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "2026年预算项目支出绩效目标申报表（签章版）.pdf",
      text: [
        "参保群众权益追溯响应率(全年参保群众提出的权益追溯需求，在承诺时限内完成档案调取并初步响应的比例)业务科室档案调取需求满足率(全年业务科室提出的档案调取申请，按要求完成调取的比例)",
        "100.00%",
      ].join("\n"),
    }]);
    const names = facts.map((fact) => fact.name);
    expect(names).toContain("业务科室档案调取需求满足率");
    expect(names.every((name) => name.length <= 20)).toBe(true);
  });

  it("keeps single indicator names that legitimately end in a metric word", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "绩效目标申报表.pdf",
      text: [
        "参保群众权益追溯响应满意度 | ≥95%",
        "社保业务档案支撑政策制定次数 | ≥2次",
        "档案完好率 | 100%",
      ].join("\n"),
    }]);
    const names = facts.map((fact) => fact.name);
    expect(names).toContain("参保群众权益追溯响应满意度");
    expect(names).toContain("社保业务档案支撑政策制定次数");
    expect(names).toContain("档案完好率");
  });

  it("extracts target values when the indicator includes a parenthetical definition", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "2026年预算项目支出绩效目标申报表.xls",
      text: [
        "全年档案存储成本控制率（实际支出占全年预算额度的比例） | ≤98%",
        "档案存储设施稳定运行率（密集架、温湿度调控设备等全年正常运行时间占比） | ≥99%",
        "档案存储环境达标率（温度14-24℃、湿度45%-60%） | 100%",
      ].join("\n"),
    }]);
    const byName = new Map(facts.map((fact) => [fact.name, fact.displayValue]));
    expect(byName.get("全年档案存储成本控制率")).toBe("≤98%");
    expect(byName.get("档案存储设施稳定运行率")).toBe("≥99%");
    expect(byName.get("档案存储环境达标率")).toBe("100%");
  });

  it("builds a source-backed target register", () => {
    const register = formatAuthoritativeTargetRegister(extractAuthoritativeTargetFacts(rows));
    expect(register).toContain("参保群众权益追溯响应满意度｜目标值：≥95%");
    expect(register).toContain("来源：《事前绩效评估绩效目标申报表.docx》/片段 2");
    expect(register).toContain("节约行政成本｜目标值：超13万元/年");
  });

  it("keeps authoritative target-file text in a dedicated prompt channel", () => {
    const digest = buildAuthoritativeTargetEvidenceDigest([
      {
        sourceName: "普通政策文件.pdf",
        text: "本文件介绍档案管理的一般要求。",
      },
      {
        sourceName: "2026年预算项目支出绩效目标申报表.xls",
        text: [
          "数量指标 | 预计新增档案整理移库 | 1000标箱",
          "社会效益指标 | 参保群众权益追溯成功率 | ≥98%",
          "满意度指标 | 参保群众权益追溯响应满意度 | ≥95%",
        ].join("\n"),
      },
    ]);

    expect(digest).toContain("【权威目标文件原文证据】");
    expect(digest).toContain("《2026年预算项目支出绩效目标申报表.xls》");
    expect(digest).toContain("参保群众权益追溯成功率 | ≥98%");
    expect(digest).not.toContain("普通政策文件.pdf");
  });

  it("repairs wrong values, restores missing indicators and rejects weaker suggestions", () => {
    const report = [
      "一、评估对象",
      "（一）项目绩效目标",
      "2.具体绩效指标",
      "（1）产出数量指标",
      "（2）产出质量指标",
      "（3）产出进度指标",
      "（4）产出成本指标",
      "（5）经济效益",
      "根据现有资料无法确认具体的直接经济效益指标值。",
      "（6）社会效益指标",
      "（7）环境效益指标",
      "（8）可持续影响指标",
      "（9）服务对象满意度指标",
      "参保群众权益追溯响应满意度：100.00%。",
      "二、评估方式和方法",
      "三、评估内容与结论",
      "资料显示，参保群众权益追溯响应满意度：100.00%。",
      "四、相关建议",
      "建议补充服务对象满意度指标的具体目标值（如≥90%）。",
    ].join("\n");
    const result = reconcileAuthoritativeTargetNarrative(report, extractAuthoritativeTargetFacts(rows));

    expect(result).toContain("参保群众权益追溯响应满意度目标值为≥95%");
    expect(result).toContain("参保群众权益追溯响应率目标值为100%");
    expect(result).toContain("社保业务档案支撑政策制定次数目标值为≥2次");
    expect(result).toContain("全年档案存储成本控制率目标值为≤98%");
    expect(result).toContain("档案存储设施稳定运行率目标值为≤99%");
    expect(result).toContain("业务科室档案调取需求满足率目标值为100%");
    expect(result).toContain("节约行政成本目标值为超13万元/年");
    expect(result).not.toContain("无法确认具体的直接经济效益指标值");
    expect(result).not.toContain("如≥90%");
    expect(result.match(/参保群众权益追溯响应满意度目标值为≥95%/g)?.length).toBeGreaterThanOrEqual(2);
    const socialSection = result.slice(
      result.indexOf("（6）社会效益指标"),
      result.indexOf("（7）环境效益指标"),
    );
    expect(socialSection).toContain("社保业务档案支撑政策制定次数目标值为≥2次");
  });

  it("restores a social target under its own heading even when it appears elsewhere", () => {
    const socialRows = [{
      sourceName: "绩效目标申报表.docx",
      text: "社保业务档案支撑政策制定次数：≥2次",
    }];
    const report = [
      "一、评估对象",
      "（一）项目绩效目标",
      "2.具体绩效指标",
      "（5）经济效益",
      "项目总体目标提到社保业务档案支撑政策制定次数。",
      "（6）社会效益指标",
      "（7）环境效益指标",
      "二、评估方式和方法",
    ].join("\n");

    const result = reconcileAuthoritativeTargetNarrative(
      report,
      extractAuthoritativeTargetFacts(socialRows),
    );
    const socialSection = result.slice(
      result.indexOf("（6）社会效益指标"),
      result.indexOf("（7）环境效益指标"),
    );
    expect(socialSection).toContain("社保业务档案支撑政策制定次数目标值为≥2次");
  });

  it("keeps source file and original excerpt in report highlights", () => {
    const marked = applyReportCitations(
      "<p>参保群众权益追溯响应满意度目标值为≥95%。</p>",
      [{
        text: "参保群众权益追溯响应满意度目标值为≥95%",
        sourceTitle: "事前绩效评估绩效目标申报表.docx",
        fileName: "事前绩效评估绩效目标申报表.docx",
        location: "片段 2",
        snippet: "参保群众权益追溯响应满意度≥95%",
      }],
    );

    expect(marked).toContain("data-report-citation=\"true\"");
    expect(marked).toContain("data-source=\"事前绩效评估绩效目标申报表.docx · 片段 2\"");
    expect(extractReportCitationEvidence(marked)).toContainEqual({
      text: "参保群众权益追溯响应满意度目标值为≥95%",
      source: "事前绩效评估绩效目标申报表.docx · 片段 2",
      snippet: "参保群众权益追溯响应满意度≥95%",
    });
    expect(stripReportCitations(marked)).not.toContain("data-report-citation");
  });

  it("does not turn industry-standard pass rates or generated reports into project targets", () => {
    const facts = extractAuthoritativeTargetFacts([
      ...rows,
      {
        sourceName: "DA-T 81-2019 档案盒检测规范.pdf",
        location: "片段 3",
        text: "平行测定合格率应当达到≥95%。",
      },
      {
        sourceName: "Performance Evaluation Report (7).docx",
        sourceType: "project_material",
        location: "片段 8",
        text: "档案完好率目标值为100%。",
      },
    ]);

    expect(facts.some((fact) => fact.name.includes("平行测定合格率"))).toBe(false);
    expect(facts.some((fact) => fact.sourceName.includes("Performance Evaluation Report"))).toBe(false);
  });

  it("uses the formal target table instead of lower-priority narrative for the same category", () => {
    const facts = extractAuthoritativeTargetFacts([
      {
        sourceName: "2026年预算项目支出绩效目标申报表.xls",
        text: [
          "质量指标 | 档案存储环境达标率（温度14-24℃、湿度45%-60%） | 100%",
          "质量指标 | 档案完好率（无破损、遗失） | 100%",
          "质量指标 | 档案调阅准确率（调阅档案与申请匹配） | 100%",
        ].join("\n"),
      },
      {
        sourceName: "项目申报书.docx",
        text: "预期实现档案完好率100%。",
      },
    ]);

    expect(facts.map((fact) => fact.name)).toEqual(expect.arrayContaining([
      "档案存储环境达标率",
      "档案完好率",
      "档案调阅准确率",
    ]));
    expect(facts).toHaveLength(3);
    expect(facts.every((fact) => fact.category === "quality")).toBe(true);
  });

  it("extracts quantity and progress rows from a formal spreadsheet", () => {
    const facts = extractAuthoritativeTargetFacts([{
      sourceName: "2026年预算项目支出绩效目标申报表.xls",
      text: [
        "数量指标 | 历史托管储存业务档案 | 13969.56标箱",
        "数量指标 | 预计新增档案整理移库 | 1000标箱",
        "进度指标 | 第一季度档案基础工作完成进度 | 25%",
      ].join("\n"),
    }]);
    const byName = new Map(facts.map((fact) => [fact.name, fact]));

    expect(byName.get("历史托管储存业务档案")?.displayValue).toBe("13969.56标箱");
    expect(byName.get("预计新增档案整理移库")?.displayValue).toBe("1000标箱");
    expect(byName.get("第一季度档案基础工作完成进度")?.displayValue).toBe("25%");
    expect(byName.get("第一季度档案基础工作完成进度")?.category).toBe("progress");
  });

  it("normalizes machine-like equality wording", () => {
    const result = reconcileAuthoritativeTargetNarrative(
      [
        "一、评估对象",
        "（一）项目绩效目标",
        "2.具体绩效指标",
        "（1）产出数量指标",
        "金额目标值为=902000元。",
        "二、评估方式和方法",
      ].join("\n"),
      extractAuthoritativeTargetFacts(rows),
    );
    expect(result).not.toContain("目标值为=");
  });

  it("keeps only one near-duplicate paragraph for the same target in the target chapter", () => {
    const repeatRows = [{
      sourceName: "绩效目标申报表.docx",
      text: "参保群众权益追溯成功率≥98%。",
    }];
    const report = [
      "一、评估对象",
      "（一）项目绩效目标",
      "2.具体绩效指标",
      "（2）产出质量指标",
      "参保群众权益追溯成功率≥98%，用于衡量追溯工作质量。",
      "参保群众权益追溯成功率≥98%，反映追溯业务完成质量。",
      "参保群众权益追溯成功率≥98%，是项目质量考核的重要指标。",
      "二、评估方式和方法",
    ].join("\n");
    const result = reconcileAuthoritativeTargetNarrative(
      report,
      extractAuthoritativeTargetFacts(repeatRows),
    );
    expect(result.match(/参保群众权益追溯成功率/g)?.length).toBe(1);
  });
});

describe("report quality corrections", () => {
  it("uses the latest uploaded version of the same standard", () => {
    expect(normalizeUploadedStandardVersions(
      "项目执行参照DA/T 31-2005。",
      "《10.DAT 31-2017 纸质档案数字化规范.pdf》：DA/T 31-2017",
    )).toContain("DA/T31-2017");
  });

  it("repairs a numeric claim to the file that actually contains the number", () => {
    const result = repairNumericSourceAttributions(
      "根据《项目申报书.docx》及《项目背景及发展规划.docx》，截至2024年底参保人数突破120万人，较上一年度增长15%。",
      [
        "《项目申报书.docx》：项目基本情况。",
        "《北京市通州区人力资源和社会保障局档案存储项目-实施方案.docx》：截至2024年底参保人数突破120万人，较上一年度增长15%。",
      ].join("\n"),
    );
    expect(result).toContain("根据《北京市通州区人力资源和社会保障局档案存储项目-实施方案.docx》");
    expect(result).not.toContain("根据《项目申报书.docx》");
  });

  it("repairs numeric attribution when the fact appears later in a source evidence block", () => {
    const result = repairNumericSourceAttributions(
      "根据《项目申报书.docx》，截至2024年底参保人数突破120万人。",
      [
        "《项目申报书.docx》/片段1：项目基本情况。",
        "《项目实施方案.docx》/片段1：项目背景。",
        "截至2024年底，全区参保总量已突破120万人。",
      ].join("\n"),
    );
    expect(result).toContain("根据《项目实施方案.docx》");
  });

  it("uses structured per-file text instead of ambiguous formatted evidence", () => {
    const result = repairNumericSourceAttributions(
      "根据《项目申报书.docx》及《项目背景及发展规划.docx》，截至2024年底参保人数突破120万人。",
      "格式化证据中可能重复出现120万人。",
      [
        { sourceName: "项目申报书.docx", text: "项目基本情况。" },
        { sourceName: "项目背景及发展规划.docx", text: "项目发展规划。" },
        {
          sourceName: "北京市通州区档案存储项目-实施方案.docx",
          text: "截至2024年底，全区参保总量已突破120万人。",
        },
      ],
    );
    expect(result).toContain("根据《北京市通州区档案存储项目-实施方案.docx》");
    expect(result).not.toContain("根据《项目申报书.docx》");
  });

  it("never uses a generated report as the source of a numeric fact", () => {
    const result = repairNumericSourceAttributions(
      "根据《系统生成报告-旧稿.docx》，项目涉及120万人。",
      [
        "《系统生成报告-旧稿.docx》：项目涉及120万人。",
        "《项目实施方案.docx》：截至2024年底参保总量突破120万人。",
      ].join("\n"),
    );
    expect(result).toContain("根据《项目实施方案.docx》");
    expect(result).not.toContain("根据《系统生成报告-旧稿.docx》");
  });

  it("distinguishes procurement applicability from a confirmed procurement method", () => {
    const result = normalizeProcurementStatement(
      "现有资料未提供2026年度政府采购意向公开或采购方式审批文件。",
      "项目是否涉及政府采购：是。",
    );
    expect(result).toContain("已确认该项目涉及政府采购");
    expect(result).toContain("未明确具体采购方式");
  });

  it("states a proposed procurement method without treating it as final approval", () => {
    const result = normalizeProcurementStatement(
      "现有资料未提供政府采购方式审批文件。",
      "项目是否涉及政府采购 是。实施方案提出拟采用单一来源方式。",
    );
    expect(result).toContain("涉及政府采购");
    expect(result).toContain("拟采用单一来源");
    expect(result).toContain("以对应审批、采购或公示文件为准");
  });

  it("adds uploaded standard files to the project background without hardcoding a standard", () => {
    const result = ensureUploadedStandardsReferenced(
      "一、评估对象\n（三）项目概况\n1.项目背景\n项目依法实施。",
      "《10.DAT 31-2017 纸质档案数字化规范.pdf》/片段1：DA/T 31-2017。",
    );
    expect(result).toContain("《10.DAT 31-2017 纸质档案数字化规范.pdf》");
    expect(result).toContain("不作为档案存储服务价格依据");
  });

  it("inserts the procurement disclosure even when the draft omitted procurement", () => {
    const result = normalizeProcurementStatement(
      "一、评估对象\n（三）项目概况\n1.项目背景\n项目依法实施。",
      "",
      [{ sourceName: "申报书.docx", text: "项目是否涉及政府采购：是。" }],
    );
    expect(result).toContain("已确认该项目涉及政府采购");
    expect(result).toContain("未明确具体采购方式");
  });

  it("removes unsupported policy clauses but keeps supported contract facts", () => {
    const result = removeUnsupportedPolicyClauses(
      "单价依据《历史合同.pdf》约定的58元执行，该价格低于《虚构采购目录》规定的60元上限，且符合《虚构补助办法》规定的55-65元区间。",
      "",
      [{
        sourceName: "历史合同.pdf",
        text: "档案存储服务单价为58元/标箱/年。",
      }],
    );
    expect(result).toContain("《历史合同.pdf》");
    expect(result).not.toContain("虚构采购目录");
    expect(result).not.toContain("虚构补助办法");
  });

  it("normalizes duplicated units and exact repeated sentences", () => {
    const result = applyReportQualityCorrections(
      "历史档案数量为13969.56标箱标箱。\n应急保障：预留备用金。应急保障：预留备用金。",
      "历史档案数量为13969.56标箱。",
    );
    expect(result).toContain("13969.56标箱");
    expect(result).not.toContain("标箱标箱");
    expect(result.match(/应急保障：预留备用金/g)?.length).toBe(1);
  });

  it("applies all final quality corrections together", () => {
    const result = applyReportQualityCorrections(
      "根据《旧资料.docx》，业务量达到120万人。项目依据DA/T 31-2005，指标目标值为=100%。",
      "《实施方案.docx》：业务量达到120万人。标准为DA/T 31-2017，指标目标值为100%。",
    );
    expect(result).toContain("《实施方案.docx》");
    expect(result).toContain("DA/T31-2017");
    expect(result).toContain("目标值为100%");
  });
});

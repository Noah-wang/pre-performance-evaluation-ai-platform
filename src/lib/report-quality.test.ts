import { describe, expect, it } from "vitest";
import {
  applyReportQualityCorrections,
  auditReportSourceCoverage,
  containsCorruptedReportText,
  ensureAllSourcesAcknowledged,
  removeUnsupportedNumericClaims,
} from "../../supabase/functions/_shared/reportQuality";

describe("report quality corrections", () => {
  it("summarizes reviewed sources by category without listing every file", () => {
    const sources = [
      "项目申报书.docx",
      "3.中华人民共和国档案行业标准-《档案保管外包服务管理规范》DAT 67-2017.pdf",
      "预算测算说明.xlsx",
      "专家会议纪要.docx",
    ];
    const report = "（三）评估方式\n1.现场调研\n暂无记录。\n2.查阅资料\n已查阅《项目申报书.docx》。\n3.召开专家预评估会\n已召开。";
    const corrected = ensureAllSourcesAcknowledged(report, sources);

    expect(corrected).toContain("项目申报及绩效目标");
    expect(corrected).toContain("政策法规及标准规范");
    expect(corrected).toContain("预算测算及合同结算");
    expect(corrected).toContain("会议纪要及专家意见");
    expect(corrected).not.toContain("3.中华人民共和国档案行业标准");
    expect(corrected).toContain("具体文件名称仅在对应事实依据处按实际引用");
  });

  it("replaces an existing long source inventory with the compact summary", () => {
    const report = [
      "（三）评估方式",
      "2.查阅资料",
      "本次评估已逐份查阅并核验以下补充资料：《项目申报书.docx》、《预算明细.xlsx》、《会议纪要.docx》。上述资料按其实际内容用于项目背景、预算测算、绩效目标、实施安排、标准依据和专家意见的交叉验证；未形成直接结论的资料仅作为核验范围记录，不据此推定资料中未载明的事实。",
      "3.召开专家预评估会",
      "已召开。",
    ].join("\n");
    const corrected = ensureAllSourcesAcknowledged(
      report,
      ["项目申报书.docx", "预算明细.xlsx", "会议纪要.docx"],
    );

    expect(corrected).not.toContain("逐份查阅并核验以下补充资料");
    expect(corrected).toContain("项目申报及绩效目标、预算测算及合同结算、会议纪要及专家意见");
  });

  it("does not append a source inventory to unrelated chapters", () => {
    const report = "三、评估内容与结论\n（一）立项必要性\n项目具有必要性。";
    expect(ensureAllSourcesAcknowledged(report, ["项目申报书.docx"])).toBe(report);
  });

  it("cleans duplicate company suffixes and repeated punctuation", () => {
    const corrected = applyReportQualityCorrections(
      "（三）项目概况\n项目服务商为申江万国数据信息股份有限公司。信息股份有限公司。。",
      "",
    );
    expect(corrected).toContain("申江万国数据信息股份有限公司。");
    expect(corrected).not.toContain("信息股份有限公司。信息股份有限公司");
    expect(corrected).not.toContain("。。");
  });

  it("removes a contradictory duplicate market-comparison sentence", () => {
    const corrected = applyReportQualityCorrections(
      "因转运风险较高，延续使用原服务商，未再次进行三方比价。再次进行三方比价。",
      "",
    );
    expect(corrected).toContain("未再次进行三方比价。");
    expect(corrected).not.toContain("未再次进行三方比价。再次进行三方比价");
  });

  it("removes a sentence containing a number absent from project evidence", () => {
    const report = "项目年度预算为90.2万元。中期资金总额为40.1万元。";
    const corrected = removeUnsupportedNumericClaims(
      report,
      "预算文件载明项目年度预算为90.2万元。",
    );
    expect(corrected).toContain("90.2万元");
    expect(corrected).not.toContain("40.1万元");
  });

  it("treats equivalent decimal percentages as the same evidence value", () => {
    const report = "参保群众权益追溯响应率为100.00%。";
    const corrected = removeUnsupportedNumericClaims(report, "目标表载明响应率为100%。");
    expect(corrected).toBe(report);
  });

  it("rejects unreadable OCR fragments copied into report prose", () => {
    const corrupted = "根据绩效目标表可见，2026年上 L_ 项目名称 Rt ene 项目属性 ee 和天上期 ogg 年 Pp ERE hi 中期目标完成档案常态化存储 | comeay ee 年度项目费用控制。";
    expect(containsCorruptedReportText(corrupted)).toBe(true);
    expect(containsCorruptedReportText("根据绩效目标表可见，项目年度费用控制在90.2万元以内。")).toBe(false);
  });

  it("does not treat the exact source inventory as corrupted prose", () => {
    const inventory = "本次评估已逐份查阅并核验以下补充资料：《项目申报书.docx》、《10.DAT 31-2017 纸质档案数字化规范.pdf》、《预算明细.xlsx》、《GBT 31599-2015.pdf》、《DA-T 68-2017.pdf》、《会议纪要.docx》、《实施方案.docx》、《内部审计制度.docx》。上述资料均已核验。";
    expect(containsCorruptedReportText(inventory)).toBe(false);
  });

  it("deduplicates consecutive references to the same uploaded file", () => {
    const result = applyReportQualityCorrections(
      "根据《实施方案.docx》、《实施方案.docx》载明，项目已明确工作安排。",
      "《实施方案.docx》：项目已明确工作安排。",
      ["实施方案.docx"],
    );

    expect(result).toBe("根据《实施方案.docx》载明，项目已明确工作安排。");
  });

  it("cleans a repeated trailing certification word", () => {
    const result = applyReportQualityCorrections(
      "服务商具备国家秘密载体保管资质及ISO9001认证。认证。",
      "",
    );

    expect(result).toBe("服务商具备国家秘密载体保管资质及ISO9001认证。");
  });

  it("cleans repeated quality wording and moves a leading citation before the subject", () => {
    const result = applyReportQualityCorrections(
      "本项目《项目申报书.docx》立项依据充分，具备成熟服务体系。体系。能够确保服务质量。质量。加强日常监管。监管。",
      "",
    );

    expect(result).toBe("根据《项目申报书.docx》，本项目立项依据充分，具备成熟服务体系。能够确保服务质量。加强日常监管。");
  });

  it("corrects a mixed archival-project draft from structured source documents", () => {
    const report = [
      "一、评估对象",
      "（三）项目概况",
      "1.项目背景",
      "根据《项目申报书.docx》，截至2024年底参保人数突破120万人。",
      "项目执行参照DA/T 31-2005。",
      "项目年度预算为90.2万元，历史档案数量为13969.56标箱标箱。",
      "根据《历史合同.pdf》，存储单价为58元/标箱/年，且符合《虚构采购目录》规定的60元上限。",
      "二、评估方式和方法",
      "（三）评估方式",
      "1.项目基本情况现场调研",
      "2.查阅资料",
      "3.召开专家预评估会",
    ].join("\n");
    const documents = [
      {
        sourceName: "北京市通州区档案存储项目-实施方案.docx",
        text: "截至2024年底，全区参保总量突破120万人。项目是否涉及政府采购：是。",
      },
      {
        sourceName: "2026年预算项目支出绩效目标申报表.xlsx",
        text: "项目年度预算90.2万元。历史托管储存业务档案13969.56标箱。",
      },
      {
        sourceName: "申江万国档案托管收费历史合同.pdf",
        text: "档案存储服务单价为58元/标箱/年。",
      },
      {
        sourceName: "10.DAT 31-2017 纸质档案数字化规范.pdf",
        text: "DA/T 31-2017 纸质档案数字化规范。",
      },
    ];

    const result = applyReportQualityCorrections(
      report,
      "",
      documents.map((item) => item.sourceName),
      documents,
    );

    expect(result).toContain("根据《北京市通州区档案存储项目-实施方案.docx》");
    expect(result).toContain("DA/T31-2017");
    expect(result).toContain("13969.56标箱");
    expect(result).not.toContain("标箱标箱");
    expect(result).toContain("58元/标箱/年");
    expect(result).not.toContain("虚构采购目录");
    expect(result).toContain("已确认该项目涉及政府采购");
    expect(result).toContain("未明确具体采购方式");
    expect(result).toContain("不作为档案存储服务价格依据");
  });
});

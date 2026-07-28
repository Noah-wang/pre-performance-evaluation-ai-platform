import { describe, expect, it } from "vitest";
import {
  buildPerFileEvidenceCoverage,
  buildSourceAliasEntries,
  buildSourceAliasCandidates,
  buildSourceAliasMap,
  ensureServiceProviderDisclosure,
  extractServiceProviderMentions,
  formatPerFileEvidenceCoverage,
  normalizeSourceKey,
  rankServiceProviderMentions,
  reconcileAuthoritativeScoreNarrative,
  rewriteProjectMaterialCitations,
} from "../../supabase/functions/_shared/reportEvidence";

describe("report evidence normalization", () => {
  it("rewrites synthetic system-record filenames as system records", () => {
    const result = rewriteProjectMaterialCitations(
      [
        "根据《会议纪要-会议纪要：档案存储专家会.docx》，专家提出完善权限管理。",
        "根据《评估方案-评估方案：档案存储及管理服务项目 / 评估实施方案2026716.docx》，评估组开展资料核验。",
      ].join("\n"),
      ["真实上传的项目申报书.docx"],
    );

    expect(result).toContain("系统内已保存的“档案存储专家会”会议纪要");
    expect(result).toContain("系统内已保存的“档案存储及管理服务项目 / 评估实施方案2026716”评估方案");
    expect(result).not.toContain("会议纪要-会议纪要");
    expect(result).not.toContain("评估方案-评估方案");
  });

  it("maps a material title to the unique uploaded file name", () => {
    const aliases = buildSourceAliasMap([
      {
        title: "可行性研究报告",
        file_name: "财政支出预期绩效报告（档案存储项目）.docx",
      },
      {
        title: "实施方案",
        file_name: "档案托管服务工作安排及安全管理制度.docx",
      },
    ]);

    expect(aliases[normalizeSourceKey("可行性研究报告")])
      .toBe("财政支出预期绩效报告（档案存储项目）.docx");
    expect(aliases[normalizeSourceKey("实施方案")])
      .toBe("档案托管服务工作安排及安全管理制度.docx");
    expect(buildSourceAliasEntries([
      {
        title: "可行性研究报告",
        file_name: "财政支出预期绩效报告（档案存储项目）.docx",
      },
    ])).toContainEqual({
      alias: "可行性研究报告",
      fileName: "财政支出预期绩效报告（档案存储项目）.docx",
    });
  });

  it("does not guess when one material title points to multiple files", () => {
    const rows = [
      { title: "实施方案", file_name: "实施方案第一版.docx" },
      { title: "实施方案", file_name: "实施方案第二版.docx" },
    ];
    const aliases = buildSourceAliasMap(rows);
    const candidates = buildSourceAliasCandidates(rows);

    expect(aliases[normalizeSourceKey("实施方案")]).toBeUndefined();
    expect(candidates[normalizeSourceKey("实施方案")]).toEqual([
      "实施方案第一版.docx",
      "实施方案第二版.docx",
    ]);
  });

  it("extracts service providers from evidence without binding to one company", () => {
    const mentions = extractServiceProviderMentions([
      {
        sourceName: "档案托管收费明细.xlsx",
        text: "根据合同及结算清单，项目服务商为申江万国数据信息股份有限公司，继续承担档案托管服务。",
      },
      {
        sourceName: "采购结果通知书.docx",
        text: "本项目由北京示例科技有限公司承接，并按采购结果执行。",
      },
    ]);

    expect(mentions.map((item) => item.name)).toEqual([
      "申江万国数据信息股份有限公司",
      "北京示例科技有限公司",
    ]);
    expect(mentions[0].sourceName).toBe("档案托管收费明细.xlsx");
  });

  it("extracts a provider from an uploaded fee-detail file name", () => {
    const mentions = extractServiceProviderMentions([
      {
        sourceName: "申江万国数据信息股份有限公司-档案托管寄存收费明细表.xlsx",
        text: "申江万国数据信息股份有限公司-档案托管寄存收费明细表.xlsx",
      },
    ]);

    expect(mentions[0]?.name).toBe("申江万国数据信息股份有限公司");
  });

  it("removes table and field labels from an extracted provider name", () => {
    const mentions = extractServiceProviderMentions([
      {
        sourceName: "收费总表.xlsx",
        text: "服务商为收费总表申江万国数据信息股份有限公司，承担档案托管服务。",
      },
    ]);

    expect(mentions[0]?.name).toBe("申江万国数据信息股份有限公司");
  });

  it("ranks repeatedly supported providers ahead of incidental company mentions", () => {
    const ranked = rankServiceProviderMentions(extractServiceProviderMentions([
      {
        sourceName: "市场询价记录.xlsx",
        text: "询价对象包括北京候选数据有限公司。",
      },
      {
        sourceName: "真实数据服务有限公司-项目合同.docx",
        text: "本项目由北京真实数据服务有限公司承接。",
      },
      {
        sourceName: "真实数据服务有限公司-结算明细.xlsx",
        text: "北京真实数据服务有限公司档案服务结算金额为20万元。",
      },
      {
        sourceName: "真实数据服务有限公司-实施方案.docx",
        text: "服务商为北京真实数据服务有限公司。",
      },
    ]));

    expect(ranked[0]?.name).toBe("北京真实数据服务有限公司");
  });

  it("forces the highest-ranked service provider into project overview", () => {
    const report = [
      "一、项目基本情况",
      "（三）项目概况",
      "本项目拟开展档案托管服务。",
      "（四）项目绩效目标",
      "提升档案管理质量。",
    ].join("\n");
    const result = ensureServiceProviderDisclosure(report, [{
      name: "北京真实数据服务有限公司",
      sourceName: "服务合同.docx",
      supportingSources: ["服务合同.docx", "结算明细.xlsx"],
      excerpt: "项目服务商为北京真实数据服务有限公司。",
    }]);

    expect(result).toContain("项目相关服务商为北京真实数据服务有限公司");
    expect(result).toContain("《服务合同.docx》");
    expect(result).toContain("《结算明细.xlsx》");
    expect(result.indexOf("北京真实数据服务有限公司"))
      .toBeLessThan(result.indexOf("（四）项目绩效目标"));
  });

  it("does not duplicate a service provider already present in the report", () => {
    const report = "（三）项目概况\n项目服务商为北京真实数据服务有限公司。";
    const result = ensureServiceProviderDisclosure(report, [{
      name: "北京真实数据服务有限公司",
      sourceName: "服务合同.docx",
      excerpt: "项目服务商为北京真实数据服务有限公司。",
    }]);

    expect(result.match(/北京真实数据服务有限公司/g)).toHaveLength(1);
  });

  it("does not append a service provider after recommendations or attachments", () => {
    const report = [
      "四、相关建议",
      "建议完善预算测算。",
      "六、附件",
      "1.项目申报书",
    ].join("\n");
    const result = ensureServiceProviderDisclosure(report, [{
      name: "北京真实数据服务有限公司",
      sourceName: "服务合同.docx",
      excerpt: "项目服务商为北京真实数据服务有限公司。",
    }]);

    expect(result).toBe(report);
  });

  it("uses current aggregate scores instead of a historical single-expert score", () => {
    const result = reconcileAuthoritativeScoreNarrative([
      "三、评估内容与结论",
      "（一）立项必要性",
      "事实依据：专家评议意见书中，立项必要性得分为10分（满分10分），认为项目依据充分。",
      "发现的问题：部分专家指出立项必要性理由不充分。",
      "（二）总体结论",
      "经专家组综合评估，本项目总平均得分为55.00分（满分60.00分）。",
      "立项必要性：满分10分，平均得分10.00分；",
    ].join("\n"), {
      average: 55,
      maxAverage: 60,
      expertCount: 3,
      indicators: [{
        name: "立项必要性",
        average: 26 / 3,
        maxAverage: 10,
        expertCount: 3,
        reasons: ["立项必要性理由不充分"],
      }],
    });

    expect(result).toContain("3位专家评分");
    expect(result).toContain("立项必要性平均得分为8.67分（满分10.00分）");
    expect(result).toContain("当前评分记录中的扣分理由包括“立项必要性理由不充分”");
    expect(result).not.toContain("立项必要性得分为10分");
  });

  it("does not describe a full-score indicator as having expert deductions", () => {
    const result = reconcileAuthoritativeScoreNarrative([
      "（一）项目合规性",
      "事实依据：专家意见书中，项目合规性得分为10分（满分10分）。",
      "发现的问题：专家意见指出合规性理由不充分。",
      "（二）总体结论",
    ].join("\n"), {
      average: 10,
      maxAverage: 10,
      expertCount: 2,
      indicators: [{
        name: "项目合规性",
        average: 10,
        maxAverage: 10,
        expertCount: 2,
        reasons: [],
      }],
    });

    expect(result).toContain("当前评分记录未显示该指标存在扣分");
    expect(result).toContain("当前系统评分未记录该指标扣分；从资料完整性角度仍需关注");
    expect(result).not.toContain("专家意见指出");
  });

  it("rewrites material titles to real uploaded file names", () => {
    const rows = [
      { title: "实施方案", file_name: "项目实施与安全管理方案.docx" },
      { title: "实施方案", file_name: "服务商档案管理实施方案.docx" },
    ];
    const rewritten = rewriteProjectMaterialCitations(
      "根据《实施方案》及《项目实施与安全管理方案》可见。",
      rows.map((row) => row.file_name),
      buildSourceAliasMap(rows),
      buildSourceAliasCandidates(rows),
    );

    expect(rewritten).toContain("《项目实施与安全管理方案.docx》");
    expect(rewritten).toContain("《服务商档案管理实施方案.docx》");
    expect(rewritten).not.toContain("《实施方案》");
  });

  it("keeps every file in a large project and extracts facts from all chunks", () => {
    const files = Array.from({ length: 45 }, (_, index) => ({
      id: `file-${index + 1}`,
      title: index === 44 ? "服务商实施方案" : `资料项${index + 1}`,
      file_name: index === 44 ? "最后一份服务商方案.docx" : `项目资料${index + 1}.docx`,
      category: "项目资料",
      status: "indexed",
      chunk_count: 3,
    }));
    const chunks = files.flatMap((file, fileIndex) => [
      {
        file_id: file.id,
        chunk_index: 0,
        content: `${file.file_name}第一段，说明项目背景。`,
      },
      {
        file_id: file.id,
        chunk_index: 1,
        content: fileIndex === 44
          ? "项目服务商为北京最后一家服务有限公司，合同金额为123.45万元。"
          : `第${fileIndex + 1}份资料的预算金额为${fileIndex + 1}万元。`,
        fact_signals: fileIndex === 44 ? ["123.45万元"] : [`${fileIndex + 1}万元`],
        priority: 20,
      },
      {
        file_id: file.id,
        chunk_index: 2,
        content: `${file.file_name}最后一段，说明实施风险。`,
      },
    ]);

    const coverage = buildPerFileEvidenceCoverage(files, chunks, { totalCharacters: 22000 });
    const formatted = formatPerFileEvidenceCoverage(coverage);

    expect(coverage).toHaveLength(45);
    expect(formatted).toContain("《项目资料1.docx》");
    expect(formatted).toContain("《最后一份服务商方案.docx》");
    expect(formatted).toContain("北京最后一家服务有限公司");
    expect(formatted).toContain("123.45万元");
  });

  it("uses more than one chunk so later evidence is not hidden by the first paragraph", () => {
    const coverage = buildPerFileEvidenceCoverage(
      [{
        id: "provider-file",
        title: "实施方案",
        file_name: "真实服务商实施方案.docx",
        status: "indexed",
        chunk_count: 3,
      }],
      [
        { file_id: "provider-file", chunk_index: 0, content: "第一部分为项目概况。" },
        {
          file_id: "provider-file",
          chunk_index: 1,
          content: "本项目由北京真实数据服务有限公司承接，服务期为三年。",
          priority: 30,
        },
        { file_id: "provider-file", chunk_index: 2, content: "第三部分为保障措施。" },
      ],
    );

    expect(coverage[0].keyFacts).toContain("北京真实数据服务有限公司");
    expect(coverage[0].excerpts.map((item) => item.text).join(" "))
      .toContain("北京真实数据服务有限公司");
  });

  it("repairs nested citations back to the exact uploaded filename", () => {
    const filename = "3.中华人民共和国档案行业标准-《档案保管外包服务管理规范》DAT 67-2017.pdf";
    const rewritten = rewriteProjectMaterialCitations(
      "依据“3.中华人民共和国档案行业标准-“3.中华人民共和国档案行业标准-《档案保管外包服务管理规范》DAT 67-2017.pdf”DAT 67-2017.pdf”执行。",
      [filename],
    );

    expect(rewritten).toContain(`“${filename}”`);
    expect(rewritten.match(/DAT 67-2017\.pdf/g)).toHaveLength(1);
  });
});

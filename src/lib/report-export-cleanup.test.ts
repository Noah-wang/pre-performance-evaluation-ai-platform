import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: async () => ({ data: [], error: null }),
    }),
  },
}));

import { normalizeEvaluationReportTextForExport } from "./docxExport";
import { extractReportTocEntries } from "./reportToc";

const dirtyReport = `
一、评估对象
项目名称：档案存储及管理服务项目
项目单位：北京市通州区档案馆

二、评估依据和方法
共查阅项目资料中的资料40份，资料40份，资料0份。
索引未检出，需人工核对或重新索引。

一、评估对象
项目名称：
项目单位：
主管部门：

三、评估内容与结论
（一）立项必要性
根据现有资料，项目立项依据较充分。

四、相关建议
（一）针对资料完整性不足的问题，建议项目单位补充预算测算、实施方案和绩效目标资料。
（二）针对成本测算依据不足的问题，建议补充市场询价或同类项目价格依据。
1.针对立项必要性提出建议。
2.针对投入经济性提出建议。
3.针对绩效目标合理性提出建议。
4.针对实施方案可行性提出建议。
5.针对筹资合规性提出建议。
6.针对可持续性提出建议。

五、其他需要说明的问题
（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估形成的。

六、附件
1.事前绩效评估项目预期绩效报告
2.专家意见书
3.项目资料清单
4.专家组及工作组情况表
一、评估对象
项目名称：
项目单位：
`;

describe("evaluation report cleanup", () => {
  it("keeps only concise headings in the table of contents", () => {
    const entries = extractReportTocEntries(dirtyReport).map((entry) => entry.text);

    expect(entries).toContain("四、相关建议");
    expect(entries).not.toContain("（一）针对资料完整性不足的问题，建议项目单位补充预算测算、实施方案和绩效目标资料。");
  });

  it("removes duplicate skeletons, generic suggestions and internal system wording before Word export", () => {
    const text = normalizeEvaluationReportTextForExport(dirtyReport);

    expect(text).toContain("共查阅项目单位提供的相关资料40份");
    expect(text).not.toContain("资料40份，资料40份，资料0份");
    expect(text).not.toContain("索引未检出");
    expect(text).not.toContain("需人工核对或重新索引");
    expect(text).not.toContain("1.针对立项必要性提出建议");
    expect(text).toContain("（一）针对资料完整性不足的问题");

    const openingCount = (text.match(/一、评估对象/g) ?? []).length;
    expect(openingCount).toBe(1);
  });

  it("normalizes formal export formatting edge cases", () => {
    const text = normalizeEvaluationReportTextForExport(`
二、评估方式和方法
评估过程严格遵循五维论证逻辑，结合资料开展评估。
专家重点关注了新旧标准更替（如DA/T 31-2017与DA/T 31-2017）对项目实施的影响。

三、评估内容与结论
（二）投入经济性
1.事实依据资料显示，项目预计节约行政成本。
2.发现的问题预算测算依据需进一步完善。

六、附件
1.随便写的附件
2.另一个附件
`);

    expect(text).toContain("六维论证逻辑");
    expect(text).not.toContain("DA/T 31-2017与DA/T 31-2017");
    expect(text).toContain("1.事实依据\n资料显示");
    expect(text).toContain("2.发现的问题\n预算测算依据");
    expect(text).toContain("（一）事前绩效评估项目预期绩效报告");
    expect(text).toContain("（四）专家组及工作组情况表");
    expect(text).not.toContain("随便写的附件");
  });
});

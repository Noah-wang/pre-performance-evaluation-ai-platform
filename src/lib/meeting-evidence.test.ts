import { describe, expect, it } from "vitest";
import { summarizeMeetingEvidence } from "../../supabase/functions/_shared/meetingEvidence";

describe("meeting evidence summary", () => {
  it("removes timestamps and speaker labels while retaining substantive opinions", () => {
    const result = summarizeMeetingEvidence({
      transcriptText: [
        "[22:36:51] 主持人：各位好，今天开始会议。",
        "[22:37:02] 王老师：建议补充预算测算依据，并明确数据安全和备份机制。",
        "[22:38:10] 主持人：好的。",
        "[22:38:54] 王老师：后续还需要完善绩效目标的量化口径。",
      ].join("\n"),
    });

    expect(result).toContain("补充预算测算依据");
    expect(result).toContain("完善绩效目标的量化口径");
    expect(result).not.toMatch(/22:|主持人|王老师|各位好/);
  });

  it("prefers analyzed conclusions and removes repeated raw sentences", () => {
    const repeated = "建议建立严格的数据访问和操作记录制度。";
    const result = summarizeMeetingEvidence({
      analysisText: `会议认为项目方案基本可行；${repeated}`,
      minuteText: `${repeated} ${repeated}`,
      transcriptText: `[00:01] 专家：${repeated}`,
      maxPoints: 5,
    });

    expect(result).toContain("项目方案基本可行");
    expect(result.match(/数据访问和操作记录制度/g)).toHaveLength(1);
  });

  it("limits output to a concise set of meeting conclusions", () => {
    const result = summarizeMeetingEvidence({
      minuteText: Array.from(
        { length: 12 },
        (_, index) => `第${index + 1}项意见建议完善项目管理机制并补充第${index + 1}类证明材料。`,
      ).join("\n"),
      maxPoints: 4,
      maxChars: 260,
    });

    expect(result.split("；").length).toBeLessThanOrEqual(4);
    expect(result.length).toBeLessThanOrEqual(260);
  });

  it("supports the report limit of three concise conclusions", () => {
    const result = summarizeMeetingEvidence({
      minuteText: Array.from(
        { length: 8 },
        (_, index) => `第${index + 1}项意见建议完善项目管理机制并补充第${index + 1}类证明材料。`,
      ).join("\n"),
      maxPoints: 3,
      maxChars: 280,
    });

    expect(result.split("；").length).toBeLessThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(280);
  });

  it("does not inject project-specific fixed topics", () => {
    const result = summarizeMeetingEvidence({
      minuteText: "专家建议核实绿化养护面积，并补充苗木成活率的年度验收记录。",
    });

    expect(result).toContain("绿化养护面积");
    expect(result).not.toMatch(/档案|数据安全|备份机制/);
  });
});

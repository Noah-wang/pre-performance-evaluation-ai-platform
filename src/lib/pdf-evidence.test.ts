import { describe, expect, it } from "vitest";
import {
  isReportReadableEvidenceFile,
  normalizeEvidenceTextForPrompt,
} from "../../supabase/functions/_shared/rag";

describe("报告证据文件类型", () => {
  it("纳入已有正文片段的常用文档与图片类型", () => {
    expect(isReportReadableEvidenceFile("会议纪要.pdf")).toBe(true);
    expect(isReportReadableEvidenceFile("项目申报书.docx")).toBe(true);
    expect(isReportReadableEvidenceFile("预算明细.xlsx")).toBe(true);
    // 扫描件和签章页常以图片上传，OCR 后同样是可引用证据；排除它们会让整个项目
    // 的报告生成永远卡在“未完成解析”。
    expect(isReportReadableEvidenceFile("绩效目标表_01.png")).toBe(true);
    expect(isReportReadableEvidenceFile("签章页.jpg")).toBe(true);
    expect(isReportReadableEvidenceFile("现场录音.webm")).toBe(false);
  });

  it("清理可读 OCR 间距并丢弃乱码 OCR", () => {
    expect(normalizeEvidenceTextForPrompt("档 案 存 储 项 目 年 度 预 算 为 90.2 万 元。"))
      .toContain("档案存储项目年度预算");
    expect(normalizeEvidenceTextForPrompt(
      "2026 年 经 常 单位 名 称 AL aK HH 项 目 名 称 ial __ CAL RTL AR WAY RS SE at AY | sii be LACKING",
    )).toBe("");
  });

  it("保留夹杂零星拉丁字符和表格线的签章版扫描件正文", () => {
    const scannedForm = [
      "[第1页] 2026 年预算项目支出绩效目标申报表 ( 签章版 )",
      "项目名称 t 档案存储及管理服务项目 j 项目代码 GD-2026-0001",
      "主管部门 l 市档案馆 f 实施单位 | 市档案馆 y",
      "年度预算 ( 万元 ) 90.20 e 其中 财政拨款 90.20 n",
      "产出指标 数量指标 档案保管数量 12000 卷 a",
      "产出指标 质量指标 档案完好率 99 % rn",
      "效益指标 社会效益 查档满意度 95 % w",
      "填报人 张 X 审核人 李 X 日期 2025 年 11 月",
    ].join("\n");
    const normalized = normalizeEvidenceTextForPrompt(scannedForm);
    expect(normalized).not.toBe("");
    expect(normalized).toContain("档案保管数量");
    expect(normalized).toContain("查档满意度");
  });

  it("仍然丢弃中文被拉丁碎片淹没的乱码文字层", () => {
    expect(normalizeEvidenceTextForPrompt([
      "ial CAL RTL AR WAY RS SE at AY sii be LACKING an ok tr __ | ~",
      "档案 存储 及 管理 服务 项目 abc def ghi jkl mno pqr stu vwx yza",
      "bcd efg hij klm nop qrs tuv wxy zab cde fgh ijk lmn opq rst",
    ].join(" "))).toBe("");
  });
});

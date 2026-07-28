import { describe, expect, it } from "vitest";
import { isGeneratedReportEvidence } from "../../supabase/functions/_shared/rag";
import { containsGeneratedReportCitation } from "../../supabase/functions/_shared/reportQuality";
import {
  actualSourceFileName,
  isSystemRecordEvidence,
} from "../../supabase/functions/_shared/reportEvidence";

describe("generated report evidence isolation", () => {
  it("excludes report tables and report history versions", () => {
    expect(isGeneratedReportEvidence({ source_type: "report" })).toBe(true);
    expect(isGeneratedReportEvidence({ source_type: "report_version" })).toBe(true);
  });

  it("excludes generated reports that were uploaded again as project files", () => {
    expect(isGeneratedReportEvidence({
      source_type: "material",
      file_name: "系统生成报告-档案存储及管理服务项目.docx",
    })).toBe(true);
    expect(isGeneratedReportEvidence({
      source_type: "material",
      file_name: "Performance Evaluation Report (26).docx",
    })).toBe(true);
    expect(isGeneratedReportEvidence({
      source_type: "material",
      file_name: "第七版评估报告.docx",
    })).toBe(true);
  });

  it("keeps first-party project records and uploaded source materials", () => {
    expect(isGeneratedReportEvidence({
      source_type: "meeting_minute",
      file_name: "会议纪要-档案存储专家会.docx",
    })).toBe(false);
    expect(isGeneratedReportEvidence({
      source_type: "material",
      file_name: "事前绩效评估项目申报书.docx",
    })).toBe(false);
    expect(isGeneratedReportEvidence({
      source_type: "evaluation_plan",
      file_name: "评估方案-档案存储项目.docx",
    })).toBe(false);
  });

  it("keeps system records as evidence without pretending they are uploaded files", () => {
    const meeting = {
      source_type: "meeting_minute",
      file_name: "会议纪要-档案存储专家会.docx",
      title: "会议纪要：档案存储专家会",
    };
    const plan = {
      source_type: "evaluation_plan",
      file_name: "评估方案-档案存储项目.docx",
      title: "评估方案：档案存储项目",
    };
    expect(isSystemRecordEvidence(meeting)).toBe(true);
    expect(isSystemRecordEvidence(plan)).toBe(true);
    expect(actualSourceFileName(meeting)).toBe("");
    expect(actualSourceFileName(plan)).toBe("");
    expect(actualSourceFileName({
      source_type: "material",
      file_name: "事前绩效评估项目申报书.docx",
    })).toBe("事前绩效评估项目申报书.docx");
  });

  it("rejects generated-report citations before a new report is saved", () => {
    expect(containsGeneratedReportCitation(
      "根据《系统生成报告-档案存储项目.docx》载明，项目预算为90.2万元。",
    )).toBe(true);
    expect(containsGeneratedReportCitation(
      "根据《Performance Evaluation Report (26).docx》，项目具备可行性。",
    )).toBe(true);
    expect(containsGeneratedReportCitation(
      "根据《项目预算测算说明.docx》，项目预算为90.2万元。",
    )).toBe(false);
  });
});

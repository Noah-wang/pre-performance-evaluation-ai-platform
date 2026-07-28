import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { buildReportRagDossier } from "../../supabase/functions/_shared/rag";
import {
  ensureServiceProviderDisclosure,
  normalizeSourceKey,
  rewriteProjectMaterialCitations,
} from "../../supabase/functions/_shared/reportEvidence";

const testEmail = process.env.TEST_AUTH_EMAIL;
const testPassword = process.env.TEST_AUTH_PASSWORD;
const shouldRun = Boolean(testEmail && testPassword);

describe.skipIf(!shouldRun)("真实项目报告证据链", () => {
  it("逐文件覆盖项目资料并从正文识别服务商", async () => {
    const supabase = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: testEmail!,
      password: testPassword!,
    });
    expect(loginError).toBeNull();

    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .eq("name", "档案存储及管理服务项目");
    expect(projectError).toBeNull();
    expect(projects?.length).toBeGreaterThan(0);

    const dossier = await buildReportRagDossier(
      supabase,
      projects![0],
      ["立项必要性", "投入经济性", "绩效目标合理性", "实施方案可行性", "筹资合规性", "可持续性"],
    );

    expect(dossier.stats.files).toBeGreaterThanOrEqual(40);
    expect(dossier.stats.coveredFiles).toBe(dossier.stats.files);
    expect(dossier.stats.indexedFiles).toBeGreaterThanOrEqual(40);
    expect(dossier.sourceNames).toContain("申江万国数据信息股份有限公司-档案管理实施方案.docx");
    expect(dossier.sourceNames).toContain("附件2：会议纪要.pdf");
    expect(dossier.sourceNames.some((fileName) => /\.pdf$/i.test(fileName))).toBe(true);
    expect(dossier.serviceProviders.some((provider) =>
      provider.name === "申江万国数据信息股份有限公司"
    )).toBe(true);
    expect(dossier.serviceProviders[0]?.name).toBe("申江万国数据信息股份有限公司");
    const reportWithProvider = ensureServiceProviderDisclosure(
      "一、项目基本情况\n（三）项目概况\n本项目开展档案存储及管理服务。\n（四）项目绩效目标",
      dossier.serviceProviders,
    );
    expect(reportWithProvider).toContain("项目相关服务商为申江万国数据信息股份有限公司");
    expect(reportWithProvider).toContain("《申江万国数据信息股份有限公司-档案管理实施方案.docx》");

    for (const fileName of dossier.sourceNames) {
      expect(dossier.sectionContexts.evaluation).toContain(`《${fileName}》`);
    }

    for (const materialTitle of [
      "实施方案",
      "项目预算及明细、项目预算测算说明",
      "可行性研究报告",
      "事前绩效评估绩效目标申报表",
    ]) {
      const key = normalizeSourceKey(materialTitle);
      const mappedNames = dossier.sourceAliases[key]
        ? [dossier.sourceAliases[key]]
        : dossier.sourceAliasCandidates[key] ?? [];
      expect(mappedNames.length, `${materialTitle} 未映射到真实上传文件名`).toBeGreaterThan(0);
      for (const fileName of mappedNames) {
        expect(dossier.sourceNames).toContain(fileName);
      }
    }

    const rewritten = rewriteProjectMaterialCitations(
      "根据《实施方案》《项目预算及明细、项目预算测算说明》《可行性研究报告》《事前绩效评估绩效目标申报表》开展核验。",
      dossier.sourceNames,
      dossier.sourceAliases,
      dossier.sourceAliasCandidates,
    );
    expect(rewritten).not.toMatch(/《(?:实施方案|项目预算及明细、项目预算测算说明|可行性研究报告|事前绩效评估绩效目标申报表)》/);
    expect(rewritten).toMatch(/《[^》]+\.(?:docx?|xlsx?|xls|csv|pdf)》/i);
  }, 30_000);
});

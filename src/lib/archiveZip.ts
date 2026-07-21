/**
 * 归档项目一键打包 ZIP
 * 内容：
 *  - 0_归档说明.docx        归档说明
 *  - 1_评估报告.docx        主报告
 *  - 2_整改建议.docx        AI 整改清单
 *  - 3_会议纪要/*.docx      全部会议纪要
 *  - 4_评估方案/*.docx      评估方案
 *  - 5_资料文件/*           Storage 中的真实文件
 *  - 6_现场调研/*.docx      现场调研记录
 *  - 归档清单.json           清单（文件列表 + 元数据）
 */
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";
import { createRichDocxBlob, createTextDocxBlob } from "@/lib/generatedDocx";
import { createEvaluationReportBlob } from "@/lib/docxExport";

interface Snapshot {
  id: string;
  name: string;
  unit: string;
  budget: number;
  category: string | null;
  description: string | null;
  fiscal_year?: number;
}

interface BuildOpts {
  archiveId: string;
  projectId: string;
  reportId: string | null;
  snapshot: Snapshot;
  conclusion: string | null;
  archiveNote: string | null;
  archivedAt: string;
  onProgress?: (msg: string) => void;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

/**
 * 把单个项目的所有归档内容写入到 zip 的某个目录下（不下载，仅填充）
 * 用于批量打包：每个项目一个子目录
 */
export async function addArchiveToZip(
  zip: JSZip,
  opts: BuildOpts,
  basePath = "",
): Promise<void> {
  const { snapshot, projectId, reportId, conclusion, archiveNote, archivedAt, onProgress } = opts;
  const log = (m: string) => onProgress?.(m);
  const folder = basePath ? zip.folder(basePath)! : zip;

  /* 0. README */
  const readme = [
    `项目归档包`,
    `============`,
    ``,
    `项目名称：${snapshot.name}`,
    `委托单位：${snapshot.unit}`,
    `预算金额：¥${snapshot.budget.toLocaleString()}`,
    `项目类别：${snapshot.category ?? "—"}`,
    `财政年度：${snapshot.fiscal_year ?? "—"}`,
    `评估结论：${conclusion ?? "—"}`,
    `归档时间：${new Date(archivedAt).toLocaleString("zh-CN")}`,
    `归档备注：${archiveNote ?? "—"}`,
    ``,
    `项目描述：`,
    snapshot.description ?? "—",
    ``,
    `--- 包含内容 ---`,
    `1_评估报告.docx      主报告`,
    `2_整改建议.docx      AI 生成整改建议`,
    `3_会议纪要/          全部会议纪要 (Word)`,
    `4_评估方案/          评估方案 (Word)`,
    `5_资料文件/          上传的真实资料文件`,
    `6_现场调研/          现场调研记录 (Word)`,
    `归档清单.json         文件清单与元数据`,
  ].join("\n");
  folder.file("0_归档说明.docx", await createTextDocxBlob("项目归档说明", readme));
  log("✓ 写入 README");

  const manifest: any = { project: snapshot, archivedAt, conclusion, files: [] as string[] };

  /* 1. 报告 Word + 整改 Word */
  if (reportId) {
    log("正在生成评估报告 Word…");
    const { data: report } = await supabase.from("reports").select("*").eq("id", reportId).maybeSingle();
    if (report) {
      if (report.content) {
        const reportBlob = await createEvaluationReportBlob({
          projectName: snapshot.name,
          unit: snapshot.unit,
          budget: snapshot.budget,
          category: snapshot.category ?? undefined,
          supervisingDepartment: report.supervising_department ?? snapshot.unit,
          evaluator: report.evaluation_org ?? undefined,
          thirdPartyOrg: report.third_party_org ?? undefined,
          reportContent: report.content,
          conclusion: report.conclusion ?? conclusion ?? "",
          unsupportedBudget: report.unsupported_budget == null ? undefined : Number(report.unsupported_budget) / 10000,
          supportedBudget: report.supported_budget == null ? undefined : Number(report.supported_budget) / 10000,
          summaryRemark: report.summary_remark ?? undefined,
          date: archivedAt.slice(0, 10),
        });
        folder.file("1_评估报告.docx", reportBlob);
        manifest.files.push("1_评估报告.docx");
      }
      if (report.ai_rectification) {
        const rectText = JSON.stringify(report.ai_rectification, null, 2);
        folder.file("2_整改建议.docx", await createTextDocxBlob("整改建议", rectText));
        manifest.files.push("2_整改建议.docx");
      }
    }
  }

  /* 3. 会议纪要 */
  log("正在打包会议纪要…");
  const { data: minutes } = await supabase.from("meeting_minutes").select("*").eq("project_id", projectId);
  for (const m of (minutes ?? []) as any[]) {
    const fname = `3_会议纪要/${m.meeting_date}_${safe(m.title)}.docx`;
    folder.file(fname, await createTextDocxBlob(m.title, `会议日期：${m.meeting_date}\n\n${m.content}`));
    manifest.files.push(fname);
  }

  /* 4. 评估方案 */
  log("正在打包评估方案…");
  const { data: plans } = await supabase.from("evaluation_plans").select("*").eq("project_id", projectId);
  for (const p of (plans ?? []) as any[]) {
    const fname = `4_评估方案/${safe(p.title)}.docx`;
    folder.file(fname, await createTextDocxBlob(p.title, `状态：${p.status}\n\n${p.content}`));
    manifest.files.push(fname);
  }

  /* 5. 资料文件 (从 Storage 下载) */
  log("正在下载资料文件…");
  const { data: materials } = await supabase.from("materials").select("*").eq("project_id", projectId);
  let matIdx = 0;
  for (const m of (materials ?? []) as any[]) {
    matIdx++;
    log(`下载资料 ${matIdx}/${(materials ?? []).length}：${m.name}`);
    if (m.file_path) {
      try {
        const { data, error } = await supabase.storage.from("project-materials").download(m.file_path);
        if (!error && data) {
          const ext = m.file_name?.split(".").pop() || "bin";
          const fname = `5_资料文件/[${m.category}] ${safe(m.name)}.${ext}`;
          folder.file(fname, data);
          manifest.files.push(fname);
        }
      } catch {
        /* skip */
      }
    } else {
      const fname = `5_资料文件/缺失资料_${safe(m.name)}.docx`;
      folder.file(fname, await createTextDocxBlob(
        `缺失资料：${m.name}`,
        `资料状态：${m.status}\n类别：${m.category}\n说明：尚未上传文件\n审核备注：${m.review_note ?? "—"}`,
      ));
      manifest.files.push(fname);
    }
  }

  /* 6. 现场调研 */
  log("正在打包现场调研…");
  const { data: fields } = await supabase.from("field_records").select("*").eq("project_id", projectId);
  const fieldIds = (fields ?? []).map((f: any) => f.id);
  const audioMap = new Map<string, any[]>();
  if (fieldIds.length) {
    const { data: audios } = await supabase
      .from("field_audios")
      .select("record_id,parent_audio_id,segment_index,created_at,duration_sec,transcript,transcript_status")
      .in("record_id", fieldIds)
      .order("created_at", { ascending: true });
    (audios ?? []).forEach((audio: any) => {
      const list = audioMap.get(audio.record_id) ?? [];
      list.push(audio);
      audioMap.set(audio.record_id, list);
    });
  }
  for (const f of (fields ?? []) as any[]) {
    const grouped = new Map<string, any[]>();
    (audioMap.get(f.id) ?? []).forEach((audio: any) => {
      const key = audio.parent_audio_id ?? `${audio.record_id}-${audio.created_at}`;
      const list = grouped.get(key) ?? [];
      list.push(audio);
      grouped.set(key, list);
    });
    const transcriptBlock = Array.from(grouped.values()).map((list, idx) => {
      const sorted = list.sort((a, b) => a.segment_index - b.segment_index);
      const lines = [`## 录音转写 ${idx + 1}`];
      sorted.forEach((audio: any, segIdx: number) => {
        lines.push(
          ``,
          `### 第 ${segIdx + 1} 段`,
          `录音时间：${new Date(audio.created_at).toLocaleString("zh-CN", { hour12: false })}`,
          `时长：${audio.duration_sec ?? 0} 秒`,
          `状态：${audio.transcript_status}`,
          ``,
          (audio.transcript ?? "—").trim() || "—",
        );
      });
      return lines.join("\n");
    }).join("\n\n");
    const fname = `6_现场调研/${f.research_date}_${safe(f.location)}.docx`;
    folder.file(
      fname,
      await createTextDocxBlob("现场调研记录", [
        `# 现场调研记录`,
        `调研日期：${f.research_date}`,
        `调研地点：${f.location}`,
        `参与人员：${f.participants ?? "—"}`,
        `GPS：${f.gps_lat ?? "-"}, ${f.gps_lng ?? "-"}`,
        ``,
        `## 现场发现`,
        f.findings ?? "—",
        ``,
        `## 调研结论`,
        f.conclusion ?? "—",
        ``,
        `## 调研录音转写`,
        transcriptBlock || "—",
      ].join("\n")),
    );
    manifest.files.push(fname);
  }

  folder.file("归档清单.json", JSON.stringify(manifest, null, 2));
}

/* -------- 单项目打包并下载 -------- */
export async function buildArchiveZip(opts: BuildOpts): Promise<void> {
  const { snapshot, archivedAt, onProgress } = opts;
  const zip = new JSZip();
  await addArchiveToZip(zip, opts);
  onProgress?.("正在压缩 ZIP…");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const filename = `归档_${snapshot.fiscal_year ?? new Date(archivedAt).getFullYear()}_${safe(snapshot.name)}.zip`;
  saveAs(blob, filename);
  onProgress?.("✓ 完成");
}

/* -------- 批量打包多项目 -------- */
export interface BatchItem {
  archiveId: string;
  projectId: string;
  reportId: string | null;
  snapshot: Snapshot;
  conclusion: string | null;
  archiveNote: string | null;
  archivedAt: string;
}

export async function buildBatchArchiveZip(
  items: BatchItem[],
  zipName: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<void> {
  const zip = new JSZip();
  const total = items.length;
  const summary: any = {
    generatedAt: new Date().toISOString(),
    totalProjects: total,
    projects: [] as any[],
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pct = Math.round((i / total) * 95);
    const subDir = `${String(i + 1).padStart(2, "0")}_${safe(it.snapshot.name)}`;
    onProgress?.(`[${i + 1}/${total}] ${it.snapshot.name}`, pct);
    try {
      await addArchiveToZip(zip, {
        ...it,
        onProgress: (m) => onProgress?.(`[${i + 1}/${total}] ${it.snapshot.name} · ${m}`, pct),
      }, subDir);
      summary.projects.push({
        index: i + 1,
        folder: subDir,
        name: it.snapshot.name,
        unit: it.snapshot.unit,
        budget: it.snapshot.budget,
        fiscal_year: it.snapshot.fiscal_year,
        conclusion: it.conclusion,
        archivedAt: it.archivedAt,
      });
    } catch (err: any) {
      console.error(`项目 ${it.snapshot.name} 打包失败`, err);
      summary.projects.push({ index: i + 1, folder: subDir, name: it.snapshot.name, error: String(err?.message ?? err) });
    }
  }

  const totalBudget = items.reduce((s, x) => s + (x.snapshot.budget || 0), 0);
  const readme = [
    `批量归档项目包`,
    `==============`,
    ``,
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    `项目总数：${total}`,
    `预算合计：¥${totalBudget.toLocaleString()}`,
    ``,
    `--- 项目清单 ---`,
    ...summary.projects.map((p: any) =>
      `${String(p.index).padStart(2, "0")}. ${p.name}  ·  ¥${(p.budget ?? 0).toLocaleString()}  ·  ${p.conclusion ?? "—"}`,
    ),
    ``,
    `每个项目位于独立子目录，结构与单项目归档包一致。`,
    `详见批量归档清单。`,
  ].join("\n");
  zip.file("0_批量归档说明.docx", await createTextDocxBlob("批量归档说明", readme));
  zip.file("批量归档清单.json", JSON.stringify(summary, null, 2));

  onProgress?.("正在压缩 ZIP…", 98);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  saveAs(blob, zipName);
  onProgress?.("✓ 完成", 100);
}

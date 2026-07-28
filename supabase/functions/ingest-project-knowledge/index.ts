import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractBlobText, isSupportedKnowledgeFile } from "../_shared/materials.ts";
import { chunkText, createTextEmbeddingsAsync, tokenizeForEmbedding, vectorLiteral } from "../_shared/embedding.ts";
import { normalizeEvidenceTextForPrompt } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const fileExt = (fileName = "") => fileName.split(".").pop()?.toLowerCase() || null;

const isKnowledgeSchemaError = (error: unknown) => {
  const message = String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return /knowledge_files|source_type|source_id|source_updated_at|text_hash|indexed_at|schema cache|ON CONFLICT/i.test(message);
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const buildIndexText = (params: {
  title: string;
  fileName: string;
  category?: string | null;
  summary?: string | null;
  text: string;
}) => {
  const header = [
    `资料名称：${params.title || params.fileName || "项目资料"}`,
    params.fileName ? `文件名：${params.fileName}` : "",
    params.category ? `资料类别：${params.category}` : "",
    params.summary ? `资料说明：${params.summary}` : "",
  ].filter(Boolean).join("；");
  const body = params.text.trim();
  return body ? `${header}\n\n${body}` : `${header}\n\n[提示] 该文件暂未提取到稳定正文，已按文件名称、类别和说明纳入检索。`;
};

// 单次调用最多占用的时间。Edge Function worker 上限 5 分钟，留出余量给
// 向量化和入库；超出就保存进度返回，由调用方再次触发继续。
const BATCH_TIME_BUDGET_MS = 80_000;

const MAX_CHUNKS_PER_FILE = 80;
const CHUNK_LENGTH = 2400;
const CHUNK_OVERLAP = 160;

const insertChunksInBatches = async (supabase: any, rows: any[], batchSize = 25) => {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from("knowledge_chunks").insert(batch);
    if (error) throw error;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let supabase: any = null;
  let activeFileId: string | null = null;
  let activeTitle = "项目资料";

  try {
    const { projectId = null, materialId = null, force = false, limit = 80 } = await req.json().catch(() => ({}));
    if (!projectId && !materialId) {
      return new Response(JSON.stringify({ error: "缺少 projectId 或 materialId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("materials")
      .select("id,project_id,name,category,status,file_path,file_name,review_note,updated_at,created_at")
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 80, 1), 500));

    if (materialId) query = query.eq("id", materialId);
    else query = query.eq("project_id", projectId);

    const { data: materials, error: materialError } = await query;
    if (materialError) throw materialError;

    const startedAt = Date.now();
    const stats = {
      total: materials?.length ?? 0,
      indexed: 0,
      skipped: 0,
      failed: 0,
      partial: 0,
      errors: [] as string[],
    };

    for (const material of materials ?? []) {
      const sourceUpdatedAt = material.updated_at || material.created_at || new Date().toISOString();
      const title = material.name || material.file_name || "项目资料";
      const fileName = material.file_name || material.name || "资料文件";
      activeTitle = title;

      const { data: existingRows, error: existingError } = await supabase
        .from("knowledge_files")
        .select("id,status,source_updated_at,text_hash,error_message,parse_cursor")
        .eq("source_type", "material")
        .eq("source_id", material.id)
        .limit(1);
      if (existingError) throw existingError;
      const existing = existingRows?.[0] ?? null;
      const existingMetadataOnly = /未提取|文件信息级|metadata_only/i.test(String(existing?.error_message ?? ""));

      if (!force && !existingMetadataOnly && existing?.status === "indexed" && existing.source_updated_at && new Date(existing.source_updated_at).getTime() >= new Date(sourceUpdatedAt).getTime()) {
        stats.skipped += 1;
        continue;
      }

      const filePayload = {
        source_type: "material",
        source_id: material.id,
        source_updated_at: sourceUpdatedAt,
        project_id: material.project_id,
        title,
        file_name: fileName,
        file_path: material.file_path,
        file_type: fileExt(fileName),
        category: material.category || "项目资料",
        summary: material.review_note || null,
        status: "indexing",
        error_message: null,
        updated_at: new Date().toISOString(),
      };

      const { data: fileRecord, error: fileMutationError } = await supabase
        .from("knowledge_files")
        .upsert({
          ...filePayload,
          id: existing?.id,
          created_by: null,
        }, { onConflict: "source_type,source_id" })
        .select("id")
        .single();
      if (fileMutationError) throw fileMutationError;

      const fileId = fileRecord.id;
      activeFileId = fileId;
      try {
        if (!isSupportedKnowledgeFile(fileName)) {
          await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);
          await supabase
            .from("knowledge_files")
            .update({
              status: "skipped",
              chunk_count: 0,
              summary: material.review_note || null,
              text_hash: null,
              indexed_at: null,
              error_message: "当前文件类型暂不支持自动正文解析。",
              source_updated_at: sourceUpdatedAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", fileId);
          stats.skipped += 1;
          activeFileId = null;
          continue;
        }

        const { data: blob, error: downloadError } = await supabase.storage
          .from("project-materials")
          .download(material.file_path);
        if (downloadError || !blob) throw downloadError ?? new Error("文件下载失败");

        // 长文档（几十页扫描件）单次解析必然超时：视觉 OCR 每页 20-30 秒，而
        // Edge Function 的 worker 上限是 5 分钟。改为按页分批推进：单次调用只做
        // 时间预算内能完成的页，进度写进 parse_cursor，后续调用接着做。已完成的
        // 页立刻入库，中途失败也不必从头再来。
        const resumeFrom = force ? 0 : Number(existing?.parse_cursor ?? 0) || 0;
        const batches: string[] = [];
        let cursor: number | null = resumeFrom;
        let totalPages: number | null = null;

        while (cursor !== null && Date.now() - startedAt < BATCH_TIME_BUDGET_MS) {
          const batch = await extractBlobText(blob, fileName, material.review_note ?? "", cursor);
          if (batch.text.trim()) batches.push(batch.text);
          totalPages = batch.progress.totalPages ?? totalPages;
          const next = batch.progress.nextStartPage;
          if (next === null || next === undefined || next <= cursor) {
            cursor = null;
            break;
          }
          cursor = next;
        }

        const batchText = batches.join("\n").trim();
        const isFirstBatch = resumeFrom === 0;
        if (isFirstBatch && !batchText) {
          throw new Error("文件未提取到可用正文，不能标记为已索引，请检查文件内容或解析服务。");
        }

        // 首批带资料名称等头部信息；续跑批次只追加正文。
        const text = isFirstBatch
          ? buildIndexText({
            title,
            fileName,
            category: material.category,
            summary: material.review_note,
            text: batchText,
          })
          : batchText;

        const textHash = await sha256(text);
        if (
          isFirstBatch && cursor === null && !force && !existingMetadataOnly
          && existing?.status === "indexed" && existing.text_hash === textHash
        ) {
          await supabase
            .from("knowledge_files")
            .update({
              status: "indexed",
              parse_cursor: null,
              source_updated_at: sourceUpdatedAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", fileId);
          stats.skipped += 1;
          activeFileId = null;
          continue;
        }

        // 从头解析才清空旧切片；续跑时追加在已有切片之后。
        let chunkOffset = 0;
        if (isFirstBatch) {
          await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);
        } else {
          const { count } = await supabase
            .from("knowledge_chunks")
            .select("id", { count: "exact", head: true })
            .eq("file_id", fileId);
          chunkOffset = Number(count ?? 0);
        }

        const chunks = chunkText(text, CHUNK_LENGTH, CHUNK_OVERLAP)
          .slice(0, Math.max(0, MAX_CHUNKS_PER_FILE - chunkOffset));
        if (!chunks.length && isFirstBatch) throw new Error("文件正文为空，无法建立索引");

        const embeddings = await createTextEmbeddingsAsync(chunks, 8);
        const rows = chunks.map((content, index) => ({
            file_id: fileId,
            project_id: material.project_id,
            chunk_index: chunkOffset + index,
            content,
            token_count: tokenizeForEmbedding(content).length,
            embedding: vectorLiteral(embeddings[index]),
            metadata: {
              sourceType: "material",
              sourceId: material.id,
              fileName,
              category: material.category,
              title,
              extraction: batchText ? "full_text" : "file_metadata",
            },
        }));

        await insertChunksInBatches(supabase, rows);

        // Report generation drops chunks whose text is unusable as evidence. If
        // that leaves nothing, the file is not really full-text indexed, and
        // labelling it as such hides the problem until report generation is
        // blocked with no explanation.
        const usableChunks = chunks.filter((content) =>
          Boolean(normalizeEvidenceTextForPrompt(content))
        ).length;

        const done = cursor === null;
        await supabase
          .from("knowledge_files")
          .update({
            status: done ? "indexed" : "indexing",
            chunk_count: chunkOffset + rows.length,
            parse_cursor: cursor,
            parse_total_pages: totalPages,
            summary: isFirstBatch ? text.slice(0, 600) : undefined,
            text_hash: done ? textHash : null,
            indexed_at: done ? new Date().toISOString() : null,
            error_message: !done
              ? `解析进行中：已完成前 ${cursor} 页${totalPages ? ` / 共 ${totalPages} 页` : ""}，再次触发索引可继续。`
              : usableChunks
              ? null
              : "未提取到可用正文，仅建立文件信息级索引；报告生成不会采信该文件，请检查文档解析/OCR 服务后重新解析。",
            source_updated_at: sourceUpdatedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", fileId);

        if (!done) {
          stats.partial += 1;
          stats.errors.push(
            `${title}: 已解析 ${cursor}${totalPages ? `/${totalPages}` : ""} 页，需再次触发以继续`,
          );
        } else if (usableChunks) stats.indexed += 1;
        else {
          stats.failed += 1;
          stats.errors.push(`${title}: 未提取到可用正文，仅建立文件信息级索引`);
        }
        activeFileId = null;
      } catch (error) {
        stats.failed += 1;
        const message = String(error?.message ?? error);
        stats.errors.push(`${title}: ${message}`);
        await supabase
          .from("knowledge_files")
          .update({
            status: "error",
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", fileId);
        activeFileId = null;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ingest-project-knowledge error:", error);
    if (supabase && activeFileId && !isKnowledgeSchemaError(error)) {
      await supabase
        .from("knowledge_files")
        .update({
          status: "error",
          error_message: `索引中断：${String(error?.message ?? error)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeFileId)
        .then(({ error: updateError }: any) => {
          if (updateError) console.error("failed to mark active indexing file as error", activeTitle, updateError);
        });
    }
    if (isKnowledgeSchemaError(error)) {
      return new Response(JSON.stringify({
        error: "文件库索引表结构未完成更新，请先执行最新 Supabase migration 后再更新项目索引。",
        detail: String(error?.message ?? error),
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

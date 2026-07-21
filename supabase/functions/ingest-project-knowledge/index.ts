import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractBlobText } from "../_shared/materials.ts";
import { chunkText, createTextEmbeddingAsync, tokenizeForEmbedding, vectorLiteral } from "../_shared/embedding.ts";

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

const insertChunksInBatches = async (supabase: any, rows: any[], batchSize = 50) => {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from("knowledge_chunks").insert(batch);
    if (error) throw error;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId = null, materialId = null, force = false, limit = 80 } = await req.json().catch(() => ({}));
    if (!projectId && !materialId) {
      return new Response(JSON.stringify({ error: "缺少 projectId 或 materialId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("materials")
      .select("id,project_id,name,category,status,file_path,file_name,review_note,updated_at,created_at")
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 80, 1), 200));

    if (materialId) query = query.eq("id", materialId);
    else query = query.eq("project_id", projectId);

    const { data: materials, error: materialError } = await query;
    if (materialError) throw materialError;

    const stats = { total: materials?.length ?? 0, indexed: 0, skipped: 0, failed: 0, errors: [] as string[] };

    for (const material of materials ?? []) {
      const sourceUpdatedAt = material.updated_at || material.created_at || new Date().toISOString();
      const title = material.name || material.file_name || "项目资料";
      const fileName = material.file_name || material.name || "资料文件";

      const { data: existingRows, error: existingError } = await supabase
        .from("knowledge_files")
        .select("id,status,source_updated_at,text_hash")
        .eq("source_type", "material")
        .eq("source_id", material.id)
        .limit(1);
      if (existingError) throw existingError;
      const existing = existingRows?.[0] ?? null;

      if (!force && existing?.status === "indexed" && existing.source_updated_at && new Date(existing.source_updated_at).getTime() >= new Date(sourceUpdatedAt).getTime()) {
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
      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from("project-materials")
          .download(material.file_path);
        if (downloadError || !blob) throw downloadError ?? new Error("文件下载失败");

        const text = await extractBlobText(blob, fileName, material.review_note ?? "");
        if (!text.trim()) throw new Error("未能从文件中提取可检索正文");

        const textHash = await sha256(text);
        if (!force && existing?.status === "indexed" && existing.text_hash === textHash) {
          await supabase
            .from("knowledge_files")
            .update({
              status: "indexed",
              source_updated_at: sourceUpdatedAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", fileId);
          stats.skipped += 1;
          continue;
        }

        const chunks = chunkText(text, 1200, 100);
        if (!chunks.length) throw new Error("文件正文为空，无法建立索引");

        await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);

        const rows = [];
        for (const [index, content] of chunks.entries()) {
          rows.push({
            file_id: fileId,
            project_id: material.project_id,
            chunk_index: index,
            content,
            token_count: tokenizeForEmbedding(content).length,
            embedding: vectorLiteral(await createTextEmbeddingAsync(content)),
            metadata: {
              sourceType: "material",
              sourceId: material.id,
              fileName,
              category: material.category,
              title,
            },
          });
        }

        await insertChunksInBatches(supabase, rows);

        await supabase
          .from("knowledge_files")
          .update({
            status: "indexed",
            chunk_count: rows.length,
            summary: text.slice(0, 600),
            text_hash: textHash,
            indexed_at: new Date().toISOString(),
            error_message: null,
            source_updated_at: sourceUpdatedAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", fileId);

        stats.indexed += 1;
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
      }
    }

    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ingest-project-knowledge error:", error);
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

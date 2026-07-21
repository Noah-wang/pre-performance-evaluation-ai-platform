import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractBlobText } from "../_shared/materials.ts";
import { chunkText, createTextEmbeddingAsync, tokenizeForEmbedding, vectorLiteral } from "../_shared/embedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const { fileId, force = false } = await req.json();
    if (!fileId) {
      return new Response(JSON.stringify({ error: "缺少 fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: file, error: fileError } = await supabase
      .from("knowledge_files")
      .select("*")
      .eq("id", fileId)
      .maybeSingle();

    if (fileError || !file) throw fileError ?? new Error("文件记录不存在");

    await supabase
      .from("knowledge_files")
      .update({ status: "indexing", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", fileId);

    const { data: blob, error: downloadError } = await supabase.storage
      .from("knowledge-files")
      .download(file.file_path);
    if (downloadError || !blob) throw downloadError ?? new Error("文件下载失败");

    const text = await extractBlobText(blob, file.file_name, file.summary ?? "");
    if (!text.trim()) throw new Error("未能从文件中提取可检索正文");

    const textHash = await sha256(text);
    if (!force && file.status === "indexed" && file.text_hash === textHash) {
      await supabase
        .from("knowledge_files")
        .update({
          indexed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", fileId);

      return new Response(JSON.stringify({ ok: true, skipped: true, chunkCount: file.chunk_count ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chunks = chunkText(text, 1200, 100);
    if (!chunks.length) throw new Error("文件正文为空，无法建立索引");

    await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);

    const rows = [];
    for (const [index, content] of chunks.entries()) {
      rows.push({
        file_id: fileId,
        project_id: file.project_id,
        chunk_index: index,
        content,
        token_count: tokenizeForEmbedding(content).length,
        embedding: vectorLiteral(await createTextEmbeddingAsync(content)),
        metadata: {
          fileName: file.file_name,
          category: file.category,
          title: file.title,
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId);

    return new Response(JSON.stringify({ ok: true, chunkCount: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ingest-knowledge-file error:", error);
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractBlobText, isSupportedKnowledgeFile } from "../_shared/materials.ts";
import { chunkText, createTextEmbeddingsAsync, tokenizeForEmbedding, vectorLiteral } from "../_shared/embedding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const buildIndexText = (params: {
  title?: string | null;
  fileName?: string | null;
  category?: string | null;
  summary?: string | null;
  text: string;
}) => {
  const header = [
    `资料名称：${params.title || params.fileName || "文件库资料"}`,
    params.fileName ? `文件名：${params.fileName}` : "",
    params.category ? `资料类别：${params.category}` : "",
    params.summary ? `资料说明：${params.summary}` : "",
  ].filter(Boolean).join("；");
  const body = params.text.trim();
  return body ? `${header}\n\n${body}` : `${header}\n\n[提示] 该文件暂未提取到稳定正文，已按文件名称、类别和说明纳入检索。`;
};

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

  try {
    const { fileId, force = false } = await req.json();
    activeFileId = fileId ?? null;
    if (!fileId) {
      return new Response(JSON.stringify({ error: "缺少 fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    supabase = createClient(
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

    if (!isSupportedKnowledgeFile(file.file_name || file.title || "")) {
      await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);
      await supabase
        .from("knowledge_files")
        .update({
          status: "skipped",
          chunk_count: 0,
          indexed_at: null,
          error_message: "当前文件类型暂不支持自动正文解析。",
          updated_at: new Date().toISOString(),
        })
        .eq("id", fileId);

      return new Response(JSON.stringify({ ok: true, skipped: true, chunkCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from("knowledge-files")
      .download(file.file_path);
    if (downloadError || !blob) throw downloadError ?? new Error("文件下载失败");

    const extractedText = (await extractBlobText(blob, file.file_name, file.summary ?? "")).text;
    if (!extractedText.trim()) {
      throw new Error("文件未提取到可用正文，不能标记为已索引，请检查文件内容或解析服务。");
    }
    const text = buildIndexText({
      title: file.title,
      fileName: file.file_name,
      category: file.category,
      summary: file.summary,
      text: extractedText,
    });

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

    const chunks = chunkText(text, CHUNK_LENGTH, CHUNK_OVERLAP).slice(0, MAX_CHUNKS_PER_FILE);
    if (!chunks.length) throw new Error("文件正文为空，无法建立索引");

    await supabase.from("knowledge_chunks").delete().eq("file_id", fileId);

    const embeddings = await createTextEmbeddingsAsync(chunks, 8);
    const rows = chunks.map((content, index) => ({
        file_id: fileId,
        project_id: file.project_id,
        chunk_index: index,
        content,
        token_count: tokenizeForEmbedding(content).length,
        embedding: vectorLiteral(embeddings[index]),
        metadata: {
          fileName: file.file_name,
          category: file.category,
          title: file.title,
          extraction: extractedText.trim() ? "full_text" : "file_metadata",
        },
    }));

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
    if (supabase && activeFileId) {
      await supabase
        .from("knowledge_files")
        .update({
          status: "error",
          error_message: `索引中断：${String(error?.message ?? error)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeFileId)
        .then(({ error: updateError }: any) => {
          if (updateError) console.error("failed to mark knowledge file as error", updateError);
        });
    }
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { extractMaterialText } from "../_shared/materials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { filePath, fileName, reviewNote } = await req.json();
    if (!filePath) {
      return new Response(JSON.stringify({ error: "缺少 filePath" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cachedFile } = await supabase
      .from("knowledge_files")
      .select("id,status")
      .eq("file_path", filePath)
      .eq("status", "indexed")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedFile?.id) {
      const { data: chunks } = await supabase
        .from("knowledge_chunks")
        .select("content")
        .eq("file_id", cachedFile.id)
        .order("chunk_index", { ascending: true })
        .limit(100);
      const cachedText = (chunks ?? [])
        .map((chunk: { content?: string | null }) => String(chunk.content ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 120_000);
      if (cachedText) {
        return new Response(JSON.stringify({ text: cachedText, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const text = await extractMaterialText(supabase, {
      file_path: filePath,
      file_name: fileName,
      review_note: reviewNote,
    });

    return new Response(JSON.stringify({ text, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("preview-material error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

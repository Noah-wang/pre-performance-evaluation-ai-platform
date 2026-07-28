import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildReportCitationCandidates, buildReportEvidenceCards } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const content = String(body.content ?? "").trim();
    const project = body.project ?? (body.projectId ? { id: body.projectId } : null);

    if (!project?.id) {
      return new Response(JSON.stringify({ error: "缺少项目 ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!content) {
      return new Response(JSON.stringify({ citations: [], stats: { count: 0 } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const citations = await buildReportCitationCandidates(
      supabase,
      project,
      content,
      Number(body.limit ?? 90),
    );
    const evidenceCards = await buildReportEvidenceCards(
      supabase,
      project,
      content,
      Number(body.evidenceLimit ?? 120),
    );

    return new Response(JSON.stringify({
      citations,
      evidenceCards,
      stats: {
        count: citations.length,
        files: evidenceCards.length,
        referencedFiles: evidenceCards.filter((card) => card.status === "referenced").length,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("report-citations failed", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "引用来源生成失败" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

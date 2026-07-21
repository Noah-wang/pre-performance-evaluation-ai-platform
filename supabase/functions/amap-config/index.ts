import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const jscode = Deno.env.get("AMAP_JSCODE") ?? "";
  return new Response(JSON.stringify({ jscode }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Role = "admin" | "group_member" | "expert";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "缺少授权信息" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "登录已失效，请重新登录" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actorId = authData.user.id;
    const { data: actorRoles, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", actorId);
    if (roleError) throw roleError;

    const isAdmin = (actorRoles ?? []).some((item: { role: Role }) => item.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "仅管理员可重置他人密码" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { targetUserId, newPassword } = await req.json();
    if (!targetUserId || typeof newPassword !== "string") {
      return new Response(JSON.stringify({ error: "参数不完整" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (newPassword.trim().length < 6) {
      return new Response(JSON.stringify({ error: "密码至少 6 位" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(targetUserId, {
      password: newPassword.trim(),
    });
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ok: true, targetUserId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("update-user-password error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

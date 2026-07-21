import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Role = "admin" | "group_member" | "expert";

const countOwned = async (supabase: ReturnType<typeof createClient>, table: string, userId: string) => {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("created_by", userId);
  if (error) throw error;
  return count ?? 0;
};

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
      return new Response(JSON.stringify({ error: "仅管理员可删除用户" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { targetUserId, dryRun = false } = await req.json();
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "缺少 targetUserId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (targetUserId === actorId) {
      return new Response(JSON.stringify({ error: "不能删除当前登录管理员账号" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: targetRoles, error: targetRoleError }, projects, experts, reports] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", targetUserId),
      countOwned(supabase, "projects", targetUserId),
      countOwned(supabase, "experts", targetUserId),
      countOwned(supabase, "reports", targetUserId),
    ]);
    if (targetRoleError) throw targetRoleError;

    const targetRoleList = ((targetRoles ?? []) as Array<{ role: Role }>).map((item) => item.role);
    if (targetRoleList.includes("admin")) {
      const { count: adminCount, error: adminCountError } = await supabase
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin");
      if (adminCountError) throw adminCountError;
      if ((adminCount ?? 0) <= 1) {
        return new Response(JSON.stringify({ error: "系统至少需要保留一个管理员账号" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const impact = { projects, experts, reports };
    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dryRun: true,
        roles: targetRoleList,
        impact,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(targetUserId);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({
      ok: true,
      deletedUserId: targetUserId,
      roles: targetRoleList,
      impact,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("delete-user error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

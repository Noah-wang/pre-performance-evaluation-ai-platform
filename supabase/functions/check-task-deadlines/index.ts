import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 默认窗口：未来 3 天内到期 + 已超期未完成
const DEFAULT_LOOK_AHEAD_DAYS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);

    let lookAhead = DEFAULT_LOOK_AHEAD_DAYS;
    try {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.lookAheadDays === "number" && body.lookAheadDays > 0 && body.lookAheadDays <= 30) {
        lookAhead = body.lookAheadDays;
      }
    } catch (_) { /* no body */ }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + lookAhead);

    const todayStr = today.toISOString().slice(0, 10);
    const horizonStr = horizon.toISOString().slice(0, 10);

    // 拉取所有未完成、且 end_date <= horizon 的任务（包括已超期）
    const { data: tasks, error: tErr } = await sb
      .from("work_tasks")
      .select("id, title, end_date, status, group_id, created_by, assignee")
      .neq("status", "done")
      .lte("end_date", horizonStr);

    if (tErr) throw tErr;

    let inserted = 0;
    let dedup = 0;
    const details: Array<{ task: string; severity: string; due: string }> = [];

    for (const t of tasks ?? []) {
      const dueDate = new Date(t.end_date);
      dueDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.round((dueDate.getTime() - today.getTime()) / 86400000);

      let severity: "danger" | "warning" | "info" = "info";
      let prefix = "";
      if (daysLeft < 0) {
        severity = "danger";
        prefix = `已超期 ${Math.abs(daysLeft)} 天`;
      } else if (daysLeft === 0) {
        severity = "danger";
        prefix = "今日到期";
      } else if (daysLeft <= 1) {
        severity = "warning";
        prefix = "明日到期";
      } else {
        severity = "warning";
        prefix = `${daysLeft} 天后到期`;
      }

      const dedupeKey = `task_due:${t.id}:${daysLeft < 0 ? "overdue" : `d${daysLeft}`}`;

      const { error: insErr } = await sb.from("notifications").insert({
        user_id: t.created_by,
        category: "task",
        severity,
        title: `${prefix}：${t.title}`,
        body: `任务「${t.title}」截止日期 ${t.end_date}${t.assignee ? ` · 负责人 ${t.assignee}` : ""}`,
        link: "/work-groups",
        ref_table: "work_tasks",
        ref_id: t.id,
        dedupe_key: dedupeKey,
      });

      if (insErr) {
        // 唯一索引冲突 = 今天已经推送过同一条，跳过
        if ((insErr as any).code === "23505") {
          dedup++;
        } else {
          console.error("insert notif failed", insErr);
        }
      } else {
        inserted++;
        details.push({ task: t.title, severity, due: t.end_date });
      }
    }

    // ===== 资料缺漏扫描 =====
    // 找出所有 required=true 且 status in ('missing','rejected') 的资料
    // 按项目聚合，每天每项目每用户最多一条 warning 通知
    let materialInserted = 0;
    let materialDedup = 0;
    const materialDetails: Array<{ project: string; missing: number; rejected: number }> = [];

    const { data: badMaterials, error: mErr } = await sb
      .from("materials")
      .select("id, project_id, name, status, created_by, projects!inner(name)")
      .eq("required", true)
      .in("status", ["missing", "rejected"]);

    if (mErr) {
      console.error("materials query failed", mErr);
    } else {
      // 按 (created_by, project_id) 聚合
      const buckets = new Map<string, { user_id: string; project_id: string; project_name: string; missing: string[]; rejected: string[] }>();
      for (const m of badMaterials ?? []) {
        const k = `${m.created_by}::${m.project_id}`;
        if (!buckets.has(k)) {
          buckets.set(k, {
            user_id: m.created_by,
            project_id: m.project_id,
            project_name: (m as any).projects?.name ?? "未知项目",
            missing: [],
            rejected: [],
          });
        }
        const b = buckets.get(k)!;
        if (m.status === "missing") b.missing.push(m.name);
        else b.rejected.push(m.name);
      }

      for (const b of buckets.values()) {
        const total = b.missing.length + b.rejected.length;
        const dedupeKey = `materials_gap:${b.project_id}:m${b.missing.length}:r${b.rejected.length}`;
        const titleParts: string[] = [];
        if (b.missing.length) titleParts.push(`缺失 ${b.missing.length}`);
        if (b.rejected.length) titleParts.push(`驳回 ${b.rejected.length}`);
        const sample = [...b.missing, ...b.rejected].slice(0, 3).join("、");
        const { error: insErr } = await sb.from("notifications").insert({
          user_id: b.user_id,
          category: "material",
          severity: b.rejected.length > 0 ? "danger" : "warning",
          title: `资料待补齐：${b.project_name}（${titleParts.join("、")}）`,
          body: `共 ${total} 项需处理，例如：${sample}${total > 3 ? " 等" : ""}`,
          link: "/materials",
          ref_table: "projects",
          ref_id: b.project_id,
          dedupe_key: dedupeKey,
        });
        if (insErr) {
          if ((insErr as any).code === "23505") materialDedup++;
          else console.error("insert material notif failed", insErr);
        } else {
          materialInserted++;
          materialDetails.push({ project: b.project_name, missing: b.missing.length, rejected: b.rejected.length });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned_at: new Date().toISOString(),
        window: { from: todayStr, to: horizonStr },
        tasks: {
          candidates: tasks?.length ?? 0,
          inserted,
          deduplicated: dedup,
          details,
        },
        materials: {
          candidates: badMaterials?.length ?? 0,
          inserted: materialInserted,
          deduplicated: materialDedup,
          details: materialDetails,
        },
        // 保留旧字段向后兼容
        candidates: tasks?.length ?? 0,
        inserted: inserted + materialInserted,
        deduplicated: dedup + materialDedup,
        details,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("check-task-deadlines error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

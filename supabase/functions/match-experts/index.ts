// Smart expert matching: rank experts by specialty/avoid-unit/historical performance
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ReqBody {
  project_id: string;
  type_quota?: { management?: number; finance?: number; business?: number };
  keyword?: string;
}

type ProjectProfile = {
  focus_tags: string[];
  indicator_terms: string[];
  summary: string;
};

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[\s,，。、；：;:（）()【】\[\]/／·\-_]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1);
}

const PROFILE_KEYWORDS: Record<string, string[]> = {
  信息化数字化: ["信息化", "数字化", "平台", "系统", "网络", "数据", "云", "智慧", "软件", "安全", "指挥", "监测", "运维"],
  生态环保: ["生态", "环境", "环保", "污染", "垃圾", "大气", "水质", "环卫", "监测"],
  城市治理: ["城市", "治理", "网格", "热线", "停车", "燃气", "供暖", "执法", "秩序", "管线"],
  产业经济: ["产业", "企业", "制造业", "科技", "创新", "数字经济", "招商", "商务"],
  公共安全应急: ["应急", "安全", "防汛", "避险", "预警", "演练", "风险", "危险化学品"],
  交通市政: ["交通", "航道", "道路", "充电", "停车", "运输", "拖车", "船舶"],
  民生公共服务: ["公共服务", "补贴", "租赁", "宣传", "教育", "培训", "服务"],
  审计评估财会: ["绩效", "评估", "审计", "预算", "测算", "财务", "成本", "资金"],
};

function includesFuzzy(a: string, b: string) {
  return a.includes(b) || b.includes(a);
}

function deriveProjectProfile(keywords: string[], indicators: string[]): ProjectProfile {
  const focusTags = Object.entries(PROFILE_KEYWORDS)
    .filter(([, terms]) => terms.some((term) => keywords.some((keyword) => includesFuzzy(keyword, term))))
    .map(([label]) => label)
    .slice(0, 4);
  const indicatorTerms = indicators
    .flatMap((name) => tokenize(name))
    .filter((term, index, list) => list.indexOf(term) === index)
    .slice(0, 10);
  const summaryParts: string[] = [];
  if (focusTags.length) summaryParts.push(`业务方向偏向${focusTags.join("、")}`);
  if (indicatorTerms.length) summaryParts.push(`重点指标线索包括${indicatorTerms.slice(0, 4).join("、")}`);
  if (!summaryParts.length && keywords.length) summaryParts.push(`已从项目中提炼出${keywords.slice(0, 6).join("、")}等关键词`);
  return {
    focus_tags: focusTags,
    indicator_terms: indicatorTerms,
    summary: summaryParts.join("；"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body: ReqBody = await req.json();
    if (!body?.project_id) {
      return new Response(JSON.stringify({ error: "project_id 必填" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? key;
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(url, key);
    const userSb = createClient(url, anonKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    const { data: project, error: pErr } = await sb
      .from("projects")
      .select("id,name,unit,category,description,budget_unit,evaluation_system_id")
      .eq("id", body.project_id).maybeSingle();
    if (pErr || !project) {
      return new Response(JSON.stringify({ error: "项目不存在" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build keyword set: project category + description + system name (if any) + user keyword
    const keywords = new Set<string>();
    [project.name, project.category, project.description, body.keyword].forEach((s) =>
      tokenize(s).forEach((t) => keywords.add(t)),
    );
    let indicatorNames: string[] = [];
    if (project.evaluation_system_id) {
      const { data: sys } = await sb.from("evaluation_systems")
        .select("name,description,category").eq("id", project.evaluation_system_id).maybeSingle();
      if (sys) {
        tokenize(sys.name).forEach((t) => keywords.add(t));
        tokenize(sys.description).forEach((t) => keywords.add(t));
        tokenize(sys.category).forEach((t) => keywords.add(t));
      }
      const { data: indicators } = await sb.from("evaluation_indicators")
        .select("name")
        .eq("system_id", project.evaluation_system_id)
        .order("sort_order");
      indicatorNames = (indicators ?? []).map((item: any) => item.name).filter(Boolean);
      indicatorNames.forEach((name) => tokenize(name).forEach((t) => keywords.add(t)));
    }
    const avoidUnitFull = (project.budget_unit || project.unit || "").trim();
    const keywordList = [...keywords];
    const projectProfile = deriveProjectProfile(keywordList, indicatorNames);

    // Pull experts
    const expertClient = await (async () => {
      if (!authHeader.startsWith("Bearer ")) return userSb;
      const token = authHeader.replace("Bearer ", "").trim();
      const { data: authData } = await sb.auth.getUser(token);
      const actorId = authData.user?.id;
      if (!actorId) return userSb;
      const { data: roleRows } = await sb
        .from("user_roles")
        .select("role")
        .eq("user_id", actorId);
      const isAdmin = (roleRows ?? []).some((item: any) => item.role === "admin");
      return isAdmin ? sb : userSb;
    })();

    const { data: experts, error: expertError } = await expertClient.from("experts")
      .select("id,name,expert_type,organization,title,specialty,phone,email,avoid_units,available")
      .eq("available", true);
    if (expertError) {
      return new Response(JSON.stringify({ error: expertError.message }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull historical scores
    const { data: scores } = await sb.from("expert_scores")
      .select("expert_id,score,max_score");
    const scoreMap = new Map<string, { sum: number; max: number; count: number }>();
    (scores ?? []).forEach((s: any) => {
      if (!s.expert_id) return;
      const r = scoreMap.get(s.expert_id) ?? { sum: 0, max: 0, count: 0 };
      r.sum += Number(s.score) || 0;
      r.max += Number(s.max_score) || 0;
      r.count += 1;
      scoreMap.set(s.expert_id, r);
    });

    type Scored = {
      id: string; name: string; expert_type: string; organization: string | null;
      title: string | null; specialty: string | null;
      phone: string | null; email: string | null;
      score: number; reasons: string[]; conflict: boolean; history_avg: number | null;
      history_count: number;
      matched_terms: string[];
      matched_tags: string[];
    };

    const ranked: Scored[] = (experts ?? []).map((e: any) => {
      const reasons: string[] = [];
      let s = 50; // base
      // Specialty match
      const sp = tokenize(e.specialty);
      const matchedTerms = keywordList.filter((keyword) => sp.some((term) => includesFuzzy(keyword, term))).slice(0, 6);
      if (matchedTerms.length > 0) {
        s += Math.min(matchedTerms.length * 12, 30);
        reasons.push(`专长匹配 ${matchedTerms.length} 项`);
      }
      const matchedTags = projectProfile.focus_tags.filter((tag) =>
        PROFILE_KEYWORDS[tag].some((term) => sp.some((item) => includesFuzzy(item, term))),
      );
      if (matchedTags.length > 0) {
        s += Math.min(matchedTags.length * 6, 12);
        reasons.push(`业务方向贴合 ${matchedTags.join("、")}`);
      }
      // Conflict check
      const avoids = (e.avoid_units || "").split(/[\s,，、;；]+/).map((x: string) => x.trim()).filter(Boolean);
      const conflict = !!avoidUnitFull && avoids.some((u: string) => avoidUnitFull.includes(u) || u.includes(avoidUnitFull));
      if (conflict) {
        s -= 100;
        reasons.push(`需回避「${avoidUnitFull}」`);
      }
      // Historical performance
      const hist = scoreMap.get(e.id);
      let history_avg: number | null = null;
      if (hist && hist.max > 0) {
        history_avg = Math.round((hist.sum / hist.max) * 100) / 100;
        // Reward experienced moderate scorers (around 0.6–0.85 usefulness)
        if (hist.count >= 3) {
          s += 8;
          reasons.push(`参评 ${hist.count} 次`);
        }
        // Strict experts (giving lower scores) slightly preferred for evaluation rigor
        if (history_avg < 0.85) s += 3;
      }
      return {
        id: e.id, name: e.name, expert_type: e.expert_type,
        organization: e.organization, title: e.title, specialty: e.specialty,
        phone: e.phone, email: e.email,
        score: s, reasons, conflict, history_avg, history_count: hist?.count ?? 0,
        matched_terms: matchedTerms,
        matched_tags: matchedTags,
      };
    });

    // Group + quota
    const byType: Record<string, Scored[]> = { management: [], finance: [], business: [] };
    ranked.sort((a, b) => b.score - a.score).forEach((r) => {
      (byType[r.expert_type] ?? (byType[r.expert_type] = [])).push(r);
    });

    const quota = body.type_quota ?? { management: 2, finance: 1, business: 2 };
    const recommended: Scored[] = [];
    Object.entries(quota).forEach(([t, n]) => {
      const pool = (byType[t] ?? []).filter((x) => !x.conflict);
      recommended.push(...pool.slice(0, n ?? 0));
    });

    return new Response(JSON.stringify({
      project: { name: project.name, unit: project.unit, avoid_unit: avoidUnitFull },
      keywords: keywordList,
      project_profile: projectProfile,
      recommended,
      pool: { management: byType.management ?? [], finance: byType.finance ?? [], business: byType.business ?? [] },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("match-experts error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

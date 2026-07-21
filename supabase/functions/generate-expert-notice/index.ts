// Generate formal expert appointment notice HTML using Gemini
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExpertInput {
  id: string;
  name: string;
  expert_type: string;
  organization?: string | null;
  title?: string | null;
  specialty?: string | null;
}

const TYPE_CN: Record<string, string> = {
  business: "业务专家",
  management: "管理专家",
  finance: "财务专家",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { projectId, experts, durationDays = 30, dutyOverride } = await req.json();
    if (!Array.isArray(experts) || experts.length === 0) {
      return new Response(JSON.stringify({ error: "experts required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let projectInfo: any = null;
    if (projectId) {
      const { data } = await supabase
        .from("projects")
        .select("name, unit, fiscal_year, budget, category, description")
        .eq("id", projectId)
        .maybeSingle();
      projectInfo = data;
    }

    // Load notice.title template (admin-editable)
    let titleTpl = "专家评审组任命书";
    try {
      const { data: tpl } = await supabase
        .from("doc_templates")
        .select("content, enabled")
        .eq("template_key", "notice.title")
        .maybeSingle();
      if (tpl?.enabled && tpl.content) titleTpl = tpl.content as string;
    } catch (_) { /* ignore */ }

    const expertNames = (experts as ExpertInput[]).map(e => e.name).join("、");
    const renderVars: Record<string, string> = {
      expert_name: expertNames,
      project_name: projectInfo?.name ?? "",
      unit: projectInfo?.unit ?? "",
    };
    const docTitle = titleTpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => renderVars[k] ?? "");

    const today = new Date();
    const endDate = new Date(today.getTime() + durationDays * 86400000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    const noticeNo = `专评字〔${today.getFullYear()}〕第${String(
      Math.floor(Math.random() * 900) + 100,
    )}号`;

    const expertList = (experts as ExpertInput[])
      .map(
        (e, i) =>
          `${i + 1}. ${e.name}（${TYPE_CN[e.expert_type] ?? e.expert_type}${
            e.title ? "/" + e.title : ""
          }${e.organization ? "，" + e.organization : ""}${
            e.specialty ? "，专长：" + e.specialty : ""
          }）`,
      )
      .join("\n");

    const projectBlock = projectInfo
      ? `项目名称：${projectInfo.name}
委托单位：${projectInfo.unit}
财政年度：${projectInfo.fiscal_year}
项目预算：${Number(projectInfo.budget || 0).toLocaleString()} 元
项目类别：${projectInfo.category ?? "—"}
项目简介：${projectInfo.description ?? "—"}`
      : "项目信息未指定";
    const knowledge = projectId
      ? await buildProjectKnowledgeContext(
        supabase,
        { id: projectId, ...projectInfo },
        `${expertNames} ${dutyOverride ?? ""}`,
      )
      : { text: "", stats: { materialSnippets: 0, knowledgeSnippets: 0, historicalReports: 0, goalTargets: 0 } };

    const prompt = `你是政府绩效评价中心的公文写作专家。请为下列项目生成一份正式的《专家评审组任命书》正文（不要包含 HTML，仅纯文本段落，使用编号小节）。

要求：
1. 开头："根据《XX 项目绩效评价工作方案》，经研究决定..."
2. 包含小节：一、任命依据；二、任命专家名单（直接列出）；三、专家职责（5-7 条具体职责，结合专家类别）；四、工作期限；五、保密与回避要求；六、工作费用与补贴；七、联系方式。
3. 语言庄重正式，符合中国政府公文规范。
4. 不要使用 markdown 符号（**、## 等），用中文序号。
5. 总字数 600-900。

【项目信息】
${projectBlock}

【任命专家名单】
${expertList}

${knowledge.text ? `【项目资料与文件库依据】
${knowledge.text}

` : ""}【任命期限】${fmt(today)} 至 ${fmt(endDate)}（共 ${durationDays} 天）

${dutyOverride ? `【特别职责要求】${dutyOverride}` : ""}

注意：文件库和历史资料只用于辅助理解项目背景、专家职责重点和风险点；不得把历史项目事实写成当前项目事实。`;

    const aiResp = await callAI("expert_notice", {
      messages: [
        { role: "system", content: "你是中国政府绩效评价中心的资深公文写作专家。" },
        { role: "user", content: prompt },
      ],
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      if (aiResp.status === 429)
        return new Response(JSON.stringify({ error: "AI 请求过于频繁，请稍后再试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      if (aiResp.status === 402)
        return new Response(JSON.stringify({ error: "AI 额度已用尽，请到工作区充值" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      throw new Error("AI 生成失败");
    }

    const aiJson = await aiResp.json();
    const body: string = aiJson.choices?.[0]?.message?.content ?? "";

    // Wrap in formal HTML template with seal placeholder
    const paragraphs = body
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${p.replace(/</g, "&lt;")}</p>`)
      .join("\n");

    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>${docTitle} · ${noticeNo}</title>
<style>
  @page { size: A4; margin: 24mm 22mm; }
  body { font-family: "SimSun","Songti SC","Noto Serif CJK SC",serif; color:#111; line-height:1.9; font-size:14pt; }
  .doc { max-width: 720px; margin: 0 auto; padding: 36px 40px; background:#fff; }
  .header { text-align:center; border-bottom: 3px double #b91c1c; padding-bottom:18px; margin-bottom:24px; }
  .header .org { font-size:13pt; letter-spacing:.3em; color:#7f1d1d; margin-bottom:8px; }
  .header h1 { font-size:28pt; color:#b91c1c; font-weight:bold; letter-spacing:.4em; margin:8px 0; font-family:"FangSong","STFangsong","Noto Serif CJK SC",serif;}
  .meta { display:flex; justify-content:space-between; font-size:11pt; color:#555; margin-top:12px; }
  .body { text-indent:2em; }
  .body p { margin: 10px 0; text-indent:2em; }
  .body p:first-child { text-indent: 2em; }
  .seal-area { margin-top:60px; display:flex; justify-content:flex-end; align-items:flex-end; gap:60px; }
  .seal-box { text-align:center; }
  .seal-circle { width:130px; height:130px; border:3px solid #b91c1c; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#b91c1c; font-weight:bold; font-size:13pt; transform: rotate(-8deg); opacity:.85; margin: 0 auto 8px; line-height:1.3; padding:8px; }
  .sign-line { border-bottom:1px solid #333; min-width:160px; height:30px; margin-bottom:6px; }
  .sign-label { font-size:11pt; color:#555; }
  .footer-date { text-align:right; margin-top:30px; font-size:12pt; }
  .notice-no { color:#b91c1c; font-weight:bold; }
</style></head>
<body><div class="doc">
  <div class="header">
    <div class="org">${projectInfo?.unit ?? "委托单位"}</div>
    <h1>${docTitle}</h1>
    <div class="meta">
      <span class="notice-no">${noticeNo}</span>
      <span>密级：内部</span>
    </div>
  </div>
  <div class="body">
    ${paragraphs}
  </div>
  <div class="seal-area">
    <div class="seal-box">
      <div class="sign-line"></div>
      <div class="sign-label">项目负责人签字</div>
    </div>
    <div class="seal-box">
      <div class="seal-circle">${projectInfo?.unit ? projectInfo.unit.slice(0, 8) : "委托单位"}<br/>公　章</div>
      <div class="sign-label">单位盖章</div>
    </div>
  </div>
  <div class="footer-date">${fmt(today)}</div>
</div></body></html>`;

    return new Response(
      JSON.stringify({
        html,
        notice_no: noticeNo,
        start_date: fmt(today),
        end_date: fmt(endDate),
        expert_count: experts.length,
        injected: knowledge.stats,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

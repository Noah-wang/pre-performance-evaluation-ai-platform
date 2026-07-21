// Block-level AI rewrite for report sections
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STYLES: Record<string, string> = {
  formal: "更加正式、严谨，适合政府公文表达",
  concise: "更加简明扼要，删除冗余",
  expand: "扩充论证细节、补充数据与例证",
  rigorous: "强化逻辑结构、补全因果与依据",
  rectify: "针对薄弱环节加入整改措施口吻",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { block, style = "formal", instruction = "", context = "", project = null } = await req.json();
    if (!block || typeof block !== "string") {
      return new Response(JSON.stringify({ error: "block 不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const styleHint = STYLES[style] ?? STYLES.formal;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const knowledge = project?.id || project?.name
      ? await buildProjectKnowledgeContext(supabase, project, [block, instruction, context.slice(0, 1200)].join(" "))
      : { text: "", stats: { materialSnippets: 0, knowledgeSnippets: 0, historicalReports: 0, goalTargets: 0 } };
    const sys = `你是政府绩效评估报告的资深编辑。请仅对【需重写段落】进行重写，保持 Markdown 结构与小标题，不要添加额外章节，不要解释你做了什么，直接输出重写后的段落正文。`;
    const user = `【报告其它段落上下文（仅参考，不要复述）】\n${context.slice(0, 4000)}\n\n${knowledge.text ? `【项目资料与文件库依据】\n${knowledge.text}\n\n` : ""}【风格要求】${styleHint}\n${instruction ? `【附加指令】${instruction}\n` : ""}【约束】如使用文件库或历史资料，只能作为论证依据和线索；不得把历史项目事实写成当前项目已经发生的事实。\n\n【需重写段落】\n${block}`;

    const r = await callAI("report_rewrite", {
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    });
    if (r.status === 429) return new Response(JSON.stringify({ error: "AI 调用过于频繁" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (r.status === 402) return new Response(JSON.stringify({ error: "AI 用量已耗尽" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!r.ok) {
      const t = await r.text();
      console.error("AI error", r.status, t);
      throw new Error("AI 调用失败");
    }
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text, injected: knowledge.stats }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-Rag-Knowledge": String((knowledge.stats as any).knowledgeSnippets ?? 0),
        "X-Rag-Materials": String(knowledge.stats.materialSnippets ?? 0),
        "X-Rag-History": String(knowledge.stats.historicalReports ?? 0),
        "X-Rag-Goals": String(knowledge.stats.goalTargets ?? 0),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Edge function: generate indicator-aware rectification suggestions
// Auto-injects 3 contexts: evaluation plan + field research + missing materials
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ReqBody {
  projectId: string;
  reportContent: string;
  projectName: string;
  conclusion?: string | null;
}

const SYSTEM = `你是一名资深的政府事前绩效评估专家。
基于评估报告正文 + 评估方案 + 现场调研结论 + 缺漏材料清单 + 评估指标体系，
按"评估指标"维度逐项提炼整改建议。每条建议必须可操作、有抓手、可考核。

要求：
1. 必须按提供的"指标列表"为分组维度（category 字段填指标名称，如「决策科学性」「投入经济性」）。
2. 每个有问题或缺漏的指标至少 1 条建议；权重高的指标优先生成。
3. 优先针对"缺漏材料清单"和"现场调研结论"中暴露的问题。
4. 每条建议必须包含：
   - category: 指标名称（必须从给定的指标列表中选取）
   - title: 简短标题（≤20字）
   - detail: 详细说明（60-150字，含改进措施 + 资料补交建议 + 预期效果）
   - priority: high / medium / low（高优先 = 影响立项决定的核心问题）
   - responsible: 建议责任主体（如"申请单位""主管部门""财政部门"）
5. 总条数控制在 6-12 条，避免重复。`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: ReqBody = await req.json();
    const { projectId, reportContent, projectName, conclusion } = body;

    if (!reportContent) {
      return new Response(JSON.stringify({ error: "缺少报告正文" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === 注入三类上下文 ===
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let planSummary = "（无最新评估方案）";
    let fieldSummary = "（无现场调研结论）";
    let missingSummary = "（无缺漏材料）";
    let indicatorList = "（未关联评估指标体系）";
    let indicatorNames: string[] = [];
    let projectMeta: { id?: string; name?: string | null; unit?: string | null; category?: string | null; description?: string | null } | null = null;

    if (projectId) {
      // 1) 最新评估方案
      const { data: plan } = await sb
        .from("evaluation_plans")
        .select("title,content,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (plan) {
        const trimmed = (plan.content || "").slice(0, 3000);
        planSummary = `《${plan.title}》（${new Date(plan.created_at).toLocaleDateString("zh-CN")}）\n${trimmed}${plan.content && plan.content.length > 3000 ? "\n...(已截断)" : ""}`;
      }

      // 2) 现场调研结论汇总
      const { data: records } = await sb
        .from("field_records")
        .select("location,research_date,findings,conclusion")
        .eq("project_id", projectId)
        .order("research_date", { ascending: false })
        .limit(5);
      if (records?.length) {
        fieldSummary = records.map((r, i) =>
          `[${i + 1}] ${r.research_date} · ${r.location}\n  发现：${r.findings || "—"}\n  结论：${r.conclusion || "—"}`
        ).join("\n\n");
      }

      // 3) 缺漏材料清单 + 评估指标
      const { data: project } = await sb
        .from("projects")
        .select("evaluation_system_id,budget,unit,category")
        .eq("id", projectId)
        .maybeSingle();
      projectMeta = {
        id: projectId,
        name: projectName,
        unit: project?.unit ?? null,
        category: project?.category ?? null,
        description: null,
      };

      let indicatorMap = new Map<string, { name: string; weight: number; code: string | null }>();
      if (project?.evaluation_system_id) {
        const { data: indicators } = await sb
          .from("evaluation_indicators")
          .select("id,code,name,weight,required_materials,sort_order")
          .eq("system_id", project.evaluation_system_id)
          .order("sort_order", { ascending: true });
        if (indicators?.length) {
          indicatorList = indicators.map(i =>
            `- ${i.code ? `[${i.code}] ` : ""}${i.name}（权重 ${i.weight}）${i.required_materials ? ` · 应交：${i.required_materials}` : ""}`
          ).join("\n");
          indicatorNames = indicators.map(i => i.name);
          indicators.forEach(i => indicatorMap.set(i.id, { name: i.name, weight: Number(i.weight), code: i.code }));
        }
      }

      const { data: materials } = await sb
        .from("materials")
        .select("name,status,required,indicator_id,review_note")
        .eq("project_id", projectId);

      if (materials?.length) {
        const missing = materials.filter(m => m.status === "missing" && m.required);
        const rejected = materials.filter(m => m.status === "rejected");
        const lines: string[] = [];
        if (missing.length) {
          // 按指标分组
          const byInd = new Map<string, string[]>();
          missing.forEach(m => {
            const key = m.indicator_id ? (indicatorMap.get(m.indicator_id)?.name ?? "待匹配资料") : "待匹配资料";
            if (!byInd.has(key)) byInd.set(key, []);
            byInd.get(key)!.push(m.name);
          });
          lines.push(`【缺失必交资料 ${missing.length} 项】`);
          byInd.forEach((names, ind) => {
            lines.push(`  · ${ind}：${names.join("、")}`);
          });
        }
        if (rejected.length) {
          lines.push(`【已驳回资料 ${rejected.length} 项】`);
          rejected.forEach(m => lines.push(`  · ${m.name}${m.review_note ? `（驳回理由：${m.review_note}）` : ""}`));
        }
        if (lines.length) missingSummary = lines.join("\n");
        else missingSummary = `（${materials.length} 项资料齐备，无缺漏）`;
      }
    }

    const knowledge = await buildProjectKnowledgeContext(
      sb,
      projectMeta ?? { id: projectId, name: projectName },
      `${conclusion ?? ""} ${reportContent.slice(0, 1200)}`,
    );

    const userPrompt = `项目名称：${projectName}
评估结论：${conclusion ?? "未定"}

═══════ 评估指标体系（请按以下指标分组生成整改建议）═══════
${indicatorList}

${knowledge.text ? `═══════ 资料与历史案例参考 ═══════
${knowledge.text}

` : ""}═══════ 评估方案摘要 ═══════
${planSummary}

═══════ 现场调研结论 ═══════
${fieldSummary}

═══════ 缺漏 / 驳回材料清单 ═══════
${missingSummary}

═══════ 评估报告正文 ═══════
${reportContent.slice(0, 6000)}${reportContent.length > 6000 ? "\n...(已截断)" : ""}

补充要求：
1. 可综合“资料与历史案例参考”中的材料摘录、历史同类报告和目标库要求，判断哪些整改建议需要补证、补制度、补预算依据。
2. 历史案例和目标库内容只可作为整改思路参考，不能表述为当前项目已经具备的事实。
3. 对预算、成本、节约空间的建议，必须优先引用已提供资料或报告正文中已有依据，不得凭空造价。

请严格按"指标维度"分组生成整改建议清单。`;

    // 动态构造 enum：若有指标则限定 category 必须从指标名取值
    const categoryProperty: any = indicatorNames.length
      ? { type: "string", enum: indicatorNames, description: "必须从指标列表中选取" }
      : { type: "string", description: "整改类别" };

    const r = await callAI("rectification", {
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      tools: [{
          type: "function",
          function: {
            name: "emit_rectification",
            description: "返回按指标维度分组的整改建议清单",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      category: categoryProperty,
                      title: { type: "string" },
                      detail: { type: "string" },
                      priority: { type: "string", enum: ["high", "medium", "low"] },
                      responsible: { type: "string" },
                    },
                    required: ["category", "title", "detail", "priority", "responsible"],
                    additionalProperties: false,
                  },
                },
                context_summary: {
                  type: "string",
                  description: "对所注入上下文的简短回顾（≤80字）",
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
      }],
      tool_choice: { type: "function", function: { name: "emit_rectification" } },
    });

    if (r.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (r.status === 402) {
      return new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!r.ok) {
      const t = await r.text();
      console.error("AI gateway error:", r.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await r.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = tc?.function?.arguments ? JSON.parse(tc.function.arguments) : { items: [] };

    // 返回时附带「上下文注入快照」，前端用于显示「已注入X项」徽章
    return new Response(JSON.stringify({
      ...args,
      injected: {
        plan: planSummary !== "（无最新评估方案）",
        field_records_count: fieldSummary !== "（无现场调研结论）" ? (fieldSummary.match(/^\[\d+\]/gm)?.length ?? 0) : 0,
        missing_present: missingSummary !== "（无缺漏材料）",
        indicator_count: indicatorNames.length,
        rag_knowledge: (knowledge.stats as any).knowledgeSnippets ?? 0,
        rag_materials: knowledge.stats.materialSnippets,
        rag_history: knowledge.stats.historicalReports,
        rag_goals: knowledge.stats.goalTargets,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-rectification error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

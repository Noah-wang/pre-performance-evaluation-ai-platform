// Step 8B · AI 智能匹配评估指标→应交资料清单
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

interface IndicatorIn {
  id: string;
  code: string | null;
  name: string;
  weight: number | null;
  required_materials: string | null;
}
interface ReqBody {
  projectId?: string;
  projectName?: string;
  projectCategory?: string;
  systemName?: string;
  indicators: IndicatorIn[];
  existingMaterials: string[]; // 已存在的 "{indicatorId}::{materialName}" 键，用于去重
}

interface MatchedItem {
  indicator_id: string;
  name: string;
  category: string;
  required: boolean;
}

const PROMPT = `你是一名资深的政府项目预算绩效评估专家，熟悉财政评估资料清单标准。
我会给你一个评估指标体系（含若干指标），请你根据每个指标的名称与可选的"建议应交资料"提示，
为每个指标列出对应应该提交的资料清单。

要求：
1. 每个指标输出 2-5 条最关键的应交资料
2. 资料名称要具体、可核查（例：用"项目立项批复文件"而非"立项材料"）
3. category 必须从以下五选一：项目立项类 / 财务预算类 / 技术方案类 / 调研论证类 / 其他
4. required 标识该资料是否必须（核心证据 true，辅助参考 false）
5. 若该指标在已有清单中已出现的资料则不重复输出
6. 通过工具调用以 JSON 结构返回，不要输出文本说明`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!body.indicators?.length) {
      return new Response(JSON.stringify({ error: "indicators 不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existing = new Set(body.existingMaterials ?? []);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const knowledge = await buildProjectKnowledgeContext(
      supabase,
      {
        id: body.projectId,
        name: body.projectName,
        category: body.projectCategory,
      },
      [
        body.systemName,
        ...body.indicators.slice(0, 20).map((indicator) =>
          [indicator.code, indicator.name, indicator.required_materials].filter(Boolean).join(" "),
        ),
      ].join(" "),
    );

    const userPayload = `项目：${body.projectName ?? "（未提供）"}
类别：${body.projectCategory ?? "（未提供）"}
评估体系：${body.systemName ?? "（未提供）"}

指标清单（共 ${body.indicators.length} 项）：
${body.indicators.map(i => `- 【${i.id}】${i.code ? `[${i.code}] ` : ""}${i.name}（权重${i.weight ?? 0}）${i.required_materials ? `\n  建议资料：${i.required_materials}` : ""}`).join("\n")}

已有资料（请避免重复，格式 indicatorId::资料名）：
${[...existing].slice(0, 40).join(" | ") || "（无）"}

${knowledge.text ? `项目资料与文件库依据（用于判断资料清单应覆盖哪些证明材料，不得把历史项目事实当作当前项目事实）：
${knowledge.text}` : ""}`;

    const aiResp = await callAI("material_match", {
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: userPayload },
      ],
      tools: [{
          type: "function",
          function: {
            name: "submit_materials",
            description: "提交按指标匹配的应交资料清单",
            parameters: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      indicator_id: { type: "string", description: "对应的指标 id" },
                      name: { type: "string", description: "资料名称，要具体可核查" },
                      category: {
                        type: "string",
                        enum: ["项目立项类", "财务预算类", "技术方案类", "调研论证类", "其他"],
                      },
                      required: { type: "boolean" },
                    },
                    required: ["indicator_id", "name", "category", "required"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["items"],
              additionalProperties: false,
            },
          },
      }],
      tool_choice: { type: "function", function: { name: "submit_materials" } },
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "AI 调用频次超限，请稍后再试" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI 额度不足，请到工作区充值" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      throw new Error(`AI 网关错误 ${aiResp.status}`);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI 未返回工具调用结果");

    const args = JSON.parse(toolCall.function.arguments) as { items: MatchedItem[] };
    const validIndicatorIds = new Set(body.indicators.map(i => i.id));

    // 去重 + 过滤无效 indicator_id
    const filtered = (args.items ?? []).filter(it =>
      it.indicator_id && validIndicatorIds.has(it.indicator_id) &&
      it.name?.trim() && !existing.has(`${it.indicator_id}::${it.name.trim()}`)
    ).map(it => ({ ...it, name: it.name.trim() }));

    return new Response(JSON.stringify({ items: filtered, total: filtered.length, injected: knowledge.stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-materials error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

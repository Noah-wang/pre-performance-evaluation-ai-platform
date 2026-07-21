// AI Meeting Minutes Analyzer — extracts expert opinions by category
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildProjectKnowledgeContext, isEvidenceSupported } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUMMARY_DIMENSIONS = [
  "项目必要性",
  "项目可行性",
  "项目经济性",
  "项目效率性",
  "项目效益性",
];

const cleanConclusion = (value: unknown) =>
  String(value ?? "")
    .replace(/^\s*(专家|主持人|会议|评审组)(指出|认为|建议|提出|强调)\s*[，,：:]?\s*/g, "")
    .replace(/^\s*根据(会议发言|会议纪要|资料显示|项目资料|现有资料)\s*[，,：:]?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。；;]+$/g, "");

const formatEvidenceConstrainedSummary = (
  dimensions: unknown,
  meetingCorpus: string,
  materialCorpus: string,
) => {
  const rows = Array.isArray(dimensions) ? dimensions : [];
  const byName = new Map<string, any>();
  rows.forEach((item) => {
    const name = String(item?.dimension ?? "").trim();
    if (name) byName.set(name, item);
  });

  let supportedCount = 0;
  const lines = SUMMARY_DIMENSIONS.flatMap((dimension, index) => {
    const item = byName.get(dimension);
    const sourceType = String(item?.sourceType ?? "none");
    const evidence = String(item?.evidence ?? "").trim();
    const conclusion = cleanConclusion(item?.conclusion);
    const corpus = sourceType === "meeting"
      ? meetingCorpus
      : sourceType === "material" || sourceType === "economicEvidence"
        ? materialCorpus
        : "";
    const supported = Boolean(conclusion) && isEvidenceSupported(evidence, corpus);

    if (!supported) {
      return [
        `${index + 1}.${dimension}`,
        "会议纪要未形成该维度明确意见，需补充对应证明材料或专家意见。",
      ];
    }

    supportedCount += 1;
    if (sourceType !== "meeting") {
      return [
        `${index + 1}.${dimension}`,
        `会议纪要未形成该维度明确意见；根据资料显示，${conclusion}。该内容仅作为资料补证线索，不作为专家会议发言。`,
      ];
    }
    const prefix = "根据会议发言";
    return [
      `${index + 1}.${dimension}`,
      `${prefix}，${conclusion}。`,
    ];
  });

  lines.push(
    "总体意见：",
    supportedCount > 0
      ? `根据现有会议纪要和资料摘录，已形成 ${supportedCount} 个维度的初步判断；其余维度仍需补充直接依据后再确定最终支持倾向。`
      : "根据现有会议纪要和资料摘录，暂未形成足以支撑完整预评估结论的直接依据，需补充明确专家意见或证明材料。",
    "其他问题和建议：",
    "1. 后续完善意见时，应逐项补充会议发言或项目资料中的直接依据，避免将通用判断写成专家意见。",
  );

  return lines.join("\n");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { content, title, projectName, economicEvidence } = await req.json();
    if (typeof content !== "string" || !content.trim()) {
      return new Response(JSON.stringify({ error: "纪要内容不能为空" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (content.length > 30000) {
      return new Response(JSON.stringify({ error: "纪要内容过长（>30000字符），请精简后再试" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const knowledge = projectName
      ? await buildProjectKnowledgeContext(
        sb,
        { name: projectName },
        [title, typeof economicEvidence === "string" ? economicEvidence : ""].filter(Boolean).join(" "),
      )
      : { text: "", stats: { materialSnippets: 0, historicalReports: 0, goalTargets: 0 } };

    const systemPrompt = `你是一位专业的政府事前绩效评估秘书，擅长从评估会议纪要中按"业务专家 / 管理专家 / 财务专家"三类抽取每位专家的核心观点。

你的任务：
1. 仔细阅读会议纪要
2. 识别每位发言专家的姓名与所属类别（业务/管理/财务）
3. 对每位专家提取：核心观点、风险提示、改进建议
4. 在 dimensions 字段中逐项抽取五个维度的“依据来源、原文摘录、判断结论”，summary 字段只作为备用。
1.项目必要性
（归并政策依据、职能相关性、现实需求、财政投入、绩效目标方面的意见和扣分理由）
2.项目可行性
（归并实施条件、实施方案、管理制度、风险控制方面的意见和扣分理由）
3.项目经济性
（归并预算依据、成本构成、成本控制、成本节约方面的意见和扣分理由）
4.项目效率性
（归并产出、进度、资金使用效率、指标可评价性方面的意见和扣分理由）
5.项目效益性
（归并经济社会生态效益、可持续影响、满意度方面的意见和扣分理由）
总体意见：
（给出支持倾向及核心理由）
其他问题和建议：
（逐条提出可执行建议）
5. 每个维度只能引用“会议纪要原文”中明确出现的发言、或“项目资料与历史参考”中明确对应当前项目的材料摘录。不得为了填满五个维度而自行补充常识性判断。
6. evidence 必须尽量摘录原文中的连续句子或短语，不能写总结句；如果找不到直接依据，sourceType 必须为 none，evidence 和 conclusion 均留空。
7. 只有 sourceType=meeting 时，conclusion 才能写“专家/主持人/会议认为”的含义；sourceType=material 时只能表达“资料显示”，不得伪装成会议发言。sourceType=material 的内容在最终 summary 中会被标记为“资料补证线索”，不能作为会议意见。
8. 如果某个维度会议纪要没有明确发言，且项目资料摘录也没有直接证据，必须让该维度 sourceType=none，不得生成具体评价结论。
9. 严禁生成会议纪要和资料中都没有出现的表述，例如“绩效目标可以再详细”“进度安排的精细性”“资金使用效率的可评价性”等，除非原文 evidence 中明确出现同义内容。
10. 不得虚构纪要中没有出现的政策名称、金额、日期或专家意见；信息不足时明确写“根据现有资料无法确认”。
11. 如用户提供“项目经济性客观证据”，必须将其中有来源的预算明细、参考价格、可比性调整、合理金额和节约空间写入“3.项目经济性”；无客观来源的预算项只能披露证据不足，不得自行补价格。
12. summary 不使用 Markdown，不使用项目符号，不输出重复标题；每个维度最多 2 句，优先写“依据来源 + 判断 + 待补证点”。若会议原文没有提到某个结论，不得写“专家指出/专家认为/会议认为”。

类别判断要点：
- 业务专家：聚焦项目内容、技术方案、行业经验
- 管理专家：聚焦项目管理、组织实施、政策合规
- 财务专家：聚焦预算、成本、资金、绩效目标

如果某类无专家发言，对应数组返回空数组 []。`;

    const userPrompt = `项目名称：${projectName ?? "（未提供）"}
会议主题：${title ?? "（未提供）"}

会议纪要原文：
"""
${content}
"""

${knowledge.text ? `项目资料与历史参考：
"""
${knowledge.text}
"""

` : ""}项目经济性客观证据：
"""
${typeof economicEvidence === "string" && economicEvidence.trim() ? economicEvidence : "未提供预算明细成本分析。"}
"""

补充要求：
1. 如“项目资料与历史参考”提供了当前项目材料摘录，可据此辅助判断哪些意见已有资料支撑、哪些仍需补证；引用时必须写成“根据资料显示/资料显示”，不能写成“专家认为”。
2. 历史项目与目标库内容仅可作为论证线索，不得当作当前会议已确认的事实直接引用。
3. 如果会议只是测试、寒暄、转写样例，summary 必须说明“会议纪要内容不足，暂不能形成正式预评估意见”，不要编造五个维度的完整判断。

请严格按照工具 schema 输出结构化结果。`;

    const resp = await callAI("meeting_analysis", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [{
          type: "function",
          function: {
            name: "extract_expert_opinions",
            description: "按业务/管理/财务三类提取专家观点，并按五大评估维度形成正式专家组意见",
            parameters: {
              type: "object",
              properties: {
                business: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      expert: { type: "string", description: "专家姓名" },
                      opinion: { type: "string", description: "核心观点" },
                      risk: { type: "string", description: "风险提示" },
                      suggestion: { type: "string", description: "改进建议" },
                    },
                    required: ["expert", "opinion", "risk", "suggestion"],
                    additionalProperties: false,
                  },
                },
                management: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      expert: { type: "string" },
                      opinion: { type: "string" },
                      risk: { type: "string" },
                      suggestion: { type: "string" },
                    },
                    required: ["expert", "opinion", "risk", "suggestion"],
                    additionalProperties: false,
                  },
                },
                finance: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      expert: { type: "string" },
                      opinion: { type: "string" },
                      risk: { type: "string" },
                      suggestion: { type: "string" },
                    },
                    required: ["expert", "opinion", "risk", "suggestion"],
                    additionalProperties: false,
                  },
                },
                dimensions: {
                  type: "array",
                  description: "五个评估维度的依据抽取。没有直接依据的维度必须 sourceType=none。",
                  items: {
                    type: "object",
                    properties: {
                      dimension: {
                        type: "string",
                        enum: ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"],
                      },
                      sourceType: {
                        type: "string",
                        enum: ["meeting", "material", "economicEvidence", "none"],
                        description: "依据来源：会议纪要、项目资料、经济性证据，或无直接依据",
                      },
                      evidence: {
                        type: "string",
                        description: "必须是对应来源中的原文连续摘录；无直接依据时留空",
                      },
                      conclusion: {
                        type: "string",
                        description: "基于 evidence 可直接推出的正式判断；无直接依据时留空",
                      },
                    },
                    required: ["dimension", "sourceType", "evidence", "conclusion"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string", description: "备用正式文本；实际返回会由服务端按 dimensions 和原文依据重新生成" },
              },
              required: ["business", "management", "finance", "dimensions", "summary"],
              additionalProperties: false,
            },
          },
      }],
      tool_choice: { type: "function", function: { name: "extract_expert_opinions" } },
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "AI 额度不足，请前往 Settings → Workspace → Usage 充值" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI 网关错误" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return new Response(JSON.stringify({ error: "AI 未返回结构化结果" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const args = JSON.parse(toolCall.function.arguments);
    const materialCorpus = [knowledge.text, typeof economicEvidence === "string" ? economicEvidence : ""].filter(Boolean).join("\n");
    const constrainedSummary = formatEvidenceConstrainedSummary(args.dimensions, content, materialCorpus);

    return new Response(JSON.stringify({
      ...args,
      summary: constrainedSummary,
      injected: knowledge.stats,
    }), {
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
    console.error("analyze-meeting error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

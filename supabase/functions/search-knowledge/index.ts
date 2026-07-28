import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { createTextEmbeddingAsync, tokenizeForEmbedding, vectorLiteral } from "../_shared/embedding.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const trimSnippet = (value: string, max = 2200) => {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const removeInvalidCitations = (value: string, hitCount: number) =>
  String(value ?? "")
    .replace(/\[(\d+)\]/g, (match, rawIndex) => {
      const index = Number(rawIndex);
      return Number.isInteger(index) && index >= 1 && index <= hitCount ? match : "";
    })
    .replace(/[ \t]+([，。；：、,.!?！？])/g, "$1")
    .replace(/\s{3,}/g, "\n\n")
    .trim();

const SYNONYMS: Record<string, string[]> = {
  收费: ["费用", "金额", "预算", "保管费", "服务费", "单价", "总价", "报价", "测算"],
  费用: ["收费", "金额", "预算", "保管费", "服务费", "单价", "总价", "报价", "测算"],
  金额: ["费用", "收费", "预算", "万元", "元", "合计"],
  预算: ["金额", "费用", "收费", "测算", "报价", "万元"],
  证明: ["依据", "支撑", "材料", "文件", "说明", "佐证"],
  依据: ["证明", "支撑", "材料", "文件", "说明", "佐证"],
};

const expandQueryTokens = (query: string) => {
  const tokens = new Set(tokenizeForEmbedding(query));
  for (const token of [...tokens]) {
    for (const synonym of SYNONYMS[token] ?? []) tokens.add(synonym);
  }
  return [...tokens];
};

const keywordSimilarity = (queryTokens: string[], content: string) => {
  if (!queryTokens.length || !content) return 0;
  const normalized = content.toLowerCase();
  const hits = queryTokens.filter((token) => normalized.includes(token));
  const base = hits.length / Math.max(1, queryTokens.length);
  const hasMoneySignal = /(\d+(?:\.\d+)?\s*(万)?元)|预算|金额|费用|收费/.test(normalized);
  return Math.min(0.92, base * 0.86 + (hasMoneySignal && queryTokens.some((token) => ["收费", "费用", "金额", "预算"].includes(token)) ? 0.18 : 0));
};

const matchedTerms = (queryTokens: string[], content: string) => {
  const normalized = String(content ?? "").toLowerCase();
  return queryTokens.filter((token, index, list) =>
    list.indexOf(token) === index && normalized.includes(token)
  ).slice(0, 8);
};

const displaySimilarity = (rawSimilarity: number, keywordScore: number) => {
  const normalizedRaw = Number.isFinite(rawSimilarity) ? Math.max(0, Math.min(1, rawSimilarity)) : 0;
  return Math.max(normalizedRaw, keywordScore);
};

const mergeRetrievalResults = (vectorRows: any[], keywordRows: any[], queryTokens: string[], limit: number) => {
  const map = new Map<string, any>();
  const maxKeywordScore = Math.max(1, ...keywordRows.map((item: any) => Number(item.keyword_score ?? 0)));

  for (const item of vectorRows) {
    const key = String(item.chunk_id ?? `${item.file_id}:${item.chunk_index}`);
    map.set(key, {
      ...item,
      vector_similarity: Number(item.similarity ?? 0),
      keyword_score_raw: 0,
    });
  }

  for (const item of keywordRows) {
    const key = String(item.chunk_id ?? `${item.file_id}:${item.chunk_index}`);
    const current = map.get(key) ?? {};
    map.set(key, {
      ...current,
      ...item,
      vector_similarity: Number(current.vector_similarity ?? 0),
      keyword_score_raw: Math.max(Number(current.keyword_score_raw ?? 0), Number(item.keyword_score ?? 0)),
    });
  }

  return [...map.values()]
    .map((item: any) => {
      const content = trimSnippet(item.content);
      const searchable = [item.title, item.file_name, item.category, content].filter(Boolean).join(" ");
      const keywordScore = Math.max(
        keywordSimilarity(queryTokens, searchable),
        Math.min(1, Number(item.keyword_score_raw ?? 0) / maxKeywordScore),
      );
      const vectorScore = Number(item.vector_similarity ?? 0);
      const terms = matchedTerms(queryTokens, searchable);
      const similarity = displaySimilarity(vectorScore, keywordScore);
      const hybridScore = Math.max(similarity, vectorScore * 0.55 + keywordScore * 0.45);
      const reasonParts = [
        vectorScore > 0.1 ? "语义相近" : "",
        terms.length ? `命中：${terms.join("、")}` : "",
        Number(item.keyword_score_raw ?? 0) > 0 ? "文件名/分类/正文关键词匹配" : "",
      ].filter(Boolean);

      return {
        ...item,
        content,
        similarity,
        vector_similarity: vectorScore,
        keyword_similarity: keywordScore,
        matched_terms: terms,
        match_reason: reasonParts.join("；") || "系统综合排序命中",
        source_location: `《${item.file_name || item.title || "资料文件"}》第 ${Number(item.chunk_index ?? 0) + 1} 个片段`,
        hybrid_score: hybridScore,
      };
    })
    .sort((a: any, b: any) => b.hybrid_score - a.hybrid_score)
    .slice(0, limit)
    .map((item: any, index: number) => ({ ...item, rank: index + 1 }));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query, projectId = null, matchCount = 8, answer = true } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "请输入检索问题" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const queryTokens = expandQueryTokens(query);
    const [vectorRes, keywordRes] = await Promise.all([
      supabase.rpc("match_knowledge_chunks", {
        query_embedding: vectorLiteral(await createTextEmbeddingAsync(query)),
        match_count: Math.max(Number(matchCount) || 8, 8),
        match_project_id: projectId,
      }),
      supabase.rpc("keyword_knowledge_chunks", {
        query_terms: queryTokens.slice(0, 24),
        match_count: Math.max((Number(matchCount) || 8) * 2, 12),
        match_project_id: projectId,
      }),
    ]);
    if (vectorRes.error) throw vectorRes.error;
    if (keywordRes.error) {
      console.warn("keyword retrieval fallback:", keywordRes.error);
    }

    const hits = mergeRetrievalResults(
      vectorRes.data ?? [],
      keywordRes.error ? [] : (keywordRes.data ?? []),
      queryTokens,
      Math.min(Math.max(Number(matchCount) || 8, 1), 12),
    );

    if (!answer) {
      return new Response(JSON.stringify({ answer: "", hits }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let projectKnowledge = "";
    if (projectId) {
      try {
        const knowledge = await buildProjectKnowledgeContext(supabase, { id: projectId }, query);
        projectKnowledge = knowledge.text || "";
      } catch (error) {
        console.warn("project knowledge fallback failed:", error);
      }
    }

    const vectorSourceText = hits.map((hit: any) =>
      `[${hit.rank}]《${hit.file_name || hit.title}》${hit.category ? `（${hit.category}）` : ""}\n${hit.content}`
    ).join("\n\n");
    const sourceText = [
      vectorSourceText
        ? `【可编号引用的片段】\n下面只有 ${hits.length} 条片段，回答中只能使用 [1] 到 [${hits.length}] 这些编号，不得使用超出范围的编号。\n${vectorSourceText}`
        : "",
      projectKnowledge
        ? `【未编号的项目背景资料】\n以下资料可以用于理解背景，但回答中不得用 [数字] 引用；如需引用，只能写资料名称。\n${projectKnowledge}`
        : "",
    ].filter(Boolean).join("\n\n");

    if (!sourceText.trim()) {
      return new Response(JSON.stringify({
        answer: "当前项目暂无可用于回答的资料。请先在资料收集审核上传文件，或在报告/方案页面生成项目文件。",
        hits,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let finalAnswer = "";
    try {
      const aiResp = await callAI("knowledge_qa", {
        messages: [
          {
            role: "system",
            content:
              `你是财政绩效评估资料库助手。只能依据给定资料回答；资料不足时必须说明缺少依据。请用简洁 Markdown 组织回答，优先包含：### 结论、### 主要依据、### 需补充/注意事项。只有“可编号引用的片段”允许用 [数字] 标注，且本次最多只能使用 [1] 到 [${hits.length}]；不得使用 [${hits.length + 1}] 或更大的编号。引用“未编号的项目背景资料”时，不要使用 [数字]，只写资料名称。不要输出无依据的推断。`,
          },
          {
            role: "user",
            content: `问题：${query}\n\n可引用资料片段：\n${sourceText}`,
          },
        ],
      });
      if (aiResp.ok) {
        const json = await aiResp.json();
        finalAnswer = String(json.choices?.[0]?.message?.content ?? "").trim();
      } else {
        console.warn("knowledge QA AI failed:", aiResp.status, await aiResp.text());
      }
    } catch (error) {
      console.warn("knowledge QA fallback:", error);
    }

    if (!finalAnswer) {
      finalAnswer = hits.length
        ? `已检索到 ${hits.length} 条相关资料片段。请优先查看：${hits
          .slice(0, 3)
          .map((hit: any) => `[${hit.rank}]《${hit.file_name || hit.title}》`)
          .join("、")}。`
        : "已读取当前项目资料，但 AI 暂未生成可用回答。请换一个更具体的问题重试。";
    }
    finalAnswer = removeInvalidCitations(finalAnswer, hits.length);

    return new Response(JSON.stringify({ answer: finalAnswer, hits }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("search-knowledge error:", error);
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

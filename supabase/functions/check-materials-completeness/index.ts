// AI 校验项目资料完整性：根据指标 required_materials 与已上传资料清单做比对
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { extractMaterialText } from "../_shared/materials.ts";
import { buildProjectKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Gap {
  indicator_id?: string;
  material_id?: string;
  indicator: string;
  required: string;
  status: "missing" | "partial" | "covered";
  matched_material?: string;
  match_score?: number;          // 0-100 语义匹配度
  match_basis?: string;          // 命中关键词/类别等客观依据
  reason?: string;               // 详细判定理由（为何 covered/partial/missing）
  suggestion?: string;
}

const DOMAIN_TERMS = [
  "立项", "批复", "批文", "申请", "申报", "绩效", "目标", "预算", "测算", "资金", "来源",
  "实施方案", "实施", "方案", "可行性研究", "可行性", "研究报告", "报告", "专家论证", "专家",
  "论证意见", "论证", "意见", "初步设计", "总体设计", "设计图纸", "图纸", "法律", "法规",
  "规章制度", "政策", "大政方针", "发展规划", "规划", "计划", "材料", "设备", "规格",
  "品牌", "生产厂家", "厂家", "价格", "依据", "定额", "取费标准", "行业主管部门", "风险",
  "评估", "背景", "证明", "支撑", "相关文件", "说明",
];

// 关键词归一化：去标点、转小写、去空白
const norm = (s: string) =>
  (s ?? "").toLowerCase().replace(/[\s\u3000]+/g, "").replace(/[，,。.；;、:：()\[\]【】《》"'`!?]/g, "");

const extractTokens = (value: string) => {
  const raw = String(value ?? "").trim();
  const normalized = norm(raw);
  const tokens = new Set<string>();

  raw
    .split(/[\n,，;；、:：\/\\（）()【】\[\]\s]+/g)
    .map((part) => norm(part))
    .filter((part) => part.length >= 2)
    .forEach((part) => tokens.add(part));

  for (const term of DOMAIN_TERMS) {
    const token = norm(term);
    if (token && normalized.includes(token)) tokens.add(token);
  }

  if (!tokens.size && normalized.length >= 2) tokens.add(normalized);
  return [...tokens];
};

// 把 required_materials 文本拆为独立条目
const splitRequired = (txt: string | null | undefined): string[] => {
  if (!txt) return [];
  return txt
    .split(/[\n;；、,，]|(?:\d+[.．、))])/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
};

// 客观规则预匹配：优先看正文命中，其次才看资料名/分类
function preMatch(
  reqItem: string,
  mats: { id: string; name: string; file_name: string; category: string; effective: boolean; content: string }[],
) {
  const r = norm(reqItem);
  if (!r) return null;
  const rTokens = extractTokens(reqItem);
  let best: {
    id: string;
    name: string;
    score: number;
    basis: string;
    effective: boolean;
  } | null = null;
  for (const m of mats) {
    const nameTarget = norm(`${m.name} ${m.file_name}`);
    const categoryTarget = norm(m.category);
    const contentTarget = norm(m.content);
    if (!nameTarget && !categoryTarget && !contentTarget) continue;

    let nameHits = 0;
    let categoryHits = 0;
    let contentHits = 0;
    const nameMatched: string[] = [];
    const categoryMatched: string[] = [];
    const contentMatched: string[] = [];
    for (const t of rTokens) {
      if (contentTarget.includes(t)) {
        contentHits += 1;
        contentMatched.push(t);
        continue;
      }
      if (nameTarget.includes(t)) {
        nameHits += 1;
        nameMatched.push(t);
        continue;
      }
      if (categoryTarget.includes(t)) {
        categoryHits += 1;
        categoryMatched.push(t);
      }
    }

    const directContentMatch = contentTarget.includes(r);
    const directNameMatch = nameTarget.includes(r) || (r.length >= 4 && r.includes(norm(m.name)));
    const score = Math.min(
      100,
      Math.round((contentHits / Math.max(1, rTokens.length)) * 70)
      + Math.round((nameHits / Math.max(1, rTokens.length)) * 22)
      + Math.round((categoryHits / Math.max(1, rTokens.length)) * 8)
      + (directContentMatch ? 25 : 0)
      + (!directContentMatch && directNameMatch ? 10 : 0),
    );

    const basisParts = [
      contentMatched.length ? `正文命中：${contentMatched.join("/")}` : "",
      nameMatched.length ? `名称命中：${nameMatched.join("/")}` : "",
      categoryMatched.length ? `分类命中：${categoryMatched.join("/")}` : "",
    ].filter(Boolean);

    if (!best || score > best.score) {
      best = {
        id: m.id,
        name: m.name,
        score,
        basis: basisParts.join("；") || (directNameMatch ? "名称近似匹配" : ""),
        effective: m.effective,
      };
    }
  }
  return best;
}

async function loadIndexedMaterialText(supabase: any, materialIds: string[]) {
  const result = new Map<string, string>();
  if (!materialIds.length) return result;

  const { data: files } = await supabase
    .from("knowledge_files")
    .select("id,source_id,summary")
    .eq("source_type", "material")
    .eq("status", "indexed")
    .in("source_id", materialIds);

  const fileRows = files ?? [];
  if (!fileRows.length) return result;

  const fileToMaterial = new Map(fileRows.map((file: any) => [file.id, file.source_id]));
  const summaries = new Map(fileRows.map((file: any) => [file.source_id, String(file.summary ?? "")]));
  const { data: chunks } = await supabase
    .from("knowledge_chunks")
    .select("file_id,chunk_index,content")
    .in("file_id", fileRows.map((file: any) => file.id))
    .order("chunk_index", { ascending: true });

  for (const chunk of chunks ?? []) {
    const materialId = fileToMaterial.get(chunk.file_id);
    if (!materialId) continue;
    const current = result.get(materialId) || summaries.get(materialId) || "";
    if (current.length > 5000) continue;
    result.set(materialId, `${current}\n${chunk.content}`.trim().slice(0, 6000));
  }

  for (const [materialId, summary] of summaries.entries()) {
    if (!result.has(materialId) && summary) result.set(materialId, summary);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { projectId } = await req.json();
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId 必填" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: project }, { data: materials }] = await Promise.all([
      supabase.from("projects").select("id,name,evaluation_system_id,category").eq("id", projectId).maybeSingle(),
      supabase.from("materials").select("id,name,category,status,file_path,file_name,review_note").eq("project_id", projectId),
    ]);

    if (!project) throw new Error("项目不存在");
    const knowledge = await buildProjectKnowledgeContext(
      supabase,
      {
        id: project.id,
        name: project.name,
        category: project.category,
      },
      (materials ?? []).map((material: any) => material.name).join(" "),
    );

    let indicators: any[] = [];
    if (project.evaluation_system_id) {
      const { data } = await supabase
        .from("evaluation_indicators")
        .select("id,name,code,required_materials,level")
        .eq("system_id", project.evaluation_system_id)
        .order("sort_order", { ascending: true });
      indicators = data ?? [];
    }

    const materialIds = (materials ?? []).map((m: any) => m.id).filter(Boolean);
    const indexedText = await loadIndexedMaterialText(supabase, materialIds);

    const matList = await Promise.all((materials ?? []).map(async (m: any) => {
      const cachedContent = indexedText.get(m.id);
      const content = cachedContent || await extractMaterialText(supabase, m);
      return {
        id: m.id,
        name: m.name,
        file_name: String(m.file_name ?? ""),
        category: m.category ?? "",
        effective: !!m.file_path && ["received", "approved"].includes(m.status),
        status: m.status,
        content,
      };
    }));

    // === 客观规则预匹配，生成候选 gaps ===
    const candidates: Gap[] = [];
    for (const ind of indicators) {
      const items = splitRequired(ind.required_materials);
      const evidenceItems = items.length ? items : [ind.name];
      for (const item of evidenceItems) {
        const best = preMatch(item, matList);
        let status: Gap["status"] = "missing";
        let reason = "";
        // 阈值：≥65 视为 covered；25~64 视为 partial；<25 视为 missing。
        // 文件名/分类在财政资料场景中也有较强信号，避免 OCR 暂不可用时全量误判为缺失。
        // 同时要求资料状态为 received/approved 且已上传文件
        if (best && best.score >= 65 && best.effective) {
          status = "covered";
          reason = `已上传《${best.name}》，匹配度 ${best.score}/100；${best.basis || "与要求材料高度一致"}，且文件已收到/通过审核。`;
        } else if (best && best.score >= 25) {
          status = "partial";
          reason = best.effective
            ? `已上传《${best.name}》，但匹配度仅 ${best.score}/100（${best.basis || "正文或名称覆盖不足"}），需补充更贴切的材料。`
            : `存在疑似匹配《${best.name}》（匹配度 ${best.score}/100；${best.basis || "仅部分命中"}），但文件未上传或审核未通过。`;
        } else {
          status = "missing";
          reason = best
            ? `已上传资料中最相近的是《${best.name}》，但匹配度仅 ${best.score}/100（${best.basis || "缺少正文佐证"}），不能视为有效覆盖。`
            : `项目资料库中未发现与"${item}"语义相关的材料。`;
        }
        candidates.push({
          indicator_id: ind.id,
          material_id: best?.id,
          indicator: ind.name,
          required: item,
          status,
          matched_material: best?.name,
          match_score: best?.score,
          match_basis: best?.basis,
          reason,
        });
      }
    }

    // === 调用 AI 复核：调整边界判定 + 补充建议 ===
const sys = `你是政府绩效评估的资料审查专家。下面提供已用客观规则预匹配的判定列表，请你基于专业语义复核每一条：
- 当 status=covered 但语义其实不符时，下调为 partial 或 missing；当 missing 但语义实际相关时，上调。
- 允许一份资料同时支撑多个指标；不要因为资料没有按指标分类上传，就判定为缺失。
- 必须保留 indicator_id 和 material_id；如果某个指标没有明确 required_materials，请按指标名称和项目资料整体语义判断。
- 优先依据文件正文摘录判断；文件正文为空时才依据文件名、类别和审核备注判断。
- 必须保留并完善 reason 字段：写明"为什么"判定为该状态，结合资料名称、类别、关键词命中情况。
- 为 missing/partial 项给出具体 suggestion（应补交什么形式的材料、需包含哪些核心信息）。
- 严格按以下 JSON 返回：{"gaps":[{"indicator":"...","required":"...","status":"missing|partial|covered","matched_material":"...","match_score":0-100,"match_basis":"...","reason":"...","suggestion":"..."}],"summary":"整体完整度文字总结，指出主要风险点","completion_rate":0-100}
- completion_rate 计算：covered=1, partial=0.5, missing=0，求平均后 ×100 取整。`;

    const user = JSON.stringify({
      project: { name: project.name, category: project.category },
      knowledge_reference: knowledge.text
        ? "以下为项目文件库、当前资料、历史报告和目标库检索依据。可辅助判断资料是否具备证明力，但历史项目不得当作当前项目事实。\\n" + knowledge.text
        : "",
      uploaded_materials: matList.map((m) => ({
        id: m.id,
        name: m.name,
        file_name: m.file_name,
        category: m.category,
        effective: m.effective,
        content_excerpt: m.content,
      })),
      pre_matched_gaps: candidates,
    });

    const aiResp = await callAI("material_completeness", {
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "AI 调用过于频繁，请稍后重试" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "AI 用量已耗尽" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI error", aiResp.status, t);
      // AI 失败时降级为纯规则结果
      const covered = candidates.filter((g) => g.status === "covered").length;
      const partial = candidates.filter((g) => g.status === "partial").length;
      const total = Math.max(1, candidates.length);
      const rate = Math.round(((covered + partial * 0.5) / total) * 100);
      return new Response(JSON.stringify({
        gaps: candidates,
        summary: "AI 复核暂不可用，已按客观规则给出判定。",
        completion_rate: rate,
        injected: knowledge.stats,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await aiResp.json();
    const text = data.choices?.[0]?.message?.content ?? "{}";
    let parsed: { gaps: Gap[]; summary: string; completion_rate: number };
    try {
      parsed = JSON.parse(text);
      // 兜底：保证 reason 字段存在
      parsed.gaps = (parsed.gaps ?? []).map((g, i) => ({
        ...candidates[i],
        ...g,
        reason: g.reason || candidates[i]?.reason || "",
      }));
    } catch {
      const covered = candidates.filter((g) => g.status === "covered").length;
      const partial = candidates.filter((g) => g.status === "partial").length;
      const total = Math.max(1, candidates.length);
      parsed = {
        gaps: candidates,
        summary: text || "已按客观规则给出判定。",
        completion_rate: Math.round(((covered + partial * 0.5) / total) * 100),
      };
    }

    return new Response(JSON.stringify({ ...parsed, injected: knowledge.stats }), {
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
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

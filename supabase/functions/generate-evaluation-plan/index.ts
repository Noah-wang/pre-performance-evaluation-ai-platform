// AI 评估方案生成 — 基于项目、工作组成员、时间任务、评估指标体系自动生成"评估实施方案"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI, resolveAIModel } from "../_shared/ai.ts";
import { buildReportKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TITLE_SUFFIXES = [
  "组长",
  "副组长",
  "专家",
  "老师",
  "主任",
  "负责人",
  "经理",
  "主管",
  "科长",
  "处长",
  "局长",
];

const cleanName = (value: unknown) => String(value ?? "").trim();

const stripTitleSuffix = (value: string) => {
  let next = cleanName(value);
  for (const suffix of TITLE_SUFFIXES) {
    if (next.endsWith(suffix) && next.length > suffix.length) {
      next = next.slice(0, -suffix.length).trim();
      break;
    }
  }
  return next;
};

const buildCanonicalNameResolver = (members: any[] = []) => {
  const memberNames = members
    .map((member) => cleanName(member?.member_name))
    .filter(Boolean);

  return (value: unknown) => {
    const raw = cleanName(value);
    if (!raw) return "";
    if (memberNames.includes(raw)) return raw;

    const base = stripTitleSuffix(raw);
    if (!base || base === raw) return raw;

    const candidates = memberNames.filter((name) => name.startsWith(base));
    return candidates.length === 1 ? candidates[0] : raw;
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project, group, members, tasks, system, indicators } = await req.json();
    if (!project?.name) {
      return new Response(JSON.stringify({ error: "缺少项目信息" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const canonicalName = buildCanonicalNameResolver(members ?? []);
    const canonicalLeader = canonicalName(group?.leader);
    const nameRules = [
      group?.leader && canonicalLeader && group.leader !== canonicalLeader
        ? `- ${group.leader} 与 ${canonicalLeader} 为同一人，正文统一写“${canonicalLeader}”，不得写“${group.leader}”。`
        : null,
      ...(members ?? []).map((m: any) => {
        const name = canonicalName(m.member_name);
        return name ? `- ${name}：正文只写姓名“${name}”，不要在姓名前后追加“组长、专家、成员、负责人、审核”等职位或动作标签。` : null;
      }),
    ].filter(Boolean).join("\n") || "（暂无人员称呼规则）";

    const memberStr = (members ?? []).map((m: any) =>
      `- ${canonicalName(m.member_name) || m.member_name}${m.organization ? "（" + m.organization + "）" : ""}`
    ).join("\n") || "（暂无成员信息）";

    const taskStr = (tasks ?? []).map((t: any) =>
      `- ${t.title}：${t.start_date} → ${t.end_date}${t.assignee ? "，负责人 " + canonicalName(t.assignee) : ""}`
    ).join("\n") || "（暂无任务安排）";

    const indicatorStr = (indicators ?? []).slice(0, 30).map((i: any) =>
      `- ${i.code ?? ""} ${i.name}（权重 ${i.weight ?? 0}）`
    ).join("\n") || "（暂未关联评估指标体系）";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const aiModel = resolveAIModel("evaluation_plan");
    const dimensionNames = (indicators ?? [])
      .map((item: any) => String(item?.name ?? "").trim())
      .filter(Boolean)
      .slice(0, 12);
    const knowledge = await buildReportKnowledgeContext(
      sb,
      project,
      [
        group?.name,
        group?.leader,
        system?.name,
        ...(indicators ?? []).slice(0, 10).map((item: any) => item?.name).filter(Boolean),
      ].join(" "),
      dimensionNames,
    );
    const userPrompt = `请为以下项目生成一份正式的「事前绩效评估实施方案」（Markdown 格式，不少于 800 字），结构包括：

# 一、评估目的与依据
# 二、评估对象基本情况
# 三、评估范围与重点
# 四、评估指标体系
# 五、评估组织与人员分工
# 六、时间安排与进度计划（请对接已有任务计划）
# 七、评估方法与工作步骤
# 八、预期成果与报告形式
# 九、风险防控与质量保障

— 项目信息 —
名称：${project.name}
申请单位：${project.unit ?? "—"}
预算金额：${project.budget?.toLocaleString?.() ?? project.budget ?? "—"} 元
项目类别：${project.category ?? "—"}
项目说明：${project.description ?? "—"}

— 工作组 —
组名：${group?.name ?? "（未组建）"}
人员姓名：
${memberStr}

— 人员称呼统一规则 —
${nameRules}

— 时间任务 —
${taskStr}

— 评估指标体系（${system?.name ?? "未关联"}）—
${indicatorStr}

${knowledge.text ? `— 资料与历史参考 —
${knowledge.text}

` : ""}要求：
1. 直接从正文标题开始输出，不要写“好的”“以下是”“我将为您撰写”等寒暄、解释或引导语
2. 第六章必须基于上方「时间任务」生成一个清晰的阶段甘特表（Markdown 表格）
3. 第五章中"人员分工"要把上面的成员合理分配到资料审核 / 现场调研 / 会议组织 / 报告撰写四类工作
4. 必须优先吸收“资料与历史参考”中的项目资料全景清单、重点资料片段和指标证据包；如果资料已覆盖项目背景、预算、实施方案、流程、风险控制或绩效目标，不得再写“资料不足/未提供”之类相反表述
5. 整体语气正式、专业，符合政府公文规范
6. 各章节内容必须来自已提供的项目、人员、时间计划和指标体系，不得臆造未提供的具体单位信息
7. 人员称呼必须严格遵守上方「人员称呼统一规则」：同一个人全文只使用同一个姓名；不得混用“王组长 / 王建国”“张专家 / 张明”等身份简称和姓名；不得在人员分工括号中写“成员：”“组长：”“负责人：”“审核：”等职位标签；正确写法示例为“资料审核组（王建国）：……”，不要写“资料审核组（成员：王建国）：……”；表达责任时写“王建国负责……”，不要写“王组长负责……”或“王建国审核”。`;

    const resp = await callAI("evaluation_plan", {
      messages: [
        { role: "system", content: "你是政府事前绩效评估专家，擅长撰写规范的评估实施方案。只输出正式方案正文，不输出任何寒暄、说明、确认语或引导语。全文人员称呼只允许使用姓名，不得使用“某组长、某专家、某老师、成员、负责人、审核”等职位化称呼标记人员。" },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "AI 额度不足，请充值后再试" }), {
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

    return new Response(resp.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-AI-Model": aiModel,
        "X-Rag-Overview": String((knowledge.stats as any).materialOverviewFiles ?? 0),
        "X-Rag-Priority-Chunks": String((knowledge.stats as any).priorityMaterialChunks ?? 0),
        "X-Rag-Knowledge": String((knowledge.stats as any).knowledgeSnippets ?? 0),
        "X-Rag-Materials": String(knowledge.stats.materialSnippets),
        "X-Rag-History": String(knowledge.stats.historicalReports),
        "X-Rag-Goals": String(knowledge.stats.goalTargets),
      },
    });
  } catch (e) {
    console.error("generate-evaluation-plan error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

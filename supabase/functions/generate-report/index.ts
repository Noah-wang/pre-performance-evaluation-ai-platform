// Edge function: stream AI-generated pre-performance evaluation report
// Auto-injects expert score averages and deduction reasons from DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAI } from "../_shared/ai.ts";
import { buildReportEvidenceMatrix, buildReportKnowledgeContext } from "../_shared/rag.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ReqBody {
  project: {
    id?: string;
    name: string;
    unit: string;
    budget: number;
    category: string | null;
    description: string | null;
  };
  extra?: string;
}

const DEFAULT_EVALUATION_DIMENSIONS = ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"];

const sectionLabels = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const buildEvaluationContentToc = (dimensions: string[]) =>
  dimensions.map((name, index) => `（${sectionLabels[index] ?? String(index + 1)}）${name}`).join("\n")
  + `\n（${sectionLabels[dimensions.length] ?? String(dimensions.length + 1)}）总体结论`;

const buildSystemPrompt = (dimensions: string[]) => `你是一名资深的北京市通州区财政支出项目事前绩效评估专家。
请参照“北京市通州区财政支出项目事前绩效评估报告”正式成果格式撰写报告。

必须严格按照以下目录、名称、编号和顺序输出，不得改名、合并、删减、增加或调换章节：

一、评估对象
项目名称：
项目单位：
主管部门：
项目属性：
（一）项目绩效目标
1.总体目标
2.具体绩效指标
（1）产出数量指标
（2）产出质量指标
（3）产出进度指标
（4）产出成本指标
（5）经济效益
（6）社会效益指标
（7）环境效益指标
（8）可持续影响指标
（9）服务对象满意度指标
（二）项目资金总额
（三）项目概况
1.项目背景
2.项目主要内容

二、评估方式和方法
先用一段文字说明受托背景、评估工作组、评估阶段和五维论证。
（一）评估程序
（二）评估思路及方法
（三）评估方式
1.项目基本情况现场调研
2.查阅资料
3.咨询专家
4.召开专家预评估会
5.召开正式专家会

三、评估内容与结论
${buildEvaluationContentToc(dimensions)}

四、相关建议

五、其他需要说明的问题
（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估，并结合现场调研情况，在专家组意见的基础上综合形成的。
（二）本报告仅为财政预算部门审核预算提供参考依据，不作其他用途。

六、附件
1.事前绩效评估项目预期绩效报告
2.绩效目标申报表
3.事前绩效评估专家评估意见书
4.专家组及工作组情况表

严格写作规则：
1. 只使用“一、”“（一）”“1.”“（1）”四级中文编号，不使用 Markdown、项目符号或英文标题。
2. 第一章必须完整保留全部九类具体绩效指标。没有资料时写“根据现有资料无法确认”，并说明需补充的资料，不能删去该项。
3. 第二章不得虚构受托单位、评估机构、调研日期、会议日期和专家姓名。没有事实数据时写明尚未提供相关记录。
4. 第三章必须且只能按当前项目已关联的评估指标体系展开，不得使用默认的“项目必要性、项目可行性、项目经济性、项目效率性、项目效益性”替代。当前应使用的指标为：${dimensions.join("、")}。每一指标均按“事实依据、发现的问题、分析判断、综上结论”展开。每一指标末尾必须有以“综上”开头的判断。
5. 如提供专家评分摘要，第三章总体结论项必须列示专家总平均分，并按当前评估指标体系逐项列示满分与平均得分；不得把评分另设为独立章节。
6. 第四章建议必须逐项对应第三章的问题，具体说明应补充的文件、应完善的制度、应调整的预算或指标。
7. 第五章两段固定说明必须原样保留。
8. 第六章四项附件名称必须原样保留。
9. 不得虚构政策文件、预算明细、指标值或评估事实。事实不足不等于替项目作正面判断，应客观披露证据缺口。
10. 第三章写作前必须优先核对“第三章逐项证据核验”。如果证据片段中已经出现预算明细、预算测算、历史合同、结算清单、收费标准、标箱折算、绩效目标、抽检/检查机制、实施方案、作业流程、应急预案、供应商资质或遴选方式，不得再写“未提供”“缺少”“无法确认”同类相反结论。
11. 对任何“缺少、未提供、无法确认、不明确”的判断，必须先说明已检索到哪些资料、这些资料为什么仍不能证明该点；不得简单否定资料存在。
12. 必须先整体阅读“项目资料全景清单”和“重点资料优先阅读片段”，再写第三章。第三章每个指标的“事实依据”至少引用 2 类资料线索；如果证据包没有命中，才能写“现有索引未检出”，不能扩大为“项目单位未提供”。
13. 对资料已经证明的内容，应写“已提供/资料显示/根据……可见”；对仍缺少的内容，应写“但仍需补充……”，不得把已有资料完全忽略。
14. 使用第三人称、客观中立、正式严谨的财政绩效评估语言，总字数原则上为 3500-6000 字。`;

const encoder = new TextEncoder();

const sseData = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readAIText = async (response: Response) => {
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content
    ?? json.output_text
    ?? json.text
    ?? "";
  return String(content ?? "").trim();
};

const callReportSection = async (
  system: string,
  user: string,
  maxTokens: number,
  retries = 2,
) => {
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await callAI("report", {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        max_tokens: maxTokens,
        temperature: 0.15,
      });
      if (!response.ok) {
        lastError = `${response.status} ${await response.text()}`;
      } else {
        const text = await readAIText(response);
        if (text) return text;
        lastError = "AI 返回空内容";
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) await sleep(700 * (attempt + 1));
  }
  throw new Error(lastError || "AI 分章生成失败");
};

const sanitizeSection = (text: string) =>
  text
    .replace(/^\s*(好的|以下是|下面是|我将|已根据)[\s\S]{0,80}?(?=一、|二、|三、|四、|五、|六、)/, "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ""))
    .trim();

const fallbackThirdChapter = (dimensions: string[], scoreSummary: string) => {
  const lines = [
    "三、评估内容与结论",
    ...dimensions.flatMap((dimension, index) => [
      `（${sectionLabels[index] ?? String(index + 1)}）${dimension}`,
      "1.事实依据：现有索引未检出足以支撑该指标完整判断的直接证据，需进一步核对项目申报书、绩效目标表、预算测算资料、实施方案及专家意见等材料。",
      "2.发现的问题：当前证据链仍需补充能够证明指标目标值、测算依据、实施条件或效益实现路径的资料。",
      "3.分析判断：在资料证据尚未完整闭合前，该指标不宜作出完全支持判断，应以补充核验后的资料为准。",
      "4.综上，建议补充该指标对应的证明材料后再形成最终评估结论。",
    ]),
    `（${sectionLabels[dimensions.length] ?? String(dimensions.length + 1)}）总体结论`,
    scoreSummary || "根据现有资料和专家评分情况，需在补齐资料证据后形成最终结论。",
  ];
  return lines.join("\n");
};

const buildSharedWritingContext = (
  project: ReqBody["project"],
  indicatorText: string,
  knowledgeText: string,
  evidenceMatrixText: string,
  scoreSummary: string,
  extra = "",
) => `项目信息：
项目名称：${project.name}
申请单位：${project.unit}
预算金额：人民币 ${project.budget.toLocaleString()} 元
项目类别：${project.category ?? "未分类"}
项目说明：${project.description ?? "（暂无）"}

${indicatorText}

${evidenceMatrixText ? `${evidenceMatrixText}\n\n` : ""}${knowledgeText ? `${knowledgeText}\n\n` : ""}${scoreSummary ? `${scoreSummary}\n\n` : ""}${extra ? `补充材料与专家意见：\n${extra}\n\n` : ""}`;

const buildSectionPrompts = (
  project: ReqBody["project"],
  dimensions: string[],
  indicatorText: string,
  knowledgeText: string,
  evidenceMatrixText: string,
  scoreSummary: string,
  extra = "",
) => {
  const shared = buildSharedWritingContext(project, indicatorText, knowledgeText, evidenceMatrixText, scoreSummary, extra);
  const commonRules = `共同规则：
1. 只输出指定章节正文，不输出封面、目录、寒暄或解释。
2. 不使用 Markdown，不使用项目符号，不使用英文标题。
3. 不得虚构资料中没有出现的事实、金额、日期、政策名称、专家意见。
4. 对证据不足处，只能写“现有索引未检出/根据现有资料无法确认”，并说明需补充什么，不得自行编造。`;

  return [
    {
      name: "一至二章",
      maxTokens: 3600,
      prompt: `${shared}${commonRules}

请只生成以下章节：
一、评估对象
二、评估方式和方法

要求：第一章完整保留项目绩效目标九类指标、资金总额、项目概况；第二章保留评估程序、评估思路及方法、评估方式五项。`,
    },
    {
      name: "第三章",
      maxTokens: 6200,
      prompt: `${shared}${commonRules}

请只生成以下章节：
三、评估内容与结论
${buildEvaluationContentToc(dimensions)}

强制要求：
1. 第三章必须按当前项目实际指标展开：${dimensions.join("、")}。
2. 不得使用默认“项目必要性、项目可行性、项目经济性、项目效率性、项目效益性”，除非它们本来就是当前项目指标。
3. 每个指标必须按“1.事实依据 2.发现的问题 3.分析判断 4.综上结论”写。
4. 必须优先使用【当前项目证据矩阵】中的当前项目资料；如果证据矩阵列出了已上传文件，不能忽略。
5. 没有证据的点只能说“现有索引未检出”，不能写成“会议认为/专家指出/项目单位未提供”。
6. 如果引用专家或会议观点，必须来自补充材料或证据矩阵明确文本；不能把通用建议写成会议结论。`,
    },
    {
      name: "四至六章",
      maxTokens: 2600,
      prompt: `${shared}${commonRules}

请只生成以下章节：
四、相关建议
五、其他需要说明的问题
六、附件

要求：第四章建议必须对应第三章的资料缺口和问题；第五章两段固定说明必须原样保留；第六章只保留四项附件清单。`,
    },
  ];
};

const refreshProjectKnowledgeIndex = async (supabase: any, projectId?: string) => {
  if (!projectId) return { indexed: 0, skipped: 0, failed: 0 };
  try {
    const { data, error } = await supabase.functions.invoke("ingest-project-knowledge", {
      body: { projectId, limit: 160, force: false },
    });
    if (error) throw error;
    return {
      indexed: Number(data?.indexed ?? 0),
      skipped: Number(data?.skipped ?? 0),
      failed: Number(data?.failed ?? 0),
    };
  } catch (error) {
    console.warn("refresh project knowledge index failed", error);
    return { indexed: 0, skipped: 0, failed: 0 };
  }
};

async function buildIndicatorSummary(projectId: string): Promise<{ dimensions: string[]; text: string }> {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);
    const { data: project } = await sb
      .from("projects")
      .select("evaluation_system_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project?.evaluation_system_id) {
      return {
        dimensions: DEFAULT_EVALUATION_DIMENSIONS,
        text: "当前项目未关联评估指标体系，报告暂按系统默认维度生成。",
      };
    }
    const { data: indicators } = await sb
      .from("evaluation_indicators")
      .select("code,name,weight,level,sort_order")
      .eq("system_id", project.evaluation_system_id)
      .order("sort_order", { ascending: true });
    const rows = (indicators ?? []).filter((item: any) => Number(item.level ?? 1) === 1 || item.level === null);
    const dimensions = rows.map((item: any) => String(item.name ?? "").trim()).filter(Boolean);
    if (!dimensions.length) {
      return {
        dimensions: DEFAULT_EVALUATION_DIMENSIONS,
        text: "当前项目已关联评估指标体系，但未读取到一级指标，报告暂按系统默认维度生成。",
      };
    }
    return {
      dimensions,
      text: `当前项目已关联评估指标体系，第三章必须按以下一级指标展开，不得替换为默认五项：\n${rows.map((item: any, index: number) =>
        `${index + 1}. ${item.code ? `[${item.code}] ` : ""}${item.name}${item.weight !== null && item.weight !== undefined ? `（权重 ${item.weight}）` : ""}`
      ).join("\n")}`,
    };
  } catch (e) {
    console.error("buildIndicatorSummary error:", e);
    return {
      dimensions: DEFAULT_EVALUATION_DIMENSIONS,
      text: "读取评估指标体系失败，报告暂按系统默认维度生成。",
    };
  }
}

async function buildScoreSummary(projectId: string): Promise<string> {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(url, key);
    const { data: scores } = await sb
      .from("expert_scores")
      .select("score, max_score, deduct_reason, expert_name, indicator_id")
      .eq("project_id", projectId);
    if (!scores || !scores.length) return "";

    // 按指标聚合
    const indIds = Array.from(new Set(scores.map((r: any) => r.indicator_id)));
    const { data: inds } = await sb
      .from("evaluation_indicators")
      .select("id,name,code")
      .in("id", indIds);
    const indMap: Record<string, { name: string; code: string | null }> = {};
    (inds ?? []).forEach((i: any) => { indMap[i.id] = { name: i.name, code: i.code }; });

    // 按专家分组
    const byExpert: Record<string, { sum: number; max: number }> = {};
    const reasons: { ind: string; reason: string }[] = [];
    scores.forEach((r: any) => {
      const e = r.expert_name ?? "匿名";
      byExpert[e] ??= { sum: 0, max: 0 };
      byExpert[e].sum += Number(r.score) || 0;
      byExpert[e].max += Number(r.max_score) || 0;
      if (r.deduct_reason && Number(r.score) < Number(r.max_score)) {
        reasons.push({
          ind: indMap[r.indicator_id]?.name ?? "—",
          reason: r.deduct_reason,
        });
      }
    });
    const expertRows = Object.entries(byExpert).map(([e, v]) =>
      `  · ${e}：${v.sum.toFixed(1)} / ${v.max.toFixed(1)} 分`
    );
    const avg = Object.values(byExpert).reduce((a, b) => a + b.sum, 0) / Object.values(byExpert).length;
    const maxAvg = Object.values(byExpert).reduce((a, b) => a + b.max, 0) / Object.values(byExpert).length;

    let out = `专家评分摘要（共 ${Object.keys(byExpert).length} 位专家参与打分）：\n`;
    out += `  专家平均得分：${avg.toFixed(2)} / ${maxAvg.toFixed(2)} 分\n`;
    out += `  各专家得分：\n${expertRows.join("\n")}\n`;
    if (reasons.length) {
      out += `  主要扣分理由（前 8 条）：\n`;
      out += reasons.slice(0, 8).map((r, i) => `   ${i + 1}. [${r.ind}] ${r.reason}`).join("\n");
    }
    return out;
  } catch (e) {
    console.error("buildScoreSummary error:", e);
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project, extra }: ReqBody = await req.json();
    if (!project?.name) {
      return new Response(JSON.stringify({ error: "缺少项目信息" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const indicatorSummary = project.id
      ? await buildIndicatorSummary(project.id)
      : { dimensions: DEFAULT_EVALUATION_DIMENSIONS, text: "未提供项目 ID，报告暂按系统默认维度生成。" };
    const scoreSummary = project.id ? await buildScoreSummary(project.id) : "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const indexStats = await refreshProjectKnowledgeIndex(supabase, project.id);
    const knowledge = project.id
      ? await buildReportKnowledgeContext(supabase, project, extra ?? "", indicatorSummary.dimensions)
      : { text: "", stats: { materialSnippets: 0, knowledgeSnippets: 0, reportEvidenceSnippets: 0, historicalReports: 0, goalTargets: 0 } };
    const evidenceMatrix = project.id
      ? await buildReportEvidenceMatrix(supabase, project, extra ?? "", indicatorSummary.dimensions)
      : { text: "", stats: { materialOverviewFiles: 0, priorityMaterialChunks: 0, reportEvidenceSnippets: 0 } };

    const system = buildSystemPrompt(indicatorSummary.dimensions);
    const sectionPrompts = buildSectionPrompts(
      project,
      indicatorSummary.dimensions,
      indicatorSummary.text,
      knowledge.text,
      evidenceMatrix.text,
      scoreSummary,
      extra ?? "",
    );

    const stream = new ReadableStream({
      async start(controller) {
        for (const section of sectionPrompts) {
          try {
            const text = sanitizeSection(await callReportSection(system, section.prompt, section.maxTokens));
            controller.enqueue(encoder.encode(sseData(`${text.trim()}\n\n`)));
          } catch (error) {
            console.error(`generate-report section failed: ${section.name}`, error);
            const fallback = section.name === "第三章"
              ? fallbackThirdChapter(indicatorSummary.dimensions, scoreSummary)
              : section.name === "四至六章"
                ? "四、相关建议\n1.建议围绕资料证据缺口、预算测算依据、实施方案细化和绩效指标可衡量性进行补充完善。\n\n五、其他需要说明的问题\n（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估，并结合现场调研情况，在专家组意见的基础上综合形成的。\n（二）本报告仅为财政预算部门审核预算提供参考依据，不作其他用途。\n\n六、附件\n1.事前绩效评估项目预期绩效报告\n2.绩效目标申报表\n3.事前绩效评估专家评估意见书\n4.专家组及工作组情况表"
                : "一、评估对象\n根据现有资料无法确认完整项目事实，需补充项目申报书、绩效目标表、预算测算资料和实施方案。\n\n二、评估方式和方法\n根据现有资料无法确认完整评估程序，需补充现场调研、资料查阅、专家咨询和会议记录。";
            controller.enqueue(encoder.encode(sseData(`${fallback}\n\n`)));
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Score-Injected": scoreSummary ? "1" : "0",
        "X-Rag-Materials": String(knowledge.stats.materialSnippets),
        "X-Rag-Knowledge": String((knowledge.stats as any).knowledgeSnippets ?? 0),
        "X-Rag-Overview": String((evidenceMatrix.stats as any).materialOverviewFiles ?? (knowledge.stats as any).materialOverviewFiles ?? 0),
        "X-Rag-Priority-Chunks": String((evidenceMatrix.stats as any).priorityMaterialChunks ?? (knowledge.stats as any).priorityMaterialChunks ?? 0),
        "X-Rag-Report-Evidence": String((evidenceMatrix.stats as any).reportEvidenceSnippets ?? (knowledge.stats as any).reportEvidenceSnippets ?? 0),
        "X-Rag-History": String(knowledge.stats.historicalReports),
        "X-Rag-Goals": String(knowledge.stats.goalTargets),
        "X-Rag-Indexed": String(indexStats.indexed),
        "X-Rag-Index-Failed": String(indexStats.failed),
      },
    });
  } catch (e) {
    console.error("generate-report error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

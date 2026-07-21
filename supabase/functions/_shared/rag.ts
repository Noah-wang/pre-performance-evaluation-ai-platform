import { createTextEmbeddingAsync, vectorLiteral } from "./embedding.ts";

const STOPWORDS = new Set([
  "项目", "建设", "工作", "实施", "有关", "相关", "情况", "说明", "单位", "预算", "绩效", "评估",
  "意见", "报告", "方案", "目标", "内容", "材料", "管理", "资金", "工作组", "事前",
]);

const tokenize = (text: string) =>
  Array.from(new Set(
    (text ?? "")
      .toLowerCase()
      .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g)
      ?.filter((token) => !STOPWORDS.has(token)) ?? [],
  ));

const overlapScore = (queryTokens: string[], text: string) => {
  if (!queryTokens.length || !text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += token.length >= 4 ? 3 : 2;
  }
  return score;
};

const preview = (text: string, max = 260) => {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

export const normalizeEvidenceText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[，。；：、“”‘’（）()《》【】,.!?！？;:"'[\]{}]/g, "")
    .toLowerCase();

export const isEvidenceSupported = (quote: unknown, corpus: string, minLength = 8) => {
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length < minLength) return false;
  const normalizedCorpus = normalizeEvidenceText(corpus);
  if (normalizedCorpus.includes(normalizedQuote)) return true;

  const tokens = normalizedQuote.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) ?? [];
  if (tokens.length < 3) return false;
  const hits = tokens.filter((token) => normalizedCorpus.includes(token)).length;
  return hits / tokens.length >= 0.75;
};

export interface ProjectInput {
  id?: string;
  name?: string | null;
  unit?: string | null;
  category?: string | null;
  description?: string | null;
}

const emptyStats = () => ({
  materialSnippets: 0,
  knowledgeSnippets: 0,
  materialOverviewFiles: 0,
  priorityMaterialChunks: 0,
  reportEvidenceSnippets: 0,
  historicalReports: 0,
  goalTargets: 0,
});

const normalizeProject = (project: ProjectInput | null | undefined) => ({
  id: project?.id,
  name: project?.name ?? "",
  unit: project?.unit ?? "",
  category: project?.category ?? null,
  description: project?.description ?? null,
});

const resolveProject = async (supabase: any, project: ProjectInput) => {
  const normalized = normalizeProject(project);

  if (normalized.id && normalized.name && normalized.unit) return normalized;

  if (normalized.id) {
    const { data } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .eq("id", normalized.id)
      .maybeSingle();
    if (data) return normalizeProject({ ...normalized, ...data });
  }

  if (normalized.name) {
    const { data: exactRows } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .eq("name", normalized.name)
      .limit(1);
    const exact = exactRows?.[0];
    if (exact) return normalizeProject({ ...normalized, ...exact });

    const { data: fuzzyRows } = await supabase
      .from("projects")
      .select("id,name,unit,category,description")
      .ilike("name", `%${normalized.name}%`)
      .limit(1);
    const fuzzy = fuzzyRows?.[0];
    if (fuzzy) return normalizeProject({ ...normalized, ...fuzzy });
  }

  return normalized;
};

const evidenceQueryForDimension = (dimension: string, project: ReturnType<typeof normalizeProject>, extra = "") => {
  const name = dimension.trim();
  const terms = [name, project.name, project.unit, project.category, extra].filter(Boolean) as string[];
  const push = (...items: string[]) => terms.push(...items);

  if (/经济|成本|预算|资金|收费|投入|支出|金额/.test(name)) {
    push(
      "分项预算明细", "预算测算", "预算明细", "资金测算", "项目收费", "收费标准",
      "历史合同", "合同金额", "结算清单", "结算明细", "单价", "标箱", "非标箱",
      "折算", "市场询价", "同类项目", "政策限额", "55", "65", "58",
    );
  }

  if (/目标|绩效|效益|产出|合理|质量|数量|满意|可持续/.test(name)) {
    push(
      "绩效目标申报表", "绩效目标", "指标值", "衡量口径", "支撑资料",
      "档案完好率", "抽检", "抽样", "合格率", "监测手段", "季度检查",
      "现场检查", "服务对象满意度", "可持续影响",
    );
  }

  if (/可行|实施|效率|进度|组织|方案|管理|流程/.test(name)) {
    push(
      "实施方案", "工作方案", "作业流程", "四阶段", "进度安排", "人员分工",
      "应急预案", "三层级", "风险控制", "供应商资质", "遴选方式", "单一来源",
      "ISO9001", "国家秘密载体", "保密资质", "服务承诺",
    );
  }

  if (/必要|立项|政策|依据|背景/.test(name)) {
    push(
      "政策依据", "立项依据", "申请报告", "项目背景", "现实需求", "必要性",
      "主管部门", "行业规划", "财政支出", "公共服务", "存量问题",
    );
  }

  return Array.from(new Set(terms)).join(" ");
};

const matchedTermsFor = (queryTokens: string[], content: string) => {
  const lower = content.toLowerCase();
  return queryTokens.filter((token) => lower.includes(token)).slice(0, 8);
};

const mergeEvidenceRows = (rows: any[], queryTokens: string[], limit: number) => {
  const merged = new Map<string, any>();

  for (const row of rows) {
    if (!row?.content) continue;
    const key = row.chunk_id ?? `${row.file_id ?? row.file_name}-${row.chunk_index ?? row.content.slice(0, 24)}`;
    const searchable = [row.title, row.file_name, row.category, row.content].filter(Boolean).join(" ");
    const lexicalScore = overlapScore(queryTokens, searchable);
    const vectorScore = Number(row.similarity ?? 0) * 10;
    const keywordScore = Number(row.keyword_score ?? 0);
    const score = lexicalScore + vectorScore + keywordScore;
    const previous = merged.get(key);
    if (!previous || score > previous.score) {
      merged.set(key, {
        ...row,
        score,
        matchedTerms: matchedTermsFor(queryTokens, searchable),
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

const collectEvidenceForQuery = async (supabase: any, projectId: string, queryText: string, limit = 4) => {
  const queryTokens = tokenize(queryText);
  const rows: any[] = [];

  try {
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: vectorLiteral(await createTextEmbeddingAsync(queryText)),
      match_count: Math.max(limit * 2, 8),
      match_project_id: projectId,
    });
    if (error) throw error;
    rows.push(...(data ?? []));
  } catch (error) {
    console.warn("report vector evidence search failed", error);
  }

  if (queryTokens.length) {
    try {
      const { data, error } = await supabase.rpc("keyword_knowledge_chunks", {
        query_terms: queryTokens.slice(0, 24),
        match_count: Math.max(limit * 3, 12),
        match_project_id: projectId,
      });
      if (error) throw error;
      rows.push(...(data ?? []));
    } catch (error) {
      console.warn("report keyword evidence search fallback", error);
    }
  }

  try {
    const { data: materials, error } = await supabase
      .from("materials")
      .select("id,name,category,status,file_name,review_note,updated_at")
      .eq("project_id", projectId)
      .not("file_path", "is", null)
      .limit(80);
    if (error) throw error;
    const materialRows = (materials ?? [])
      .map((material: any) => {
        const searchable = [material.name, material.category, material.file_name, material.review_note].filter(Boolean).join(" ");
        const score = overlapScore(queryTokens, searchable) + (material.status === "approved" ? 4 : material.status === "received" ? 2 : 0);
        if (score <= 0) return null;
        return {
          chunk_id: `material-${material.id}`,
          file_id: material.id,
          title: material.name || material.file_name,
          file_name: material.file_name,
          category: material.category ?? "项目资料",
          chunk_index: null,
          content: `项目已上传资料：${material.name || material.file_name}${material.file_name ? `；文件名：${material.file_name}` : ""}${material.review_note ? `；审核说明：${material.review_note}` : ""}。`,
          keyword_score: score,
        };
      })
      .filter(Boolean);
    rows.push(...materialRows);
  } catch (error) {
    console.warn("report material evidence fallback failed", error);
  }

  return mergeEvidenceRows(rows, queryTokens, limit);
};

const priorityMaterialRank = (item: any) => {
  const text = [item.title, item.file_name, item.category, item.summary].filter(Boolean).join(" ");
  let score = 0;
  if (/申报书|申请|立项|背景|依据/.test(text)) score += 12;
  if (/绩效目标|目标表|指标|绩效/.test(text)) score += 11;
  if (/预算|测算|明细|收费|金额|合同|结算|报价|询价/.test(text)) score += 10;
  if (/实施方案|工作方案|流程|进度|人员|风险|应急/.test(text)) score += 9;
  if (/专家|会议|意见|打分|评分/.test(text)) score += 8;
  score += Math.min(8, Number(item.chunk_count ?? 0));
  return score;
};

const buildProjectMaterialPanorama = async (supabase: any, projectId: string) => {
  const { data: files, error } = await supabase
    .from("knowledge_files")
    .select("id,title,file_name,category,summary,chunk_count,indexed_at,updated_at")
    .eq("project_id", projectId)
    .eq("status", "indexed")
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error || !files?.length) {
    if (error) console.warn("project material panorama failed", error);
    return { text: "", fileCount: 0, chunkCount: 0 };
  }

  const sortedFiles = [...files].sort((a: any, b: any) => priorityMaterialRank(b) - priorityMaterialRank(a));
  const overview = sortedFiles.map((file: any, index: number) => {
    const title = file.title || file.file_name || "未命名资料";
    const category = file.category ?? "项目资料";
    const chunks = Number(file.chunk_count ?? 0);
    const summary = preview(file.summary || "", 360);
    return `${index + 1}. 《${title}》[${category}｜${chunks}个片段]${summary ? `：${summary}` : ""}`;
  });

  const priorityIds = sortedFiles.slice(0, 10).map((file: any) => file.id);
  let chunkLines: string[] = [];
  if (priorityIds.length) {
    const { data: chunks, error: chunkError } = await supabase
      .from("knowledge_chunks")
      .select("file_id,chunk_index,content")
      .in("file_id", priorityIds)
      .order("chunk_index", { ascending: true });
    if (chunkError) {
      console.warn("priority material chunks failed", chunkError);
    } else {
      const fileMap = new Map(sortedFiles.map((file: any) => [file.id, file]));
      const perFile = new Map<string, number>();
      chunkLines = (chunks ?? [])
        .filter((chunk: any) => {
          const used = perFile.get(chunk.file_id) ?? 0;
          if (used >= 3) return false;
          perFile.set(chunk.file_id, used + 1);
          return true;
        })
        .slice(0, 24)
        .map((chunk: any, index: number) => {
          const file = fileMap.get(chunk.file_id) ?? {};
          const title = file.title || file.file_name || "未命名资料";
          return `${index + 1}. 《${title}》片段${Number(chunk.chunk_index ?? 0) + 1}：${preview(chunk.content, 620)}`;
        });
    }
  }

  return {
    fileCount: files.length,
    chunkCount: chunkLines.length,
    text: [
      "【项目资料全景清单】",
      "以下为当前项目已完成索引的资料总览，写报告和方案时必须先整体理解这些资料，再按指标引用证据；不得只根据单个片段下结论。",
      overview.join("\n"),
      chunkLines.length
        ? "【重点资料优先阅读片段】\n" + chunkLines.join("\n")
        : "",
    ].filter(Boolean).join("\n"),
  };
};

const buildReportEvidenceContext = async (
  supabase: any,
  project: ReturnType<typeof normalizeProject>,
  dimensions: string[],
  extra = "",
) => {
  if (!project.id || !dimensions.length) return { text: "", count: 0 };

  const sections: string[] = [];
  let count = 0;

  for (const [index, dimension] of dimensions.entries()) {
    const queryText = evidenceQueryForDimension(dimension, project, extra);
    const evidenceRows = await collectEvidenceForQuery(supabase, project.id, queryText, 10);
    if (!evidenceRows.length) {
      sections.push(`${index + 1}. ${dimension}：暂未在文件库索引中命中可直接引用的正文片段。写作时只能披露“现有索引未检出”，不得扩大为“项目未提供”。`);
      continue;
    }

    count += evidenceRows.length;
    sections.push(
      `${index + 1}. ${dimension}：\n`
      + evidenceRows.map((item: any, evidenceIndex: number) => {
        const title = item.title || item.file_name || "未命名资料";
        const category = item.category ?? "项目资料";
        const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "正文片段";
        const terms = item.matchedTerms?.length ? `；命中：${item.matchedTerms.join("、")}` : "";
        return `  ${evidenceIndex + 1}. 《${title}》[${category}｜${location}${terms}]：${preview(item.content, 680)}`;
      }).join("\n"),
    );
  }

  return {
    count,
    text: sections.length
      ? "【第三章逐项证据核验】\n"
        + "以下内容为写作第三章前必须优先核对的项目资料证据。只允许把这里列出的当前项目资料和补充材料作为当前项目事实依据；历史同类报告、目标库和通用知识只能作为写法参考，不得写成当前项目已经发生的事实。若证据已覆盖预算明细、历史合同、结算清单、实施方案、供应商资质、监测频率、抽检标准等，不得再写“未提供”“缺少”“无法确认”；只能写“已提供……，但仍需补充……”。\n"
        + sections.join("\n")
      : "",
  };
};

export const buildReportEvidenceMatrix = async (
  supabase: any,
  projectInput: ProjectInput,
  extra = "",
  dimensions: string[] = [],
) => {
  const project = await resolveProject(supabase, projectInput);
  const effectiveDimensions = dimensions.length ? dimensions : [];
  const stats = { ...emptyStats(), resolvedProjectId: project.id ?? null };

  if (!project.id || !effectiveDimensions.length) {
    return {
      project,
      stats,
      corpus: "",
      text: "【当前项目证据矩阵】\n当前项目未关联可用评估指标或未能解析项目，不能形成逐项证据矩阵。",
      rows: [],
    };
  }

  const panorama = await buildProjectMaterialPanorama(supabase, project.id);
  stats.materialOverviewFiles = panorama.fileCount;
  stats.priorityMaterialChunks = panorama.chunkCount;

  const rows = [];
  const corpusParts = [panorama.text, extra].filter(Boolean);

  for (const dimension of effectiveDimensions) {
    const queryText = evidenceQueryForDimension(dimension, project, extra);
    const evidenceRows = await collectEvidenceForQuery(supabase, project.id, queryText, 14);
    const directRows = evidenceRows.filter((row: any) => {
      const content = String(row?.content ?? "");
      const sourceType = String(row?.source_type ?? row?.metadata?.sourceType ?? "");
      const title = String(row?.title ?? row?.file_name ?? "");
      const category = String(row?.category ?? "");
      const isCurrentMaterial = !/历史同类报告|目标库|可复用绩效目标|历史项目/.test(`${title} ${category}`);
      return content.trim().length >= 12 && isCurrentMaterial && sourceType !== "history";
    });
    stats.reportEvidenceSnippets += directRows.length;
    directRows.forEach((row: any) => corpusParts.push(row.content));

    const supportLines = directRows.length
      ? directRows.slice(0, 8).map((item: any, index: number) => {
        const title = item.title || item.file_name || "未命名资料";
        const category = item.category ?? "项目资料";
        const location = Number.isFinite(Number(item.chunk_index)) ? `片段${Number(item.chunk_index) + 1}` : "正文片段";
        const terms = item.matchedTerms?.length ? `；命中词：${item.matchedTerms.join("、")}` : "";
        return `${index + 1}. 《${title}》[${category}｜${location}${terms}]：${preview(item.content, 760)}`;
      }).join("\n")
      : "未命中当前项目资料的直接正文依据。";

    rows.push({
      dimension,
      evidenceCount: directRows.length,
      evidence: directRows,
      text: `【${dimension}】\n已检索到的当前项目证据：${directRows.length} 条\n${supportLines}\n写作约束：有证据的内容必须写“资料显示/已提供/根据……可见”；无直接证据时只能写“现有索引未检出”，不得写成“项目单位未提供”。`,
    });
  }

  const text = [
    "【当前项目证据矩阵】",
    "以下矩阵是报告第三章的唯一当前项目事实依据。第三章必须逐项吸收这些证据，不得使用默认五项指标替代当前指标，不得把会议或资料没有出现的内容写成事实。",
    panorama.text,
    rows.map((row) => row.text).join("\n\n"),
  ].filter(Boolean).join("\n\n");

  return {
    project,
    stats,
    corpus: corpusParts.join("\n"),
    text,
    rows,
  };
};

export const buildProjectKnowledgeContext = async (supabase: any, projectInput: ProjectInput, extra = "") => {
  const project = await resolveProject(supabase, projectInput);
  const queryText = [project.name, project.unit, project.category, project.description, extra].filter(Boolean).join(" ");
  const queryTokens = tokenize(queryText);

  const sections: string[] = [];
  const stats = {
    ...emptyStats(),
    resolvedProjectId: project.id ?? null,
  };

  if (project.id) {
    const panorama = await buildProjectMaterialPanorama(supabase, project.id);
    if (panorama.text) {
      stats.materialOverviewFiles = panorama.fileCount;
      stats.priorityMaterialChunks = panorama.chunkCount;
      sections.push(panorama.text);
    }

    try {
      const { data: knowledgeMatches } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: vectorLiteral(await createTextEmbeddingAsync(queryText)),
        match_count: 10,
        match_project_id: project.id,
      });
      const knowledgeRows = (knowledgeMatches ?? [])
        .filter((item: any) => item?.content)
        .slice(0, 10);
      if (knowledgeRows.length) {
        stats.knowledgeSnippets = knowledgeRows.length;
        sections.push(
          "【文件库检索依据】\n"
          + knowledgeRows.map((item: any, index: number) =>
            `${index + 1}. 《${item.title || item.file_name}》[${item.category ?? "文件库"}]：${preview(item.content, 520)}`
          ).join("\n"),
        );
      }
    } catch (error) {
      console.warn("knowledge vector search failed", error);
    }

    const { data: materials } = await supabase
      .from("materials")
      .select("id,name,category,status,file_path,file_name,review_note")
      .eq("project_id", project.id)
      .not("file_path", "is", null)
      .order("updated_at", { ascending: false });

    const materialCandidates = (materials ?? []).map((material: any) => {
      const searchable = [material.name, material.category, material.review_note, material.file_name].filter(Boolean).join(" ");
      return {
        name: material.name,
        category: material.category,
        status: material.status,
        snippet: preview(material.review_note || material.file_name || material.name, 180),
        score: overlapScore(queryTokens, searchable) + (material.status === "approved" ? 4 : material.status === "received" ? 2 : 0),
      };
    });

    const topMaterials = materialCandidates
      .filter((item) => item.snippet)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (topMaterials.length) {
      stats.materialSnippets = topMaterials.length;
      sections.push(
        "【当前项目资料摘录】\n"
        + topMaterials.map((item, index) =>
          `${index + 1}. 《${item.name}》[${item.category ?? "未分类"}|${item.status}]：${item.snippet}`
        ).join("\n"),
      );
    }
  }

  const { data: archived } = await supabase
    .from("archived_projects")
    .select("report_id,project_snapshot,conclusion,archived_at")
    .order("archived_at", { ascending: false })
    .limit(30);

  const archiveRows = (archived ?? []).filter((row: any) => row.report_id) as any[];
  if (archiveRows.length) {
    const reportIds = archiveRows.map((row: any) => row.report_id).filter(Boolean);
    const { data: reports } = await supabase
      .from("reports")
      .select("id,title,content,conclusion,summary_remark")
      .in("id", reportIds);

    const reportMap = new Map((reports ?? []).map((report: any) => [report.id, report]));
    const historical = archiveRows
      .map((row: any) => {
        const snapshot = row.project_snapshot ?? {};
        const report = reportMap.get(row.report_id);
        if (!report?.content) return null;
        const searchable = [
          snapshot.name,
          snapshot.unit,
          snapshot.category,
          snapshot.description,
          report.title,
          report.content,
          report.summary_remark,
        ].filter(Boolean).join(" ");
        let score = overlapScore(queryTokens, searchable);
        if (project.category && snapshot.category === project.category) score += 8;
        if (snapshot.unit && project.unit === snapshot.unit) score += 6;
        return {
          projectName: snapshot.name ?? "历史项目",
          category: snapshot.category ?? "未分类",
          conclusion: row.conclusion ?? report.conclusion ?? "未注明",
          snippet: preview(report.content, 320),
          score,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3);

    if (historical.length) {
      stats.historicalReports = historical.length;
      sections.push(
        "【历史同类报告参考】\n"
        + historical.map((item: any, index: number) =>
          `${index + 1}. ${item.projectName} [${item.category}|结论:${item.conclusion}]：${item.snippet}`
        ).join("\n"),
      );
    }
  }

  let goalQuery = supabase
    .from("goal_library")
    .select("category,code,name,weight,scoring_method,required_materials,usage_count")
    .order("usage_count", { ascending: false })
    .limit(20);

  if (project.category) goalQuery = goalQuery.eq("category", project.category);
  const { data: goalLibrary } = await goalQuery;
  const goals = (goalLibrary ?? [])
    .map((goal: any) => ({
      ...goal,
      score: overlapScore(queryTokens, [goal.name, goal.scoring_method, goal.required_materials, goal.code].filter(Boolean).join(" "))
        + Number(goal.usage_count || 0),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 6);

  if (goals.length) {
    stats.goalTargets = goals.length;
    sections.push(
      "【可复用绩效目标参考】\n"
      + goals.map((goal: any, index: number) =>
        `${index + 1}. ${goal.code ? `${goal.code} ` : ""}${goal.name}（权重${Number(goal.weight || 0)}，引用${goal.usage_count || 0}次）`
        + `${goal.required_materials ? `；建议资料：${preview(goal.required_materials, 120)}` : ""}`
      ).join("\n"),
    );
  }

  return {
    text: sections.join("\n\n"),
    stats,
    project,
  };
};

export const buildReportKnowledgeContext = async (
  supabase: any,
  projectInput: ProjectInput,
  extra = "",
  dimensions: string[] = [],
) => {
  const base = await buildProjectKnowledgeContext(supabase, projectInput, extra);
  const reportEvidence = await buildReportEvidenceContext(supabase, base.project, dimensions, extra);

  return {
    ...base,
    text: [base.text, reportEvidence.text].filter(Boolean).join("\n\n"),
    stats: {
      ...base.stats,
      reportEvidenceSnippets: reportEvidence.count,
    },
  };
};

export const DEFAULT_REPORT_DIMENSIONS = ["项目必要性", "项目可行性", "项目经济性", "项目效率性", "项目效益性"];
export const CN_SECTION_LABELS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export const REPORT_EVALUATION_TARGET_LINES = [
  "一、评估对象",
  "项目名称：",
  "项目单位：",
  "主管部门：",
  "项目属性：",
  "（一）项目绩效目标",
  "1.总体目标",
  "2.具体绩效指标",
  "（1）产出数量指标",
  "（2）产出质量指标",
  "（3）产出进度指标",
  "（4）产出成本指标",
  "（5）经济效益",
  "（6）社会效益指标",
  "（7）环境效益指标",
  "（8）可持续影响指标",
  "（9）服务对象满意度指标",
  "（二）项目资金总额",
  "（三）项目概况",
  "1.项目背景",
  "2.项目主要内容",
];

export const REPORT_METHOD_LINES = [
  "二、评估方式和方法",
  "（一）评估程序",
  "（二）评估思路及方法",
  "（三）评估方式",
  "1.项目基本情况现场调研",
  "2.查阅资料",
  "3.召开专家预评估会",
];

export const REPORT_NOTES_LINES = [
  "五、其他需要说明的问题",
  "（一）本报告是评估机构根据项目单位所提供的资料进行全面分析与评估，并结合已归档的调研、会议或专家意见资料综合形成的。",
  "（二）本报告仅为财政预算部门审核预算提供参考依据，不作其他用途。",
];

export const REPORT_ATTACHMENT_LINES = [
  "六、附件",
  "1.事前绩效评估项目预期绩效报告",
  "2.绩效目标申报表",
  "3.事前绩效评估专家评估意见书",
  "4.专家组及工作组情况表",
];

const stripNumberedSection = (value: string, headingPattern: RegExp) =>
  String(value ?? "").replace(
    new RegExp(
      `(^|\\n)\\s*\\d+[.．、]\\s*${headingPattern.source}[\\s\\S]*?(?=\\n\\s*(?:\\d+[.．、]\\s*|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）)|$)`,
      "g"
    ),
    "\n"
  );

const collapseDuplicatePreMeetingSections = (value: string) => {
  const source = String(value ?? "");
  const blockPattern = /(^|\n)\s*\d+[.．、]\s*召开专家预评估会([\s\S]*?)(?=\n\s*(?:\d+[.．、]\s*|[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）)|$)/g;
  const blocks: Array<{ full: string; body: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(source)) !== null) {
    blocks.push({
      full: match[0],
      body: String(match[2] ?? "").trim(),
      index: match.index,
    });
  }
  if (blocks.length <= 1) {
    return source.replace(/(^|\n)\s*\d+[.．、]\s*召开专家预评估会/g, "$13.召开专家预评估会");
  }

  const best = blocks.reduce((current, item) => {
    const currentScore = current.body.length + (/会议主题|会议日期|纪要|录音转写|专家|主持人|指出|建议/.test(current.body) ? 500 : 0);
    const itemScore = item.body.length + (/会议主题|会议日期|纪要|录音转写|专家|主持人|指出|建议/.test(item.body) ? 500 : 0);
    return itemScore > currentScore ? item : current;
  }, blocks[0]);
  let replaced = false;
  return source.replace(blockPattern, (full) => {
    if (full === best.full && !replaced) {
      replaced = true;
      return `\n3.召开专家预评估会\n${best.body}`.trimEnd();
    }
    return "\n";
  });
};

const normalizeEvaluationProcedureNumbering = (value: string) => {
  const source = String(value ?? "");
  const start = source.indexOf("（一）评估程序");
  if (start < 0) return source;
  const nextCandidates = ["（二）评估思路及方法", "（三）评估方式", "三、评估内容与结论"]
    .map((heading) => source.indexOf(heading, start + "（一）评估程序".length))
    .filter((index) => index > start)
    .sort((a, b) => a - b);
  const end = nextCandidates[0] ?? source.length;
  const before = source.slice(0, start);
  const section = source.slice(start, end);
  const after = source.slice(end);
  let counter = 0;
  const normalized = section.replace(/(^|\n)(\s*)(?:\d+(?:\.\d+)+|\d+[.．、]?)\s*/g, (_match, prefix, indent) => {
    counter += 1;
    return `${prefix}${indent}${counter}.`;
  });
  return `${before}${normalized}${after}`;
};

export const stripDeprecatedReportMethodSections = (value: string) => {
  let text = String(value ?? "");
  text = stripNumberedSection(text, /(?:咨询专家|专家咨询)/);
  text = stripNumberedSection(text, /(?:召开)?正式专家会/);
  text = text
    .replace(/(^|\n)\s*\d+[.．、]\s*(?:组织|开展)?专家咨询[^。\n]*(?:。)?/g, "\n")
    .replace(/专家咨询及召开专家会议等方式/g, "专家预评估会材料核验等方式")
    .replace(/专家咨询及召开专家会议/g, "专家预评估会材料核验")
    .replace(/专家咨询/g, "专家预评估会材料核验")
    .replace(/专家会议/g, "专家预评估会")
    .replace(/(^|\n)\s*6[.．、]\s*汇总/g, "$14.汇总")
    .replace(/(?:和|及)?正式专家会/g, "")
  text = collapseDuplicatePreMeetingSections(text);
  text = normalizeEvaluationProcedureNumbering(text);
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildEvaluationContentToc = (dimensions = DEFAULT_REPORT_DIMENSIONS) =>
  dimensions.map((name, index) => `（${CN_SECTION_LABELS[index] ?? String(index + 1)}）${name}`).join("\n")
  + `\n（${CN_SECTION_LABELS[dimensions.length] ?? String(dimensions.length + 1)}）总体结论`;

export const buildEvaluationContentSkeleton = (dimensions = DEFAULT_REPORT_DIMENSIONS) =>
  `三、评估内容与结论\n${buildEvaluationContentToc(dimensions)}\n`;

export const buildEvaluationContentPatterns = (dimensions = DEFAULT_REPORT_DIMENSIONS) => [
  /三、评估内容与结论/,
  ...dimensions.map((name) => new RegExp(`（[一二三四五六七八九十]+）\\s*${escapeRegExp(name)}`)),
  /总体结论/,
];

export const buildReportTemplateSections = (dimensions = DEFAULT_REPORT_DIMENSIONS) => [
  {
    id: "evaluation_target",
    label: "一、评估对象",
    patterns: REPORT_EVALUATION_TARGET_LINES
      .filter((line) => !line.endsWith("："))
      .map((line) => new RegExp(escapeRegExp(line))),
    skeleton: `${REPORT_EVALUATION_TARGET_LINES.join("\n")}\n`,
    hint: "必须包含项目基本字段、绩效目标九类指标、资金总额、项目背景和主要内容。",
  },
  {
    id: "method",
    label: "二、评估方式和方法",
    patterns: REPORT_METHOD_LINES.map((line) => new RegExp(escapeRegExp(line))),
    skeleton: `${REPORT_METHOD_LINES.join("\n")}\n`,
    hint: "必须依次说明评估程序、评估思路及方法，以及现场调研、资料查阅和专家预评估会。",
  },
  {
    id: "evaluation_content",
    label: "三、评估内容与结论",
    patterns: buildEvaluationContentPatterns(dimensions),
    skeleton: buildEvaluationContentSkeleton(dimensions),
    hint: "必须按当前项目关联的评估指标体系展开，并形成总体结论。",
  },
  {
    id: "suggestions",
    label: "四、相关建议",
    patterns: [/四、相关建议/],
    skeleton: `四、相关建议
1.针对政策依据和立项决策提出建议。
2.针对实施方案和管理制度提出建议。
3.针对预算测算、成本控制和资金监管提出建议。
4.针对绩效目标和指标体系提出建议。
`,
    hint: "建议必须与第三章发现的问题逐项对应，明确责任、补充资料或整改方向。",
  },
  {
    id: "notes",
    label: "五、其他需要说明的问题",
    patterns: REPORT_NOTES_LINES.map((line) => new RegExp(escapeRegExp(line))),
    skeleton: `${REPORT_NOTES_LINES.join("\n")}\n`,
    hint: "保留报告形成依据和用途限制两项固定说明。",
  },
  {
    id: "attachments",
    label: "六、附件",
    patterns: REPORT_ATTACHMENT_LINES.map((line) => new RegExp(escapeRegExp(line))),
    skeleton: `${REPORT_ATTACHMENT_LINES.join("\n")}\n`,
    hint: "附件清单固定列示四项；没有对应文件时仍保留名称，并在归档前补齐。",
  },
] as const;

export const buildStrictReportInstruction = (
  dimensions = DEFAULT_REPORT_DIMENSIONS,
  options: { includeMethodLead?: boolean; useDimensionPlaceholder?: boolean } = {},
) => {
  const methodLines = options.includeMethodLead
    ? [
        REPORT_METHOD_LINES[0],
        "先用一段文字说明受托背景、评估工作组、评估阶段和围绕当前指标体系开展的多维论证。",
        ...REPORT_METHOD_LINES.slice(1),
      ]
    : REPORT_METHOD_LINES;
  const evaluationContent = options.useDimensionPlaceholder
    ? "三、评估内容与结论\n（一）按当前项目关联的评估指标体系逐项展开\n（二）总体结论"
    : buildEvaluationContentSkeleton(dimensions).trim();

  return [
    REPORT_EVALUATION_TARGET_LINES.join("\n"),
    methodLines.join("\n"),
    evaluationContent,
    "四、相关建议",
    REPORT_NOTES_LINES.join("\n"),
    REPORT_ATTACHMENT_LINES.join("\n"),
  ].join("\n\n");
};

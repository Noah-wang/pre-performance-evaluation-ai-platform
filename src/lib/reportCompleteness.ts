import {
  CN_SECTION_LABELS,
  DEFAULT_REPORT_DIMENSIONS,
  REPORT_ATTACHMENT_LINES,
  REPORT_NOTES_LINES,
} from "../../supabase/functions/_shared/reportTemplate";

export interface ReportCompletenessResult {
  complete: boolean;
  missing: string[];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findHeading = (text: string, heading: string) => {
  const direct = text.indexOf(heading);
  if (direct >= 0) return direct;
  const loose = new RegExp(escapeRegExp(heading).replace(/\s+/g, "\\s*"));
  return loose.exec(text)?.index ?? -1;
};

const getSection = (text: string, heading: string, followingHeadings: string[]) => {
  const start = findHeading(text, heading);
  if (start < 0) return "";
  const afterStart = start + heading.length;
  const end = followingHeadings
    .map((nextHeading) => findHeading(text.slice(afterStart), nextHeading))
    .filter((index) => index >= 0)
    .map((index) => afterStart + index)
    .sort((a, b) => a - b)[0];
  return text.slice(start, end ?? text.length).trim();
};

const countNumberedItems = (text: string) => {
  const arabic = text.match(/^\s*\d+[.．、]\s*\S+/gm)?.length ?? 0;
  const chinese = text.match(/^\s*（[一二三四五六七八九十]+）\s*\S+/gm)?.length ?? 0;
  return arabic + chinese;
};

/**
 * Chapters five and six are fixed document boilerplate rather than AI-authored facts.
 * Normalize only this deterministic tail; chapters one through four remain untouched.
 */
export const normalizeReportFormalTail = (value: string) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const fiveIndex = findHeading(text, "五、其他需要说明的问题");
  const sixIndex = findHeading(text, "六、附件");
  const tailStart = [fiveIndex, sixIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  const substantiveReport = (tailStart === undefined ? text : text.slice(0, tailStart)).trim();
  return [
    substantiveReport,
    REPORT_NOTES_LINES.join("\n"),
    REPORT_ATTACHMENT_LINES.join("\n"),
  ].filter(Boolean).join("\n\n");
};

export const checkReportCompleteness = (
  value: string,
  dimensions = DEFAULT_REPORT_DIMENSIONS,
): ReportCompletenessResult => {
  const text = String(value ?? "").trim();
  if (!text) return { complete: false, missing: ["报告正文"] };

  const missing: string[] = [];
  const requiredHeadings = [
    "一、评估对象",
    "二、评估方式和方法",
    "三、评估内容与结论",
  ];
  for (const heading of requiredHeadings) {
    if (findHeading(text, heading) < 0) missing.push(heading);
  }

  dimensions.forEach((dimension, index) => {
    const label = CN_SECTION_LABELS[index] ?? String(index + 1);
    const pattern = new RegExp(`（${escapeRegExp(label)}）\\s*${escapeRegExp(dimension)}`);
    if (!pattern.test(text)) missing.push(`第三章：${dimension}`);
  });
  if (!/（[一二三四五六七八九十]+）\s*总体结论/.test(text)) {
    missing.push("第三章：总体结论");
  }

  const suggestions = getSection(text, "四、相关建议", [
    "五、其他需要说明的问题",
    "六、附件",
  ]);
  if (!suggestions) {
    missing.push("四、相关建议");
  } else if (countNumberedItems(suggestions) < 4) {
    missing.push("第四章：至少四项整改建议");
  }

  const fixedLines = [...REPORT_NOTES_LINES, ...REPORT_ATTACHMENT_LINES];
  for (const line of fixedLines) {
    if (!text.includes(line)) missing.push(line);
  }

  return { complete: missing.length === 0, missing };
};


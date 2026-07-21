export interface ScoreSheetIndicator {
  id: string;
  code: string | null;
  name: string;
  weight: number;
}

export interface ParsedExpertScoreRow {
  indicatorId: string;
  maxScore: number;
  score: number;
  deductReason: string;
}

export interface ParsedExpertScoreSheet {
  rows: ParsedExpertScoreRow[];
  totalScore: number;
}

const normalizeText = (value: unknown) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[\s\u3000]+/g, "")
  .replace(/[【】[\]()（）#：:、，,。.\-—_]/g, "");

const toNumber = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const matched = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const result = Number(matched[0]);
  return Number.isFinite(result) ? result : null;
};

const findColumn = (header: unknown[], patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const index = header.findIndex((cell) => pattern.test(String(cell ?? "").trim()));
    if (index >= 0) return index;
  }
  return -1;
};

const findIndicator = (
  codeValue: unknown,
  nameValue: unknown,
  indicators: ScoreSheetIndicator[],
) => {
  const code = normalizeText(codeValue);
  const name = normalizeText(nameValue);

  if (code) {
    const exactCode = indicators.find((indicator) => normalizeText(indicator.code) === code);
    if (exactCode) return exactCode;
  }
  if (name) {
    const exactName = indicators.find((indicator) => normalizeText(indicator.name) === name);
    if (exactName) return exactName;
    return indicators.find((indicator) => {
      const candidate = normalizeText(indicator.name);
      return candidate.length >= 2 && (candidate.includes(name) || name.includes(candidate));
    });
  }
  return undefined;
};

export const parseExpertScoreSheetRows = (
  table: unknown[][],
  indicators: ScoreSheetIndicator[],
): ParsedExpertScoreSheet => {
  const headerIndex = table.findIndex((row) => {
    const cells = row.map((cell) => String(cell ?? "").trim());
    const hasScore = cells.some((cell) => /专家评分|专家得分|评分|得分/.test(cell));
    const hasIndicator = cells.some((cell) => /一级指标|指标名称|指标/.test(cell));
    return hasScore && hasIndicator;
  });

  if (headerIndex < 0) {
    throw new Error("未找到“指标名称”和“专家评分”表头，请使用系统下载的空白打分表");
  }

  const header = table[headerIndex];
  const scoreColumn = findColumn(header, [/专家评分/, /专家得分/, /^评分$/, /^得分$/]);
  const nameColumn = findColumn(header, [/一级指标/, /指标名称/, /^指标$/]);
  const codeColumn = findColumn(header, [/指标编号/, /^编号$/, /^序号$/]);
  const maxColumn = findColumn(header, [/^分值$/, /满分/, /权重/]);
  const reasonColumn = findColumn(header, [/扣分理由/, /评分说明/, /评审意见/, /^意见$/]);

  if (scoreColumn < 0 || nameColumn < 0) {
    throw new Error("打分表缺少“指标名称”或“专家评分”列");
  }

  const parsed = new Map<string, ParsedExpertScoreRow>();
  table.slice(headerIndex + 1).forEach((row) => {
    const nameValue = row[nameColumn];
    if (/合计|总计/.test(String(nameValue ?? ""))) return;
    const indicator = findIndicator(codeColumn >= 0 ? row[codeColumn] : "", nameValue, indicators);
    if (!indicator) return;

    const rawScore = toNumber(row[scoreColumn]);
    if (rawScore === null) return;
    const sheetMax = maxColumn >= 0 ? toNumber(row[maxColumn]) : null;
    const fallbackMax = Number(indicator.weight) || rawScore;
    const maxScore = Math.max(0, sheetMax ?? fallbackMax);
    const score = Math.max(0, maxScore > 0 ? Math.min(rawScore, maxScore) : rawScore);
    parsed.set(indicator.id, {
      indicatorId: indicator.id,
      maxScore,
      score,
      deductReason: reasonColumn >= 0 ? String(row[reasonColumn] ?? "").trim() : "",
    });
  });

  const rows = Array.from(parsed.values());
  if (!rows.length) {
    throw new Error("没有识别到可导入的指标得分，请检查指标名称是否与当前项目一致");
  }

  return {
    rows,
    totalScore: rows.reduce((sum, row) => sum + row.score, 0),
  };
};

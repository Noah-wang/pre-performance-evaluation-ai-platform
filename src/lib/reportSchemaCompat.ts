const REPORT_OPTIONAL_COLUMNS = [
  "supervising_department",
  "evaluation_org",
  "third_party_org",
  "unsupported_budget",
  "supported_budget",
  "summary_remark",
] as const;

type ReportOptionalColumn = (typeof REPORT_OPTIONAL_COLUMNS)[number];

const REPORT_OPTIONAL_COLUMN_SET = new Set<string>(REPORT_OPTIONAL_COLUMNS);

export const getMissingReportColumn = (error: unknown): ReportOptionalColumn | null => {
  const message = typeof error === "object" && error && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  const match = message.match(/Could not find the '([^']+)' column of 'reports' in the schema cache/);
  const column = match?.[1] ?? null;
  return column && REPORT_OPTIONAL_COLUMN_SET.has(column) ? (column as ReportOptionalColumn) : null;
};

export const withReportWriteFallback = async <T>(
  runner: (payload: Record<string, unknown>) => Promise<{ data: T | null; error: unknown }>,
  payload: Record<string, unknown>,
): Promise<{ data: T | null; error: unknown; stripped: ReportOptionalColumn[] }> => {
  const workingPayload = { ...payload };
  const stripped: ReportOptionalColumn[] = [];

  while (true) {
    const result = await runner(workingPayload);
    const missingColumn = getMissingReportColumn(result.error);
    if (!missingColumn || !(missingColumn in workingPayload)) {
      return { ...result, stripped };
    }
    delete workingPayload[missingColumn];
    stripped.push(missingColumn);
  }
};

export const REPORT_SUMMARY_SELECT =
  "id,project_id,conclusion,unsupported_budget,supported_budget,summary_remark,created_at";

export const REPORT_SUMMARY_SELECT_FALLBACK =
  "id,project_id,conclusion,created_at";

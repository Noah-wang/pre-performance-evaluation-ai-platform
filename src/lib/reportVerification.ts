export type ReportVerificationStatus = "passed" | "needs_review" | "blocked";

export interface ReportVerificationIssue {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  sourceNames?: string[];
}

export interface ReportFileVerification {
  fileId: string;
  fileName: string;
  category: string;
  status: "read" | "unreadable";
  sourceType?: string | null;
  sourceId?: string | null;
  errorMessage?: string | null;
  chunkCount: number;
  factCount: number;
}

export interface ReportDimensionVerification {
  dimension: string;
  evidenceCount: number;
  sourceNames: string[];
}

export interface ComprehensiveReportVerification {
  phase: "preflight" | "final";
  status: ReportVerificationStatus;
  summary: string;
  checkedFiles: number;
  totalFiles: number;
  indexedFiles: number;
  coveredFiles: number;
  targetFactsChecked: number;
  targetFactsPresent: number;
  dimensionsChecked: number;
  dimensionsCovered: number;
  files?: ReportFileVerification[];
  dimensions?: ReportDimensionVerification[];
  issues: ReportVerificationIssue[];
}

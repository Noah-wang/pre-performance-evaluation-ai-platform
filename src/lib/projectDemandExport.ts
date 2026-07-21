import { saveAs } from "file-saver";
import { calcFee, DEFAULT_FEE, FeeCalculation, getFeeVersionLabel, normalizeFeeCalculation } from "@/lib/fee";

export interface DemandProjectRow {
  name: string;
  unit: string;
  budget: number;
  category?: string | null;
  description?: string | null;
  packageName?: string | null;
  budgetUnit?: string | null;
  expenseDept?: string | null;
  manager?: string | null;
  listAttribute?: string | null;
  projectAttribute?: string | null;
  agentOrg?: string | null;
  feeCalculation?: FeeCalculation | null;
  systemName?: string | null;
  status?: string | null;
}

const safeFileName = (value: string) =>
  value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();

export const exportDemandDeclarationWorkbook = async (projects: DemandProjectRow[]) => {
  const XLSX = await import("xlsx");
  const title = "财政支出项目评估需求申报表";
  const rows: Array<Array<string | number>> = [
    [title],
    [`导出时间：${new Date().toLocaleString("zh-CN")}`],
    [],
    [
      "序号",
      "项目名称",
      "申请单位",
      "预算金额（元）",
      "评估服务费（元）",
      "收费模板版本",
      "预算单位",
      "支出科室",
      "项目负责人",
      "所属评估包",
      "名录属性",
      "项目属性",
      "代理机构",
      "项目类别",
      "指标体系",
      "当前状态",
      "项目说明",
    ],
  ];

  projects.forEach((project, index) => {
    const fee = normalizeFeeCalculation((project.feeCalculation ?? DEFAULT_FEE) as FeeCalculation);
    rows.push([
      index + 1,
      project.name,
      project.unit,
      Number(project.budget ?? 0),
      Number(calcFee(Number(project.budget ?? 0), fee).total.toFixed(2)),
      getFeeVersionLabel(fee),
      project.budgetUnit ?? "",
      project.expenseDept ?? "",
      project.manager ?? "",
      project.packageName ?? "",
      project.listAttribute ?? "",
      project.projectAttribute ?? "",
      project.agentOrg ?? "",
      project.category ?? "",
      project.systemName ?? "",
      project.status ?? "",
      project.description ?? "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 16 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 16 } },
  ];
  ws["!cols"] = [
    { wch: 7 },
    { wch: 26 },
    { wch: 22 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 36 },
  ];
  ws["!rows"] = rows.map((_, index) => ({ hpt: index === 0 ? 26 : index === 3 ? 20 : 18 }));
  ws["!autofilter"] = { ref: "A4:Q4" };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "需求申报表");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fileName = safeFileName(`${title}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  saveAs(blob, fileName);
};

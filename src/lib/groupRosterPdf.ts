/**
 * Step 8A · 工作组备案表 PDF 生成
 * 用 html2canvas + jsPDF 把 HTML 模板渲染成 A4 PDF
 */
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export interface RosterMember {
  member_name: string;
  member_role: string;
  organization: string | null;
  contact: string | null;
}
export interface RosterTask {
  title: string;
  assignee: string | null;
  start_date: string;
  end_date: string;
  status: string;
}
export interface RosterPayload {
  projectName: string;
  projectUnit?: string | null;
  groupName: string;
  groupLeader: string | null;
  formedOn: string;
  notes: string | null;
  members: RosterMember[];
  tasks: RosterTask[];
}

const ROLE_LABEL: Record<string, string> = { leader: "组长", member: "成员", expert: "专家" };
const STATUS_LABEL: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成" };

const buildHtml = (p: RosterPayload): string => {
  const today = new Date();
  const ymd = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const docNo = `评工字〔${today.getFullYear()}〕第${String(today.getMonth() * 31 + today.getDate()).padStart(3, "0")}号`;

  const memberRows = p.members.length
    ? p.members.map((m, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${m.member_name}</td>
        <td style="text-align:center;">${ROLE_LABEL[m.member_role] ?? m.member_role}</td>
        <td>${m.organization ?? "—"}</td>
        <td>${m.contact?.trim() || "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="text-align:center;color:#999;padding:24px;">暂无成员</td></tr>`;

  const taskRows = p.tasks.length
    ? p.tasks.map((t, i) => `
      <tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${t.title}</td>
        <td style="text-align:center;">${t.assignee ?? "—"}</td>
        <td style="text-align:center;font-family:monospace;">${t.start_date}</td>
        <td style="text-align:center;font-family:monospace;">${t.end_date}</td>
        <td style="text-align:center;">${STATUS_LABEL[t.status] ?? t.status}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">暂无任务计划</td></tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Songti SC", serif; color:#1a1a1a; margin:0; padding:48px 56px; background:#fff; line-height:1.6; }
  .doc-no { text-align:right; font-size:13px; color:#666; margin-bottom:8px; font-family: monospace; }
  h1 { text-align:center; font-size:28px; font-weight:bold; letter-spacing:4px; margin:16px 0 4px; color:#0f1b3d; }
  .subtitle { text-align:center; font-size:13px; color:#666; letter-spacing:4px; margin-bottom:32px; padding-bottom:16px; border-bottom: 2px solid #0f1b3d; }
  .meta-box { display:grid; grid-template-columns:1fr 1fr; gap:8px 32px; margin-bottom:24px; font-size:14px; }
  .meta-box .label { color:#666; display:inline-block; width:80px; }
  .meta-box .value { color:#1a1a1a; font-weight:500; }
  .section-title { font-size:16px; font-weight:bold; color:#0f1b3d; margin: 24px 0 12px; padding-left:10px; border-left:4px solid #c9a84c; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:16px; }
  th { background:#f4f1e8; color:#0f1b3d; font-weight:600; padding:10px 8px; border:1px solid #c9b48a; text-align:center; }
  td { padding:9px 8px; border:1px solid #d4c9a3; }
  .notes-box { font-size:13px; color:#333; padding:12px 16px; background:#fafaf5; border:1px solid #e4dcc0; border-radius:4px; min-height:48px; margin-bottom:24px; white-space:pre-wrap; }
  .signature-area { margin-top:40px; display:grid; grid-template-columns:1fr 1fr; gap:48px; padding-top:24px; }
  .sig-block { font-size:13px; }
  .sig-label { color:#555; margin-bottom:48px; }
  .sig-line { border-bottom:1px solid #1a1a1a; height:1px; margin-bottom:6px; }
  .sig-hint { color:#999; font-size:11px; }
  .footer { margin-top:32px; padding-top:16px; border-top:1px dashed #ccc; text-align:center; font-size:11px; color:#999; font-family:monospace; letter-spacing:2px; }
  .seal-area { position:relative; margin-top:32px; text-align:right; padding-right:60px; }
  .seal-placeholder { display:inline-block; width:110px; height:110px; border:2px dashed #c44; border-radius:50%; color:#c44; font-size:12px; line-height:110px; text-align:center; opacity:0.5; }
</style></head><body>
  <div class="doc-no">${docNo}</div>
  <h1>评估小组备案表</h1>
  <div class="subtitle">EVALUATION TEAM RECORD FORM</div>

  <div class="meta-box">
    <div><span class="label">评估项目：</span><span class="value">${p.projectName}</span></div>
    <div><span class="label">建设单位：</span><span class="value">${p.projectUnit ?? "—"}</span></div>
    <div><span class="label">工作组名：</span><span class="value">${p.groupName}</span></div>
    <div><span class="label">组建日期：</span><span class="value">${p.formedOn}</span></div>
    <div><span class="label">组　　长：</span><span class="value">${p.groupLeader ?? "—"}</span></div>
    <div><span class="label">备案文号：</span><span class="value" style="font-family:monospace;">${docNo}</span></div>
  </div>

  <div class="section-title">一、工作组成员名单（共 ${p.members.length} 人）</div>
  <table>
    <thead><tr><th style="width:48px;">序号</th><th style="width:100px;">姓名</th><th style="width:80px;">角色</th><th>所属单位</th><th style="width:140px;">联系方式</th></tr></thead>
    <tbody>${memberRows}</tbody>
  </table>

  <div class="section-title">二、工作时间计划（共 ${p.tasks.length} 项任务）</div>
  <table>
    <thead><tr><th style="width:48px;">序号</th><th>任务名称</th><th style="width:80px;">负责人</th><th style="width:100px;">开始日期</th><th style="width:100px;">结束日期</th><th style="width:72px;">状态</th></tr></thead>
    <tbody>${taskRows}</tbody>
  </table>

  <div class="section-title">三、备注说明</div>
  <div class="notes-box">${p.notes ?? "（无）"}</div>

  <div class="signature-area">
    <div class="sig-block">
      <div class="sig-label">工作组负责人签字：</div>
      <div class="sig-line"></div>
      <div class="sig-hint">日期：　　　年　　月　　日</div>
    </div>
    <div class="sig-block">
      <div class="sig-label">主管单位审核签字：</div>
      <div class="sig-line"></div>
      <div class="sig-hint">日期：　　　年　　月　　日</div>
    </div>
  </div>

  <div class="seal-area">
    <div class="seal-placeholder">单位公章</div>
  </div>

  <div class="footer">本备案表由系统自动生成 · 打印日期 ${ymd} · 一式两份 留存归档</div>
</body></html>`;
};

const renderToCanvas = async (html: string): Promise<HTMLCanvasElement> => {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "794px";
  iframe.style.height = "1123px";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  await new Promise((r) => setTimeout(r, 400));
  const canvas = await html2canvas(doc.body, { scale: 2, backgroundColor: "#fff", useCORS: true });
  document.body.removeChild(iframe);
  return canvas;
};

export const downloadGroupRosterPdf = async (payload: RosterPayload) => {
  const html = buildHtml(payload);
  const canvas = await renderToCanvas(html);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL("image/jpeg", 0.95);
  let heightLeft = imgH;
  let pos = 0;
  pdf.addImage(img, "JPEG", 0, pos, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    pos = heightLeft - imgH;
    pdf.addPage();
    pdf.addImage(img, "JPEG", 0, pos, imgW, imgH);
    heightLeft -= pageH;
  }
  const safeName = payload.groupName.replace(/[\\/:*?"<>|]/g, "_");
  pdf.save(`评估小组备案表_${safeName}_${Date.now()}.pdf`);
};

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ShieldAlert, RefreshCw, ArrowLeft, Eye, Download, FileSignature, PencilLine, Trash2 } from "lucide-react";
import { StatusPill, EmptyState, StatTile } from "@/components/ui-kit";
import { toast } from "sonner";

interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: any;
  new_data: any;
  changed_fields: string[] | null;
  created_at: string;
}

const TABLE_CN: Record<string, string> = {
  projects: "评估项目", experts: "专家", reports: "评估报告",
  expert_scores: "专家打分", materials: "项目资料",
  evaluation_packages: "评估包", work_groups: "工作组",
  work_tasks: "工作任务", user_roles: "用户角色",
};

const ACTION_TONE: Record<string, "info" | "success" | "danger"> = {
  INSERT: "success", UPDATE: "info", DELETE: "danger",
};
const ACTION_CN: Record<string, string> = { INSERT: "新增", UPDATE: "修改", DELETE: "删除" };

const AuditLogs = () => {
  const { isAdmin, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) return toast.error(error.message);
    setLogs((data as AuditLog[]) ?? []);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const filtered = useMemo(() => logs.filter(l => {
    if (tableFilter !== "all" && l.table_name !== tableFilter) return false;
    if (actionFilter !== "all" && l.action !== actionFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!(l.actor_email ?? "").toLowerCase().includes(s)
          && !l.table_name.toLowerCase().includes(s)
          && !(l.record_id ?? "").toLowerCase().includes(s)) return false;
    }
    return true;
  }), [logs, tableFilter, actionFilter, search]);

  const stats = useMemo(() => ({
    insert: logs.filter((item) => item.action === "INSERT").length,
    update: logs.filter((item) => item.action === "UPDATE").length,
    delete: logs.filter((item) => item.action === "DELETE").length,
    actors: new Set(logs.map((item) => item.actor_id).filter(Boolean)).size,
  }), [logs]);

  const exportCsv = () => {
    if (!filtered.length) {
      toast.error("当前没有可导出的日志");
      return;
    }
    const escapeCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["时间", "执行人邮箱", "执行人ID", "表", "动作", "记录ID", "变更字段"],
      ...filtered.map((item) => [
        new Date(item.created_at).toLocaleString("zh-CN", { hour12: false }),
        item.actor_email ?? "系统",
        item.actor_id ?? "",
        item.table_name,
        item.action,
        item.record_id ?? "",
        item.changed_fields?.join("、") ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `审计日志_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("审计日志已导出");
  };

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <Card className="surface-card p-0">
        <EmptyState
          icon={ShieldAlert}
          title="仅管理员可访问"
          hint="操作日志包含敏感系统信息，仅 admin 角色账号可查看。"
        />
        <div className="p-6"><Link to="/"><Button variant="outline"><ArrowLeft className="h-4 w-4" />返回工作台</Button></Link></div>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="ADMIN · 21 · 操作日志"
        title="审计日志（最近 500 条）"
        subtitle="记录系统中关键写操作（新增 / 修改 / 删除）的执行人、时间、变更内容，可用于合规审计与问题追溯。"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" />导出 CSV</Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新</Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="ACTORS" value={stats.actors} hint="最近操作人" icon={FileSignature} tone="gold" />
        <StatTile label="INSERT" value={stats.insert} hint="新增" icon={PencilLine} tone="success" />
        <StatTile label="UPDATE" value={stats.update} hint="修改" icon={RefreshCw} tone="info" />
        <StatTile label="DELETE" value={stats.delete} hint="删除" icon={Trash2} tone="danger" />
      </div>

      <Card className="surface-card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[11px] font-mono uppercase text-muted-foreground">表</label>
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部表</SelectItem>
              {Object.entries(TABLE_CN).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-mono uppercase text-muted-foreground">动作</label>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="INSERT">新增</SelectItem>
              <SelectItem value="UPDATE">修改</SelectItem>
              <SelectItem value="DELETE">删除</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[240px]">
          <label className="text-[11px] font-mono uppercase text-muted-foreground">搜索（邮箱 / 表名 / 记录 ID）</label>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="例如 admin@example.com" className="h-9" />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {filtered.length} / {logs.length} 条
        </div>
      </Card>

      <Card className="surface-card p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="暂无日志" hint={loading ? "加载中…" : "尝试调整筛选条件"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">时间</TableHead>
                  <TableHead>执行人</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead className="w-20">动作</TableHead>
                  <TableHead>变更字段</TableHead>
                  <TableHead className="w-16 text-right">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(l.created_at).toLocaleString("zh-CN", { hour12: false })}
                    </TableCell>
                    <TableCell className="text-xs">{l.actor_email ?? <span className="text-muted-foreground">系统</span>}</TableCell>
                    <TableCell>
                      <div className="text-sm">{TABLE_CN[l.table_name] ?? l.table_name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[200px]">{l.record_id ?? "—"}</div>
                    </TableCell>
                    <TableCell><StatusPill tone={ACTION_TONE[l.action]}>{ACTION_CN[l.action]}</StatusPill></TableCell>
                    <TableCell className="text-xs">
                      {l.changed_fields?.length
                        ? <span className="font-mono">{l.changed_fields.slice(0, 4).join(", ")}{l.changed_fields.length > 4 && " …"}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetail(l)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail && `${ACTION_CN[detail.action]} · ${TABLE_CN[detail.table_name] ?? detail.table_name}`}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-xs font-mono">
              <div>
                <div className="text-muted-foreground mb-1">基本信息</div>
                <div className="bg-muted/30 p-3 rounded space-y-1">
                  <div>时间：{new Date(detail.created_at).toLocaleString("zh-CN", { hour12: false })}</div>
                  <div>执行人：{detail.actor_email ?? "系统"} ({detail.actor_id ?? "—"})</div>
                  <div>记录 ID：{detail.record_id ?? "—"}</div>
                  {detail.changed_fields?.length ? <div>变更字段：{detail.changed_fields.join(", ")}</div> : null}
                </div>
              </div>
              {detail.old_data && (
                <div>
                  <div className="text-muted-foreground mb-1">变更前</div>
                  <pre className="bg-muted/30 p-3 rounded overflow-auto max-h-64 text-[10px]">
                    {JSON.stringify(detail.old_data, null, 2)}
                  </pre>
                </div>
              )}
              {detail.new_data && (
                <div>
                  <div className="text-muted-foreground mb-1">变更后</div>
                  <pre className="bg-muted/30 p-3 rounded overflow-auto max-h-64 text-[10px]">
                    {JSON.stringify(detail.new_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AuditLogs;

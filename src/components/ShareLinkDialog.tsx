// 创建外发分享链接对话框
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Link2, Trash2, ShieldCheck, Eye, X, CheckCircle2, AlertCircle } from "lucide-react";
import { StatusPill } from "@/components/ui-kit";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reportId: string;
}

interface Link {
  id: string; token: string; expires_at: string | null; max_views: number | null;
  view_count: number; watermark_required: boolean; revoked: boolean; created_at: string;
}
interface ViewLog {
  id: string; share_link_id: string; viewed_at: string;
  ip: string | null; user_agent: string | null; success: boolean; reason: string | null;
}

export const ShareLinkDialog = ({ open, onOpenChange, reportId }: Props) => {
  const [password, setPassword] = useState("");
  const [days, setDays] = useState("7");
  const [maxViews, setMaxViews] = useState("");
  const [watermark, setWatermark] = useState(true);
  const [creating, setCreating] = useState(false);
  const [links, setLinks] = useState<Link[]>([]);
  const [auditFor, setAuditFor] = useState<Link | null>(null);
  const [auditLogs, setAuditLogs] = useState<ViewLog[]>([]);

  const refresh = async () => {
    const { data } = await supabase.from("share_links").select("*")
      .eq("report_id", reportId).order("created_at", { ascending: false });
    setLinks((data as any) ?? []);
  };
  useEffect(() => { if (open && reportId) refresh(); }, [open, reportId]);

  const openAudit = async (l: Link) => {
    setAuditFor(l);
    const { data } = await supabase.from("share_link_views")
      .select("*").eq("share_link_id", l.id)
      .order("viewed_at", { ascending: false }).limit(200);
    setAuditLogs((data as any) ?? []);
  };

  const create = async () => {
    setCreating(true);
    try {
      const expires = days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null;
      const { data, error } = await supabase.rpc("create_share_link", {
        _report_id: reportId,
        _password: password || null,
        _expires_at: expires,
        _max_views: maxViews ? Number(maxViews) : null,
        _watermark: watermark,
        _scope: "full",
      });
      if (error) throw error;
      const token = (data as any)?.token;
      const url = `${window.location.origin}/s/${token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("链接已生成并复制到剪贴板");
      setPassword(""); setMaxViews("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setCreating(false); }
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.from("share_links").update({ revoked: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("已吊销"); refresh();
  };
  const copy = (token: string) => {
    const url = `${window.location.origin}/s/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("已复制：" + url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" /> 安全外发分享
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">访问密码（可选）</Label>
              <Input className="mt-1" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空则免密" />
            </div>
            <div>
              <Label className="text-xs">有效期（天）</Label>
              <Input className="mt-1" type="number" min="1" value={days} onChange={e => setDays(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">最大查看次数（可选）</Label>
              <Input className="mt-1" type="number" min="1" value={maxViews} onChange={e => setMaxViews(e.target.value)} placeholder="不限" />
            </div>
            <div className="flex items-end gap-2">
              <Switch checked={watermark} onCheckedChange={setWatermark} id="wm" />
              <Label htmlFor="wm" className="text-xs">强制水印</Label>
            </div>
          </div>
          <Button onClick={create} disabled={creating} className="w-full">
            <Link2 className="h-4 w-4" />{creating ? "生成中…" : "生成分享链接"}
          </Button>

          <div className="border-t border-border pt-3">
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">已生成 ({links.length})</div>
            <div className="space-y-2 max-h-64 overflow-auto">
              {links.length === 0 && <p className="text-xs text-muted-foreground">暂无</p>}
              {links.map(l => (
                <div key={l.id} className="rounded-md border border-border p-2.5 text-xs flex items-center gap-2">
                  <code className="flex-1 truncate font-mono">{l.token.slice(0, 16)}…</code>
                  {l.revoked && <StatusPill tone="danger" dot={false}>已吊销</StatusPill>}
                  {!l.revoked && l.expires_at && new Date(l.expires_at) < new Date() && <StatusPill tone="warning" dot={false}>已过期</StatusPill>}
                  <span className="font-mono tabular-nums text-muted-foreground">{l.view_count}{l.max_views ? `/${l.max_views}` : ""}次</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openAudit(l)} title="访问审计"><Eye className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(l.token)}><Copy className="h-3.5 w-3.5" /></Button>
                  {!l.revoked && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => revoke(l.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {auditFor && (
            <div className="border border-accent/40 rounded-md p-3 bg-accent/5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono uppercase tracking-wider text-accent flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" />访问审计 · {auditFor.token.slice(0, 12)}…（最近 200 条）
                </div>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAuditFor(null)}><X className="h-3.5 w-3.5" /></Button>
              </div>
              {auditLogs.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">尚无访问记录</div>
              ) : (
                <div className="max-h-56 overflow-auto divide-y divide-border/60">
                  {auditLogs.map(v => (
                    <div key={v.id} className="py-1.5 text-[11px] font-mono flex items-center gap-2">
                      {v.success
                        ? <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                        : <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                      <span className="tabular-nums text-foreground">{new Date(v.viewed_at).toLocaleString("zh-CN", { hour12: false })}</span>
                      <span className="text-muted-foreground truncate flex-1">{v.ip ?? "未知 IP"}</span>
                      {!v.success && <span className="text-destructive">{v.reason ?? "失败"}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

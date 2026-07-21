// 公共外发分享页 — 通过 token 校验后展示报告
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, FileText, Lock, AlertTriangle } from "lucide-react";
import { MarkdownView } from "@/components/MarkdownView";
import { WatermarkOverlay } from "@/components/WatermarkOverlay";

interface Report { id: string; title: string; content: string | null; conclusion: string | null; }

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();
  const [pwd, setPwd] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [needsPwd, setNeedsPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [watermark, setWatermark] = useState(true);

  const verify = async (password: string | null) => {
    setLoading(true); setError(null);
    const ua = navigator.userAgent;
    const { data, error } = await supabase.rpc("verify_share_link", {
      _token: token!, _pwd: password, _ip: null, _ua: ua,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    const res = data as any;
    if (!res?.ok) {
      if (res?.error === "bad_password") { setNeedsPwd(true); setError("密码错误"); return; }
      if (res?.error === "not_found") setError("链接不存在");
      else if (res?.error === "expired") setError("链接已过期");
      else if (res?.error === "exhausted") setError("查看次数已用完");
      else if (res?.error === "revoked") setError("链接已被吊销");
      else setError("无法访问");
      return;
    }
    setReport(res.report);
    setWatermark(!!res.watermark);
    setNeedsPwd(false);
  };

  useEffect(() => { if (token) verify(null); /* try without pwd */ }, [token]);

  const Header = (
    <div className="border-b border-border bg-card">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <span className="font-mono uppercase tracking-wider text-xs text-muted-foreground">SECURE SHARE · 外发分享</span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">仅供阅览 · 禁止复制扩散</span>
      </div>
    </div>
  );

  if (needsPwd && !report) {
    return (
      <div className="min-h-screen bg-background">
        {Header}
        <div className="max-w-md mx-auto mt-24 px-6">
          <Card><CardContent className="p-8 space-y-4">
            <div className="flex items-center gap-2"><Lock className="h-5 w-5 text-accent" /><h1 className="font-display text-lg font-bold">需要密码</h1></div>
            <p className="text-sm text-muted-foreground">该分享链接受密码保护，请输入访问密码。</p>
            <Input type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="访问密码" />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button className="w-full" disabled={!pwd || loading} onClick={() => verify(pwd)}>验证并访问</Button>
          </CardContent></Card>
        </div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="min-h-screen bg-background">
        {Header}
        <div className="max-w-md mx-auto mt-24 px-6">
          <Card><CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <h1 className="font-display text-lg font-bold">无法访问</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent></Card>
        </div>
      </div>
    );
  }

  if (loading || !report) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">加载中…</div>;
  }

  const wmText = `外发查看 · ${new Date().toLocaleDateString("zh-CN")} · token:${token?.slice(0,8)}`;

  return (
    <div className="min-h-screen bg-background">
      {Header}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Card>
          <CardContent className="p-8">
            <div className="flex items-center gap-2 mb-2 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5" /> 评估报告
            </div>
            <h1 className="font-display text-2xl font-bold mb-1">{report.title}</h1>
            {report.conclusion && <p className="text-sm text-muted-foreground mb-6">评估结论：<span className="text-foreground font-bold">{report.conclusion}</span></p>}
            <hr className="my-4 border-border" />
            {watermark ? (
              <WatermarkOverlay text={wmText}>
                <MarkdownView content={report.content ?? ""} />
              </WatermarkOverlay>
            ) : (
              <MarkdownView content={report.content ?? ""} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

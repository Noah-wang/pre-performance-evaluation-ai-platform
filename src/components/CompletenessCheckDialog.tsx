import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, AlertTriangle, CheckCircle2, MinusCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui-kit";

interface Gap {
  indicator: string;
  required: string;
  status: "missing" | "partial" | "covered";
  matched_material?: string;
  match_score?: number;
  match_basis?: string;
  reason?: string;
  suggestion?: string;
}

interface CheckResult {
  gaps: Gap[];
  summary: string;
  completion_rate: number;
}

interface Props {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const STATUS_META = {
  missing: { label: "缺失", icon: AlertTriangle, tone: "danger" as const, color: "text-destructive" },
  partial: { label: "部分", icon: MinusCircle, tone: "warning" as const, color: "text-amber-600" },
  covered: { label: "已覆盖", icon: CheckCircle2, tone: "success" as const, color: "text-emerald-600" },
};

export const CompletenessCheckDialog = ({ projectId, projectName, open, onOpenChange }: Props) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("check-materials-completeness", {
        body: { projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data as CheckResult);
      toast.success("完整性检查完成");
    } catch (e: any) {
      toast.error(e?.message ?? "检查失败");
    } finally {
      setLoading(false);
    }
  };

  const grouped = result ? result.gaps.reduce<Record<string, Gap[]>>((acc, g) => {
    (acc[g.indicator] ??= []).push(g);
    return acc;
  }, {}) : {};

  const stats = result ? {
    missing: result.gaps.filter(g => g.status === "missing").length,
    partial: result.gaps.filter(g => g.status === "partial").length,
    covered: result.gaps.filter(g => g.status === "covered").length,
  } : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> 资料完整性 AI 校验
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
            <div className="text-sm text-muted-foreground">项目：<span className="text-foreground font-medium">{projectName}</span></div>
            <div className="mt-2 text-xs text-muted-foreground">
              系统将比对评估指标的"必备资料要求"与项目已上传资料，标注缺失、部分覆盖与已覆盖项。
            </div>
          </div>

          {!result && (
            <div className="flex justify-center py-6">
              <Button variant="hero" size="lg" onClick={run} disabled={loading}>
                <Sparkles className="h-4 w-4" /> {loading ? "AI 分析中…" : "开始检查"}
              </Button>
            </div>
          )}

          {result && (
            <>
              <div className="rounded-lg border border-border/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">整体完整度</div>
                  <div className="text-2xl font-display tabular-nums">{result.completion_rate}%</div>
                </div>
                <Progress value={result.completion_rate} />
                <div className="flex gap-3 text-xs">
                  {stats && (<>
                    <StatusPill tone="success">已覆盖 {stats.covered}</StatusPill>
                    <StatusPill tone="warning">部分 {stats.partial}</StatusPill>
                    <StatusPill tone="danger">缺失 {stats.missing}</StatusPill>
                  </>)}
                </div>
                {result.summary && (
                  <div className="text-sm text-muted-foreground border-t border-border/60 pt-3">{result.summary}</div>
                )}
              </div>

              <ScrollArea className="h-[360px] rounded-lg border border-border/60">
                <div className="p-3 space-y-4">
                  {Object.keys(grouped).length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-8">无指标资料要求</div>
                  )}
                  {Object.entries(grouped).map(([ind, gaps]) => (
                    <div key={ind}>
                      <div className="text-sm font-medium mb-2 text-foreground">{ind}</div>
                      <div className="space-y-2">
                        {gaps.map((g, i) => {
                          const meta = STATUS_META[g.status] ?? STATUS_META.missing;
                          const Icon = meta.icon;
                          return (
                            <div key={i} className="rounded-md border border-border/50 bg-background p-3">
                              <div className="flex items-start gap-2">
                                <Icon className={`h-4 w-4 mt-0.5 ${meta.color}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium">{g.required}</span>
                                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                                    {typeof g.match_score === "number" && (
                                      <span className="text-[10px] text-muted-foreground tabular-nums">匹配度 {g.match_score}/100</span>
                                    )}
                                  </div>
                                  {g.matched_material && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      对照资料：<span className="text-foreground">{g.matched_material}</span>
                                      {g.match_basis && <span className="ml-2">· {g.match_basis}</span>}
                                    </div>
                                  )}
                                  {g.reason && (
                                    <div className="text-xs text-muted-foreground mt-1">判定理由：{g.reason}</div>
                                  )}
                                  {g.suggestion && (
                                    <div className="text-xs text-muted-foreground mt-1">补充建议：{g.suggestion}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

        <DialogFooter>
          {result && (
            <Button variant="outline" onClick={run} disabled={loading}>
              <Sparkles className="h-4 w-4" /> 重新检查
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

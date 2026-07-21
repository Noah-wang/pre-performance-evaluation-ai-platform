// 报告版本历史
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui-kit";

interface Version {
  id: string; version_no: number; title: string; content: string | null;
  change_summary: string | null; source: string; created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reportId: string | null;
  onRestore: (content: string) => void;
}

export const ReportVersionsDialog = ({ open, onOpenChange, reportId, onRestore }: Props) => {
  const [list, setList] = useState<Version[]>([]);
  const [previewing, setPreviewing] = useState<Version | null>(null);

  useEffect(() => {
    if (!open || !reportId) return;
    supabase.from("report_versions").select("*")
      .eq("report_id", reportId).order("version_no", { ascending: false })
      .then(({ data }) => setList((data as any) ?? []));
  }, [open, reportId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-accent" /> 报告版本历史
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-4 max-h-[60vh]">
          <div className="space-y-1.5 overflow-auto col-span-1 border-r border-border pr-3">
            {list.length === 0 && <p className="text-xs text-muted-foreground">暂无历史版本</p>}
            {list.map(v => (
              <button key={v.id} onClick={() => setPreviewing(v)}
                className={`w-full text-left p-2 rounded-md text-xs border transition-all ${
                  previewing?.id === v.id ? "border-accent bg-accent/8" : "border-border hover:border-accent/40"
                }`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono tabular-nums font-bold">v{v.version_no}</span>
                  <StatusPill tone={v.source === "ai" ? "info" : "neutral"} dot={false}>{v.source === "ai" ? "AI" : "手动"}</StatusPill>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{new Date(v.created_at).toLocaleString()}</div>
                {v.change_summary && <div className="text-muted-foreground mt-1 line-clamp-2">{v.change_summary}</div>}
              </button>
            ))}
          </div>
          <div className="col-span-2 overflow-auto">
            {previewing ? (
              <pre className="text-xs whitespace-pre-wrap font-sans p-2">{previewing.content}</pre>
            ) : (
              <p className="text-xs text-muted-foreground p-3">选择左侧版本预览</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button disabled={!previewing} onClick={() => {
            if (!previewing) return;
            onRestore(previewing.content ?? "");
            onOpenChange(false);
            toast.success(`已回滚到 v${previewing.version_no}`);
          }}>
            <RotateCcw className="h-4 w-4" /> 回滚到此版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

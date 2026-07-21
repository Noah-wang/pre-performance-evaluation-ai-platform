// AI 分块重写对话框
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  block: string;
  context?: string;
  project?: {
    id?: string;
    name?: string;
    unit?: string | null;
    category?: string | null;
    description?: string | null;
  } | null;
  onApply: (newText: string, sourceText: string) => boolean | void | Promise<boolean | void>;
}

const STYLES = [
  { value: "formal", label: "更正式（公文体）" },
  { value: "concise", label: "更简明（去冗余）" },
  { value: "expand", label: "更充实（补论证）" },
  { value: "rigorous", label: "更严谨（强逻辑）" },
  { value: "rectify", label: "整改口吻" },
];

export const RewriteBlockDialog = ({ open, onOpenChange, block, context = "", project = null, onApply }: Props) => {
  const [style, setStyle] = useState("formal");
  const [sourceBlock, setSourceBlock] = useState(block);
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) {
      setSourceBlock(block);
      setResult("");
    }
  }, [block, open]);

  const run = async () => {
    if (!sourceBlock.trim()) {
      toast.error("请先选择或填写要重写的原段落");
      return;
    }
    setLoading(true);
    setResult("");
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rewrite-report-block`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ block: sourceBlock, context, style, instruction, project }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "AI 调用失败");
      setResult(data.text || "");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!result.trim()) return;
    setApplying(true);
    try {
      const applied = await onApply(result.trim(), sourceBlock.trim());
      if (applied === false) return;
      onOpenChange(false);
      toast.success("已应用到报告");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" /> AI 段落重写
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">风格</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STYLES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">附加指令（可选）</Label>
              <Textarea rows={1} value={instruction} onChange={e => setInstruction(e.target.value)} className="mt-1 min-h-9" placeholder="例如：突出预算合理性论证" />
            </div>
          </div>
          <div>
            <Label className="text-xs">原段落</Label>
            <Textarea
              rows={5}
              value={sourceBlock}
              onChange={(event) => setSourceBlock(event.target.value)}
              className="mt-1 bg-muted/30"
              placeholder="选中正文段落后会自动带入，也可以在这里手动粘贴要替换的原段落"
            />
          </div>
          <div>
            <Label className="text-xs flex items-center justify-between">
              <span>AI 重写结果</span>
              <Button size="sm" variant="ghost" onClick={run} disabled={loading || !sourceBlock.trim()} className="h-7">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "生成中…" : "生成 / 重生成"}
              </Button>
            </Label>
            <Textarea rows={8} value={result} onChange={e => setResult(e.target.value)} className="mt-1" placeholder="点击右上『生成』后将在此显示结果，可直接编辑后再应用" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!result.trim() || !sourceBlock.trim() || applying} onClick={apply}>
            {applying ? "应用中…" : "应用替换"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

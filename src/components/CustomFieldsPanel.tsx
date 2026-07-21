import { Plus, Trash2, Tags, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type CustomField = { key: string; value: string };

interface Props {
  value: CustomField[];
  onChange: (v: CustomField[]) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const CustomFieldsPanel = ({ value, onChange, open, onOpenChange }: Props) => {
  const fields = value ?? [];

  const update = (i: number, patch: Partial<CustomField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const add = () => onChange([...fields, { key: "", value: "" }]);
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <Tags className="h-4 w-4 text-gold" />
            自定义字段
            {fields.length > 0 && (
              <span className="font-mono text-[11px] text-gold-soft">· {fields.length} 项</span>
            )}
          </span>
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-2">
        <p className="text-[11px] text-muted-foreground px-1">
          为本项目添加任意键值对（例如：合同编号 / 主管领导 / 立项批文号 等）
        </p>
        {fields.length > 0 && (
          <div className="rounded-md border border-border/60 overflow-hidden">
            <div className="grid grid-cols-[1fr_1.5fr_40px] gap-2 px-3 py-2 bg-muted/30 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <span>字段名</span>
              <span>字段值</span>
              <span></span>
            </div>
            <div className="divide-y divide-border/50">
              {fields.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1.5fr_40px] gap-2 px-3 py-2 items-center">
                  <Input
                    value={f.key}
                    placeholder="如：合同编号"
                    onChange={(e) => update(i, { key: e.target.value })}
                    maxLength={50}
                    className="h-8 text-sm"
                  />
                  <Input
                    value={f.value}
                    placeholder="如：HT-2025-001"
                    onChange={(e) => update(i, { value: e.target.value })}
                    maxLength={500}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <Button type="button" variant="outline" size="sm" onClick={add} className="w-full h-8 text-xs">
          <Plus className="h-3 w-3 mr-1" /> 添加字段
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
};

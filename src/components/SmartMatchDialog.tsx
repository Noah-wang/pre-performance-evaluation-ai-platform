import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui-kit";
import { Sparkles, Loader2, ShieldAlert, CheckCircle2, Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

interface Recommended {
  id: string; name: string; expert_type: string;
  organization: string | null; title: string | null; specialty: string | null;
  phone?: string | null; email?: string | null;
  score: number; reasons: string[]; conflict: boolean;
  history_avg: number | null; history_count: number;
  matched_terms?: string[];
  matched_tags?: string[];
}

interface MatchResponse {
  project: { name: string; unit: string; avoid_unit: string };
  keywords: string[];
  project_profile?: {
    focus_tags: string[];
    indicator_terms: string[];
    summary: string;
  };
  recommended: Recommended[];
  pool: Record<string, Recommended[]>;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  /** When provided, picked experts will be inserted into this work group's member roster */
  groupId?: string;
  onAdded?: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  business: "业务", management: "管理", finance: "财务",
};

export const SmartMatchDialog = ({ open, onOpenChange, projectId, groupId, onAdded }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MatchResponse | null>(null);
  const [keyword, setKeyword] = useState("");
  const [quota, setQuota] = useState({ management: 2, finance: 1, business: 2 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const run = async () => {
    setLoading(true);
    setData(null);
    setPicked(new Set());
    const { data: r, error } = await supabase.functions.invoke("match-experts", {
      body: { project_id: projectId, type_quota: quota, keyword: keyword || undefined },
    });
    setLoading(false);
    if (error) return toast.error("智能匹配失败：" + error.message);
    setData(r as MatchResponse);
    setPicked(new Set((r as MatchResponse).recommended.map((x: Recommended) => x.id)));
  };

  useEffect(() => {
    if (open && projectId) run();
    // eslint-disable-next-line
  }, [open, projectId]);

  const togglePick = (id: string) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };

  const allCandidates = data
    ? [...(data.pool.management ?? []), ...(data.pool.finance ?? []), ...(data.pool.business ?? [])]
    : [];

  const pickedExperts = useMemo(
    () => allCandidates.filter((candidate) => picked.has(candidate.id)),
    [allCandidates, picked],
  );
  const pickedStats = useMemo(() => ({
    management: pickedExperts.filter((item) => item.expert_type === "management").length,
    finance: pickedExperts.filter((item) => item.expert_type === "finance").length,
    business: pickedExperts.filter((item) => item.expert_type === "business").length,
  }), [pickedExperts]);

  const addToGroup = async () => {
    if (!user || !groupId) return;
    const list = allCandidates.filter((c) => picked.has(c.id));
    if (!list.length) return toast.error("请先勾选要加入的专家");
    setAdding(true);
    const { data: expertContacts } = await supabase
      .from("experts")
      .select("id,phone,email")
      .in("id", list.map((item) => item.id));
    const contactMap = new Map(
      ((expertContacts ?? []) as { id: string; phone: string | null; email: string | null }[]).map((item) => [
        item.id,
        [item.phone, item.email].filter(Boolean).join(" / "),
      ]),
    );
    const rows = list.map((e) => ({
      group_id: groupId,
      member_name: e.name,
      member_role: "expert",
      organization: e.organization,
      contact: contactMap.get(e.id) || [e.phone, e.email].filter(Boolean).join(" / ") || null,
      created_by: user.id,
    }));
    const { error } = await supabase.from("work_group_members").insert(rows as any);
    setAdding(false);
    if (error) return toast.error(error.message);
    toast.success(`已加入 ${rows.length} 名专家`);
    onAdded?.();
    onOpenChange(false);
  };

  const renderCard = (e: Recommended) => {
    const checked = picked.has(e.id);
    return (
      <div
        key={e.id}
        onClick={() => !e.conflict && togglePick(e.id)}
        className={[
          "rounded-lg border p-3 transition-all cursor-pointer",
          e.conflict
            ? "border-destructive/40 bg-destructive/5 opacity-70 cursor-not-allowed"
            : checked
            ? "border-accent bg-accent/8 shadow-sm"
            : "border-border hover:border-accent/40",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Checkbox checked={checked} disabled={e.conflict} className="pointer-events-none" />
              <span className="font-display font-semibold text-foreground truncate">{e.name}</span>
              <StatusPill tone="info" dot={false}>{TYPE_LABEL[e.expert_type] ?? e.expert_type}</StatusPill>
              {e.conflict && (
                <StatusPill tone="danger" dot={false}><ShieldAlert className="h-3 w-3" />回避</StatusPill>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {e.organization ?? "—"}{e.title ? ` · ${e.title}` : ""}
            </div>
            {e.specialty && (
              <div className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-1">专长：{e.specialty}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {e.reasons.map((r, i) => (
                <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                  {r}
                </span>
              ))}
            </div>
            {!!e.matched_tags?.length && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {e.matched_tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded border border-accent/30 bg-accent/8 text-accent">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {!!e.matched_terms?.length && (
              <div className="text-[11px] text-muted-foreground mt-2">
                命中词：{e.matched_terms.join("、")}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-2xl font-bold text-accent tabular-nums leading-none">{Math.round(e.score)}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">SCORE</div>
            {e.history_count > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1">历史 {Math.round((e.history_avg ?? 0) * 100)}分</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" /> 专家智能匹配
          </DialogTitle>
          <DialogDescription>
            支持“智能推荐 + 人工勾选”，按管理、财务、业务三类专家定量抽取，并展示项目业务画像与匹配理由。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_120px_120px_120px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">补充关键词（可选）</Label>
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="如：BIM、招投标" />
          </div>
          {(["management", "finance", "business"] as const).map((t) => (
            <div key={t}>
              <Label className="text-xs">{TYPE_LABEL[t]}（人）</Label>
              <Input
                type="number" min={0} max={10}
                value={quota[t]}
                onChange={(e) => setQuota({ ...quota, [t]: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
          ))}
          <Button variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            重新匹配
          </Button>
        </div>

        {data && (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="text-[11px] font-mono text-muted-foreground">
              项目：<span className="text-foreground">{data.project.name}</span>
              {data.project.avoid_unit && (
                <> · 回避单位：<span className="text-destructive">{data.project.avoid_unit}</span></>
              )}
              {data.keywords.length > 0 && (
                <> · 命中关键词：<span className="text-accent">{data.keywords.slice(0, 8).join("、")}</span></>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(["management", "finance", "business"] as const).map((type) => (
                <div key={type} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{TYPE_LABEL[type]}</div>
                  <div className="text-lg font-semibold text-foreground mt-1">
                    {pickedStats[type]} / {quota[type]}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    已勾选 {pickedStats[type]} 人，目标抽取 {quota[type]} 人
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info" dot={false}>项目业务画像</StatusPill>
                {data.project_profile?.focus_tags?.length
                  ? data.project_profile.focus_tags.map((tag) => (
                    <StatusPill key={tag} tone="accent" dot={false}>{tag}</StatusPill>
                  ))
                  : <span className="text-xs text-muted-foreground">暂未识别明确业务方向</span>}
              </div>
              {data.project_profile?.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">{data.project_profile.summary}</p>
              )}
              {!!data.project_profile?.indicator_terms?.length && (
                <div className="text-xs text-muted-foreground">
                  指标线索：{data.project_profile.indicator_terms.slice(0, 8).join("、")}
                </div>
              )}
            </div>
          </div>
        )}

        {loading && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" />正在匹配…
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-accent mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> 推荐组合（共 {data.recommended.length} 人）
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.recommended.length === 0
                  ? <div className="col-span-2 text-sm text-muted-foreground py-4">无可推荐专家，请调整名额或补充专家库</div>
                  : data.recommended.map(renderCard)}
              </div>
            </div>

            {(["management", "finance", "business"] as const).map((t) => {
              const others = (data.pool[t] ?? []).filter((e) => !data.recommended.some((r) => r.id === e.id));
              if (others.length === 0) return null;
              return (
                <div key={t}>
                  <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    候选 · {TYPE_LABEL[t]}（{others.length}）
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {others.slice(0, 6).map(renderCard)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <div className="flex-1 text-xs text-muted-foreground">
            已勾选 <span className="text-accent font-bold">{picked.size}</span> 人
            {" · "}
            管理 {pickedStats.management} / 财务 {pickedStats.finance} / 业务 {pickedStats.business}
          </div>
          {groupId ? (
            <Button variant="hero" onClick={addToGroup} disabled={adding || picked.size === 0}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              加入工作组
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

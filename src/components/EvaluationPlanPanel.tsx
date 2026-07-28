import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Sparkles, Loader2, FileText, Trash2, Copy, Download, RefreshCw, AlertCircle, Pencil, Save, X,
} from "lucide-react";
import { StatusPill, EmptyState } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { MarkdownView } from "@/components/MarkdownView";
import { RichTextEditor } from "@/components/RichTextEditor";

interface PlanRecord {
  id: string;
  title: string;
  content: string;
  status: string;
  ai_model: string | null;
  created_at: string;
}

interface Project {
  id: string; name: string; unit?: string | null; budget?: number | null;
  category?: string | null; description?: string | null;
  evaluation_system_id?: string | null;
}
interface Group { id: string; name: string; leader: string | null; }
interface Member { id: string; member_name: string; member_role: string; organization: string | null; }
interface Task { id: string; title: string; assignee: string | null; start_date: string; end_date: string; }
interface Indicator { id: string; code: string | null; name: string; weight: number | null; level: number; }
interface SystemRow { id: string; name: string; }

interface Props {
  project: Project;
  group: Group;
  members: Member[];
  tasks: Task[];
}

const stripAiPlanPreface = (value: string) => {
  let next = String(value ?? "").trimStart();
  const patterns = [
    /^<p[^>]*>\s*(?:好的|当然|以下是|下面是|根据您提供的信息)[\s\S]{0,260}?(?:方案|如下|。|：|:)\s*<\/p>\s*/i,
    /^(?:好的|当然|以下是|下面是|根据您提供的信息)[^\n]{0,260}?(?:方案|如下|。|：|:)\s*(?:\n+|$)/,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of patterns) {
      const cleaned = next.replace(pattern, "").trimStart();
      if (cleaned !== next) {
        next = cleaned;
        changed = true;
      }
    }
  }
  return next;
};

const PLAN_TITLE_SUFFIXES = ["组长", "副组长", "专家", "老师", "主任", "负责人", "经理", "主管", "科长", "处长", "局长"];
const PLAN_ROLE_LABELS = ["成员", "组长", "副组长", "专家", "负责人", "审核人", "主责", "牵头人", "责任人"];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const EvaluationPlanPanel = ({ project, group, members, tasks }: Props) => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatingModel, setGeneratingModel] = useState("AI");
  const [draft, setDraft] = useState<string>("");
  const [system, setSystem] = useState<SystemRow | null>(null);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState(false);
  const [editText, setEditText] = useState("");
  const editTextRef = useRef("");

  const loadPlans = async () => {
    const { data, error } = await supabase
      .from("evaluation_plans")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else {
      const list = (data as PlanRecord[]) ?? [];
      setPlans(list);
      setActivePlanId((current) => current ?? list[0]?.id ?? null);
    }
  };

  const loadSystem = async () => {
    if (!project.evaluation_system_id) {
      setSystem(null);
      setIndicators([]);
      return;
    }
    const [{ data: sys }, { data: inds }] = await Promise.all([
      supabase.from("evaluation_systems").select("id,name").eq("id", project.evaluation_system_id).maybeSingle(),
      supabase.from("evaluation_indicators").select("id,code,name,weight,level").eq("system_id", project.evaluation_system_id).order("sort_order"),
    ]);
    setSystem((sys as SystemRow) ?? null);
    setIndicators((inds as Indicator[]) ?? []);
  };

  useEffect(() => {
    setDraft("");
    setActivePlanId(null);
    loadPlans();
    loadSystem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, project.evaluation_system_id]);

  const normalizePlanPersonNames = (value: string) => {
    let next = stripAiPlanPreface(value);
    const names = Array.from(new Set(members.map((member) => member.member_name.trim()).filter(Boolean)));
    const aliasMap = new Map<string, string>();

    names.forEach((name) => {
      const first = name.slice(0, 1);
      if (!first) return;
      const sameFirstNames = names.filter((candidate) => candidate.startsWith(first));
      if (sameFirstNames.length !== 1) return;
      PLAN_TITLE_SUFFIXES.forEach((suffix) => aliasMap.set(`${first}${suffix}`, name));
    });

    const leader = group.leader?.trim();
    if (leader) {
      const leaderBase = PLAN_TITLE_SUFFIXES.reduce(
        (current, suffix) => (current.endsWith(suffix) ? current.slice(0, -suffix.length).trim() : current),
        leader,
      );
      const matched = names.find((name) => name === leader || (leaderBase && name.startsWith(leaderBase)));
      if (matched && matched !== leader) aliasMap.set(leader, matched);
    }

    Array.from(aliasMap.entries())
      .sort((a, b) => b[0].length - a[0].length)
      .forEach(([alias, name]) => {
        next = next.replace(new RegExp(escapeRegExp(alias), "g"), name);
      });

    const roleLabelPattern = PLAN_ROLE_LABELS.map(escapeRegExp).join("|");
    next = next
      .replace(new RegExp(`（\\s*(?:${roleLabelPattern})\\s*[:：]\\s*([^）]+?)\\s*）`, "g"), "（$1）")
      .replace(new RegExp(`\\(\\s*(?:${roleLabelPattern})\\s*[:：]\\s*([^）]+?)\\s*\\)`, "g"), "（$1）")
      .replace(/（([^）]*?)([\u4e00-\u9fa5]{2,4})审核([^）]*?)）/g, "（$1$2$3）")
      .replace(/（([^）]*?)([\u4e00-\u9fa5]{2,4})牵头([^）]*?)）/g, "（$1$2$3）");

    return next;
  };

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    setGeneratingModel("AI");
    setDraft("");
    setActivePlanId(null);
    let accumulated = "";

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-evaluation-plan`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 120_000);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          project, group, members, tasks,
          system: system ? { name: system.name } : null,
          indicators,
        }),
      }).finally(() => window.clearTimeout(timeout));

      if (resp.status === 429) {
        toast.error("AI 请求过于频繁，请稍后再试");
        return;
      }
      if (resp.status === 402) {
        toast.error("AI 额度不足，请充值后再试");
        return;
      }
      if (!resp.ok || !resp.body) {
        const t = await resp.text().catch(() => "");
        throw new Error(t || `服务异常 (${resp.status})`);
      }

      const responseModel = resp.headers.get("X-AI-Model") || "AI";
      setGeneratingModel(responseModel);
      const injectedTags = [
        Number(resp.headers.get("X-Rag-Overview") || 0) > 0 && `资料全景×${resp.headers.get("X-Rag-Overview")}`,
        Number(resp.headers.get("X-Rag-Priority-Chunks") || 0) > 0 && `重点片段×${resp.headers.get("X-Rag-Priority-Chunks")}`,
        Number(resp.headers.get("X-Rag-Knowledge") || 0) > 0 && `资料×${resp.headers.get("X-Rag-Knowledge")}`,
        Number(resp.headers.get("X-Rag-Materials") || 0) > 0 && `资料×${resp.headers.get("X-Rag-Materials")}`,
        Number(resp.headers.get("X-Rag-History") || 0) > 0 && `历史×${resp.headers.get("X-Rag-History")}`,
        Number(resp.headers.get("X-Rag-Goals") || 0) > 0 && `目标×${resp.headers.get("X-Rag-Goals")}`,
      ].filter(Boolean).join(" · ");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;

      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") {
            done = true;
            break;
          }
          try {
            const p = JSON.parse(j);
            const c = p.choices?.[0]?.delta?.content;
            if (c) {
              accumulated += c;
              setDraft(normalizePlanPersonNames(accumulated));
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }

      const finalContent = normalizePlanPersonNames(accumulated);
      if (!finalContent.trim()) throw new Error("AI 返回内容为空");

      const title = `${project.name} · 评估实施方案 · ${new Date().toLocaleDateString("zh-CN")}`;
      const { data: ins, error: insErr } = await supabase.from("evaluation_plans").insert({
        title,
        content: finalContent,
        project_id: project.id,
        group_id: group.id,
        ai_model: responseModel,
        status: "draft",
        created_by: user.id,
      }).select().single();
      if (insErr) throw insErr;

      toast.success(`评估方案已生成并保存${injectedTags ? ` · 已注入 ${injectedTags}` : ""}`);
      setDraft("");
      setActivePlanId((ins as PlanRecord).id);
      loadPlans();
    } catch (e: any) {
      console.error(e);
      setDraft("");
      toast.error(e?.name === "AbortError" ? "生成超时，请重试" : e?.message ?? "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const remove = async (id: string) => {
    if (!(await confirm({
      title: "确认删除该评估方案？",
      description: "AI 生成的方案内容将被永久删除，此操作不可撤销。",
      destructive: true,
      confirmText: "删除方案",
    }))) return;
    const { error } = await supabase.from("evaluation_plans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (activePlanId === id) setActivePlanId(null);
    loadPlans();
  };

  const copyPlan = async (text: string) => {
    await navigator.clipboard.writeText(normalizePlanPersonNames(text));
    toast.success("已复制方案全文");
  };

  const downloadPlan = async (p: PlanRecord) => {
    const [{ createTextDocxBlob }, { saveAs }] = await Promise.all([
      import("@/lib/generatedDocx"),
      import("file-saver"),
    ]);
    const blob = await createTextDocxBlob(p.title, normalizePlanPersonNames(p.content));
    saveAs(blob, `${p.title.replace(/[\\/:*?"<>|]/g, "_")}.docx`);
    toast.success("评估方案 Word 已导出");
  };

  const startEdit = () => {
    if (!active) return;
    const next = normalizePlanPersonNames(active.content);
    editTextRef.current = next;
    setEditText(next);
    setEditingContent(true);
  };

  const cancelEdit = () => {
    const next = normalizePlanPersonNames(active?.content ?? "");
    editTextRef.current = next;
    setEditText(next);
    setEditingContent(false);
  };

  const savePlan = async () => {
    if (!active) return;
    const nextContent = normalizePlanPersonNames(editTextRef.current);
    if (!nextContent.trim()) return toast.error("方案内容不能为空");
    const { data, error } = await supabase
      .from("evaluation_plans")
      .update({ content: nextContent })
      .eq("id", active.id)
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    const nextPlan = data as PlanRecord;
    setPlans((current) => current.map((plan) => (plan.id === nextPlan.id ? nextPlan : plan)));
    editTextRef.current = normalizePlanPersonNames(nextPlan.content);
    setEditText(editTextRef.current);
    toast.success("方案修改已保存");
    setEditingContent(false);
  };

  const active = plans.find(p => p.id === activePlanId) ?? plans[0] ?? null;
  const activeContent = normalizePlanPersonNames(active?.content ?? "");
  const showContent = draft || (editingContent ? editText : activeContent) || "";

  useEffect(() => {
    if (!active?.id || editingContent || draft) return;
    const next = normalizePlanPersonNames(active.content);
    editTextRef.current = next;
    setEditText(next);
  }, [active?.id, active?.content, editingContent, draft]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap p-4 rounded-lg border border-border bg-gradient-to-br from-card to-muted/30">
        <Button onClick={generate} variant="hero" disabled={generating}>
          {generating
            ? <><Loader2 className="h-4 w-4 animate-spin" />AI 撰写中…</>
            : <><Sparkles className="h-4 w-4" />{plans.length ? "再次生成" : "AI 一键生成评估方案"}</>}
        </Button>
        {generating && (
          <span className="text-xs font-mono text-accent flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            STREAMING · {generatingModel}
          </span>
        )}
        <div className="ml-auto text-xs font-mono text-muted-foreground tabular-nums">
          指标体系：<span className="text-foreground">{system?.name ?? "（未关联）"}</span>
          {system && <span className="ml-2">· 指标 {indicators.length}</span>}
          <span className="ml-2">· 成员 {members.length}</span>
          <span className="ml-2">· 任务 {tasks.length}</span>
        </div>
      </div>

      {!system && (
        <div className="flex items-start gap-2 p-3 rounded-md border border-gold/30 bg-gold/8 text-sm">
          <AlertCircle className="h-4 w-4 text-gold shrink-0 mt-0.5" />
          <div className="text-foreground/80">
            建议先到 <span className="font-mono text-accent">评估对象管理</span> 给本项目关联评估指标体系，再生成方案，AI 会自动写入第四章「评估指标体系」。
          </div>
        </div>
      )}

      {plans.length > 0 && (
        <Card className="surface-card">
          <div className="px-4 py-3 border-b border-border bg-muted/20 text-sm font-medium">历史方案</div>
          <div className="p-4 flex items-center gap-2 flex-wrap">
            {plans.map(p => (
              <button
                key={p.id}
                onClick={() => { setDraft(""); setEditingContent(false); setActivePlanId(p.id); }}
                className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-mono border transition-all ${
                  activePlanId === p.id && !draft
                    ? "border-accent bg-accent/10 text-accent shadow-[0_0_8px_hsl(var(--accent)/0.3)]"
                    : "border-border hover:border-accent/40"
                }`}
              >
                <FileText className="h-3 w-3" />
                <span className="tabular-nums">{new Date(p.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                <Trash2
                  className="h-3 w-3 opacity-0 group-hover:opacity-100 text-destructive transition-opacity"
                  onClick={(e) => { e.stopPropagation(); remove(p.id); }}
                />
              </button>
            ))}
          </div>
        </Card>
      )}

      {!showContent ? (
        <Card className="surface-card p-0">
          <EmptyState
            icon={Sparkles}
            title="尚未生成评估方案"
            hint="点击上方「AI 一键生成评估方案」，AI 将根据项目信息、工作组成员、时间任务、评估指标体系自动撰写一份不少于 800 字的正式实施方案"
          />
        </Card>
      ) : (
        <Card className="surface-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">EVALUATION PLAN</span>
              {generating
                ? <StatusPill tone="info">实时生成中</StatusPill>
                : active && <StatusPill tone="success" dot={false}>{active.ai_model ?? "AI"}</StatusPill>}
            </div>
            <div className="flex items-center gap-1">
              {generating ? (
                <>
                  <Button size="sm" variant="ghost" disabled title="请等待评估方案生成完成并保存后再编辑">
                    <Pencil className="h-3.5 w-3.5" />在线编辑
                  </Button>
                  <Button size="sm" variant="ghost" disabled title="请等待评估方案生成完成并保存后再导出">
                    <Download className="h-3.5 w-3.5" />导出 Word
                  </Button>
                </>
              ) : active ? (
                editingContent ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={savePlan}><Save className="h-3.5 w-3.5" />保存修改</Button>
                    <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="h-3.5 w-3.5" />取消</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={startEdit}><Pencil className="h-3.5 w-3.5" />在线编辑</Button>
                    <Button size="sm" variant="ghost" onClick={() => copyPlan(active.content)}><Copy className="h-3.5 w-3.5" />复制</Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadPlan(active)}><Download className="h-3.5 w-3.5" />导出 Word</Button>
                    <Button size="sm" variant="ghost" onClick={generate}><RefreshCw className="h-3.5 w-3.5" />重生成</Button>
                  </>
                )
              ) : null}
            </div>
          </div>
          <div className="p-6 max-h-[640px] overflow-auto">
            {editingContent && active && !draft ? (
              <RichTextEditor
                value={editText}
                onChange={(value) => {
                  editTextRef.current = value;
                  setEditText(value);
                }}
              />
            ) : (
              <MarkdownView content={showContent} cursor={!!draft} />
            )}
          </div>
        </Card>
      )}
      <ConfirmDialog />
    </div>
  );
};

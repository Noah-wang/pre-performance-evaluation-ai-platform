import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Search, FolderKanban, BookUser, FileSearch, FileText,
  ClipboardList, ScrollText, Layers, Users, LayoutDashboard, Archive,
} from "lucide-react";

type SearchHit = {
  id: string;
  type: "project" | "expert" | "material" | "report" | "field" | "meeting" | "plan" | "group";
  title: string;
  subtitle?: string;
  url: string;
};

const TYPE_META: Record<SearchHit["type"], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  project:  { label: "评估对象", icon: FolderKanban },
  expert:   { label: "专家",     icon: BookUser },
  material: { label: "资料",     icon: FileSearch },
  report:   { label: "报告",     icon: FileText },
  field:    { label: "现场调研", icon: ClipboardList },
  meeting:  { label: "会议纪要", icon: ScrollText },
  plan:     { label: "评估方案", icon: Layers },
  group:    { label: "工作组",   icon: Users },
};

const QUICK_NAV: SearchHit[] = [
  { id: "nav-home",     type: "project",  title: "工作台",         url: "/" },
  { id: "nav-projects", type: "project",  title: "评估对象管理",   url: "/projects" },
  { id: "nav-groups",   type: "group",    title: "工作组与方案",   url: "/work-groups" },
  { id: "nav-experts",  type: "expert",   title: "专家库管理",     url: "/experts" },
  { id: "nav-mat",      type: "material", title: "资料收集审核",   url: "/materials" },
  { id: "nav-eval",     type: "plan",     title: "评估指标体系",   url: "/evaluation-system" },
  { id: "nav-field",    type: "field",    title: "现场调研记录",   url: "/field-research" },
  { id: "nav-meet",     type: "meeting",  title: "预评估与正式评估", url: "/evaluations" },
  { id: "nav-rep",      type: "report",   title: "评估报告（AI）", url: "/reports" },
  { id: "nav-arch",     type: "report",   title: "结果应用与项目库", url: "/archive" },
];

export const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 1) {
      setHits([]);
      return;
    }
    setLoading(true);
    const like = `%${q.trim()}%`;
    try {
      const [projects, experts, materials, reports, fields, meetings, plans, groups] = await Promise.all([
        supabase.from("projects").select("id,name,unit,category").or(`name.ilike.${like},unit.ilike.${like},category.ilike.${like}`).limit(8),
        supabase.from("experts").select("id,name,organization,specialty").or(`name.ilike.${like},organization.ilike.${like},specialty.ilike.${like}`).limit(8),
        supabase.from("materials").select("id,name,project_id,status").ilike("name", like).limit(8),
        supabase.from("reports").select("id,title,project_id,status").or(`title.ilike.${like},content.ilike.${like}`).limit(8),
        supabase.from("field_records").select("id,location,project_id,findings").or(`location.ilike.${like},findings.ilike.${like}`).limit(6),
        supabase.from("meeting_minutes").select("id,title,project_id").or(`title.ilike.${like},content.ilike.${like}`).limit(6),
        supabase.from("evaluation_plans").select("id,title,project_id,status").ilike("title", like).limit(6),
        supabase.from("work_groups").select("id,name,project_id,leader").or(`name.ilike.${like},leader.ilike.${like}`).limit(6),
      ]);

      const all: SearchHit[] = [
        ...(projects.data ?? []).map((r) => ({ id: r.id, type: "project" as const, title: r.name, subtitle: [r.unit, r.category].filter(Boolean).join(" · "), url: "/projects" })),
        ...(experts.data ?? []).map((r) => ({ id: r.id, type: "expert" as const, title: r.name, subtitle: [r.organization, r.specialty].filter(Boolean).join(" · "), url: "/experts" })),
        ...(materials.data ?? []).map((r) => ({ id: r.id, type: "material" as const, title: r.name, subtitle: `状态: ${r.status}`, url: "/materials" })),
        ...(reports.data ?? []).map((r) => ({ id: r.id, type: "report" as const, title: r.title, subtitle: `状态: ${r.status}`, url: "/reports" })),
        ...(fields.data ?? []).map((r) => ({ id: r.id, type: "field" as const, title: r.location, subtitle: r.findings?.slice(0, 50), url: "/field-research" })),
        ...(meetings.data ?? []).map((r) => ({ id: r.id, type: "meeting" as const, title: r.title, url: "/evaluations" })),
        ...(plans.data ?? []).map((r) => ({ id: r.id, type: "plan" as const, title: r.title, subtitle: `状态: ${r.status}`, url: "/work-groups" })),
        ...(groups.data ?? []).map((r) => ({ id: r.id, type: "group" as const, title: r.name, subtitle: r.leader ? `负责人: ${r.leader}` : undefined, url: "/work-groups" })),
      ];
      setHits(all);
    } finally {
      setLoading(false);
    }
  }, []);

  // debounce
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 220);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const go = (url: string) => {
    setOpen(false);
    setQuery("");
    setHits([]);
    navigate(url);
  };

  // group hits by type
  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.type] ||= []).push(h);
    return acc;
  }, {});

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 h-8 px-3 text-muted-foreground hover:text-foreground border border-border/60 rounded-md bg-background/40"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">搜索…</span>
        <kbd className="ml-2 inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono">
          ⌘K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="md:hidden h-8 w-8 text-muted-foreground"
        aria-label="搜索"
      >
        <Search className="h-4 w-4" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <VisuallyHidden.Root>
          <DialogTitle>全局搜索</DialogTitle>
          <DialogDescription>搜索项目、专家、资料、报告等所有业务数据</DialogDescription>
        </VisuallyHidden.Root>
        <CommandInput
          placeholder="搜索项目、专家、资料、报告…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {loading && <div className="px-4 py-3 text-xs text-muted-foreground">搜索中…</div>}
          {!loading && query && hits.length === 0 && (
            <CommandEmpty>未找到与 "{query}" 相关的内容</CommandEmpty>
          )}

          {!query && (
            <CommandGroup heading="快速导航">
              {QUICK_NAV.map((n) => {
                const Icon = TYPE_META[n.type].icon;
                const NavIcon = n.id === "nav-home" ? LayoutDashboard
                              : n.id === "nav-arch" ? Archive
                              : Icon;
                return (
                  <CommandItem
                    key={n.id}
                    value={n.id + " " + n.title}
                    onSelect={() => go(n.url)}
                    className="cursor-pointer"
                  >
                    <NavIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{n.title}</span>
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">{n.url}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {query && Object.entries(grouped).map(([type, items], idx) => {
            const meta = TYPE_META[type as SearchHit["type"]];
            const Icon = meta.icon;
            return (
              <div key={type}>
                {idx > 0 && <CommandSeparator />}
                <CommandGroup heading={`${meta.label} (${items.length})`}>
                  {items.map((h) => (
                    <CommandItem
                      key={h.id}
                      value={`${h.type}-${h.id}-${h.title}-${h.subtitle ?? ""}`}
                      onSelect={() => go(h.url)}
                      className="cursor-pointer"
                    >
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate text-sm">{h.title}</span>
                        {h.subtitle && (
                          <span className="truncate text-[11px] text-muted-foreground">{h.subtitle}</span>
                        )}
                      </div>
                      <span className="ml-2 text-[10px] font-mono text-muted-foreground shrink-0">
                        {h.url}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            );
          })}
        </CommandList>
        <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span><kbd className="px-1 py-0.5 border border-border rounded">↑↓</kbd> 导航</span>
          <span><kbd className="px-1 py-0.5 border border-border rounded">↵</kbd> 跳转</span>
          <span><kbd className="px-1 py-0.5 border border-border rounded">Esc</kbd> 关闭</span>
        </div>
      </CommandDialog>
    </>
  );
};

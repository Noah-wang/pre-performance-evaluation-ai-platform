import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, BookMarked, Library, Copy, FolderKanban, Database, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StatusPill, StatTile } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { PermissionGate } from "@/components/PermissionGate";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

interface Goal {
  id: string;
  parent_goal_id?: string | null;
  category: string | null;
  level: number;
  code: string | null;
  name: string;
  weight: number;
  scoring_method: string | null;
  required_materials: string | null;
  notes: string | null;
  usage_count: number;
  created_by: string;
  created_at: string;
  source_indicator_id?: string | null;
  source_system_id?: string | null;
}

interface GoalProject {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  description: string | null;
  evaluation_system_id: string | null;
  fiscal_year: number;
  custom_fields: unknown;
}

interface ProjectGoal {
  id: string;
  source_goal_id?: string | null;
  parent_id?: string | null;
  category: string | null;
  level: number;
  code: string | null;
  name: string;
  weight: number | null;
  scoring_method: string | null;
  required_materials: string | null;
  notes: string | null;
}

const CATEGORIES = ["基础设施", "民生工程", "信息化", "产业发展", "生态环保", "其他"];

const empty = {
  category: "民生工程",
  level: 1 as 1 | 2 | 3,
  parent_goal_id: "",
  code: "",
  name: "",
  weight: 0,
  scoring_method: "",
  required_materials: "",
  notes: "",
};

const createProjectGoal = (category?: string | null): ProjectGoal => ({
  id: crypto.randomUUID(),
  source_goal_id: null,
  parent_id: null,
  category: category ?? "其他",
  level: 1,
  code: "",
  name: "",
  weight: null,
  scoring_method: "",
  required_materials: "",
  notes: "",
});

const normalizeProjectGoal = (
  raw: unknown,
  fallbackCategory?: string | null,
): ProjectGoal | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const name = String(entry.name ?? "").trim();
  if (!name) return null;
  const levelNumber = Number(entry.level);
  const level = [1, 2, 3].includes(levelNumber) ? levelNumber : 1;
  return {
    id: String(entry.id ?? crypto.randomUUID()),
    source_goal_id: String(entry.source_goal_id ?? "").trim() || null,
    parent_id: String(entry.parent_id ?? entry.parent_goal_id ?? "").trim() || null,
    category: String(entry.category ?? fallbackCategory ?? "其他"),
    level,
    code: String(entry.code ?? "").trim() || null,
    name,
    weight: Number.isFinite(Number(entry.weight)) ? Number(entry.weight) : 0,
    scoring_method: String(entry.scoring_method ?? "").trim() || null,
    required_materials: String(entry.required_materials ?? "").trim() || null,
    notes: String(entry.notes ?? "").trim() || null,
  };
};

const parseProjectGoals = (
  customFields: unknown,
  fallbackCategory?: string | null,
): ProjectGoal[] => {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return [];
  const record = customFields as Record<string, unknown>;
  if (!Array.isArray(record.performance_targets)) return [];
  return record.performance_targets
    .map((item) => normalizeProjectGoal(item, fallbackCategory))
    .filter((item): item is ProjectGoal => Boolean(item));
};

type HierarchyGoal = {
  id: string;
  parent_id?: string | null;
  parent_goal_id?: string | null;
  category?: string | null;
  level: number;
  code?: string | null;
  name: string;
};

interface HierarchyRow<T extends HierarchyGoal> {
  item: T;
  depth: number;
  parent: T | null;
  orphan: boolean;
  childrenCount: number;
}

const GOAL_LEVEL_META = {
  1: {
    label: "一级目标",
    role: "项目最终承诺",
    marker: "一",
    tone: "gold" as const,
    cardClass: "border-gold/30 bg-gradient-to-br from-gold/10 via-background to-background",
    nodeClass: "h-10 w-10 border-gold/40 bg-gold/15 text-gold-soft",
    nameClass: "text-base font-semibold",
  },
  2: {
    label: "二级目标",
    role: "分类目标",
    marker: "二",
    tone: "info" as const,
    cardClass: "border-accent/25 bg-gradient-to-br from-accent/8 via-background to-background",
    nodeClass: "h-9 w-9 border-accent/35 bg-accent/10 text-accent",
    nameClass: "text-sm font-semibold",
  },
  3: {
    label: "三级目标",
    role: "具体衡量项",
    marker: "三",
    tone: "neutral" as const,
    cardClass: "border-border bg-background/90",
    nodeClass: "h-8 w-8 border-border bg-muted/60 text-muted-foreground",
    nameClass: "text-sm font-medium",
  },
};

const goalLevelMeta = (level: number) => GOAL_LEVEL_META[(level as 1 | 2 | 3)] ?? GOAL_LEVEL_META[1];

const compactText = (value?: string | null, maxLength = 46) => {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

const projectGoalsSnapshot = (goals: ProjectGoal[]) =>
  JSON.stringify(goals.map((goal) => ({
    id: goal.id,
    source_goal_id: goal.source_goal_id ?? null,
    parent_id: goal.parent_id ?? null,
    category: goal.category ?? null,
    level: goal.level,
    code: goal.code ?? null,
    name: goal.name,
    weight: goal.weight ?? 0,
    scoring_method: goal.scoring_method ?? null,
    required_materials: goal.required_materials ?? null,
    notes: goal.notes ?? null,
  })));

const codeTokens = (code?: string | null) =>
  (code ?? "")
    .trim()
    .match(/[A-Za-z]+|\d+/g)
    ?.map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase())) ?? [];

const isCodePrefix = (parent: HierarchyGoal, child: HierarchyGoal) => {
  const parentTokens = codeTokens(parent.code);
  const childTokens = codeTokens(child.code);
  if (!parentTokens.length || childTokens.length <= parentTokens.length) return false;
  return parentTokens.every((token, index) => childTokens[index] === token);
};

const compareTokenArrays = (a: Array<string | number>, b: Array<string | number>) => {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;
    if (typeof a[index] === "number" && typeof b[index] === "number") return Number(a[index]) - Number(b[index]);
    return String(a[index]).localeCompare(String(b[index]), "zh-Hans-CN", { numeric: true });
  }
  return 0;
};

const buildHierarchyRows = <T extends HierarchyGoal>(
  items: T[],
  options: { allowFallbackByOrder?: boolean } = {},
): HierarchyRow<T>[] => {
  const originalIndex = new Map(items.map((item, index) => [item.id, index]));
  const byId = new Map(items.map((item) => [item.id, item]));
  const sortedForInference = [...items].sort((a, b) => (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0));

  const findParent = (item: T): T | null => {
    if (item.level <= 1) return null;
    const explicitParentId = item.parent_id ?? item.parent_goal_id;
    if (explicitParentId && byId.has(explicitParentId)) {
      const parent = byId.get(explicitParentId)!;
      if (parent.level === item.level - 1) return parent;
    }

    const codeMatched = items
      .filter((candidate) => candidate.level === item.level - 1 && isCodePrefix(candidate, item))
      .sort((a, b) => codeTokens(b.code).length - codeTokens(a.code).length)[0];
    if (codeMatched) return codeMatched;

    if (options.allowFallbackByOrder) {
      const itemIndex = originalIndex.get(item.id) ?? -1;
      for (let index = itemIndex - 1; index >= 0; index -= 1) {
        const candidate = sortedForInference[index];
        if (candidate?.level === item.level - 1) return candidate;
      }
    }

    return null;
  };

  const parentById = new Map<string, T | null>();
  const childrenByParentId = new Map<string, T[]>();
  const roots: T[] = [];

  items.forEach((item) => {
    const parent = findParent(item);
    parentById.set(item.id, parent);
    if (parent) {
      const children = childrenByParentId.get(parent.id) ?? [];
      children.push(item);
      childrenByParentId.set(parent.id, children);
    } else {
      roots.push(item);
    }
  });

  const compareGoals = (a: T, b: T) => {
    const tokenCompare = compareTokenArrays(codeTokens(a.code), codeTokens(b.code));
    if (tokenCompare) return tokenCompare;
    if (a.level !== b.level) return a.level - b.level;
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  };

  const rows: HierarchyRow<T>[] = [];
  const visit = (item: T, depth: number) => {
    const parent = parentById.get(item.id) ?? null;
    const children = (childrenByParentId.get(item.id) ?? []).sort(compareGoals);
    rows.push({
      item,
      depth,
      parent,
      orphan: item.level > 1 && !parent,
      childrenCount: children.length,
    });
    children.forEach((child) => visit(child, depth + 1));
  };

  roots
    .sort(compareGoals)
    .forEach((item) => visit(item, Math.max(0, item.level > 1 ? item.level - 1 : 0)));

  return rows;
};

const GoalLibrary = () => {
  const { user } = useAuth();
  const { canManage } = usePermissions();
  const { confirm, ConfirmDialog } = useConfirm();
  const [list, setList] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<GoalProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectGoals, setProjectGoals] = useState<ProjectGoal[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState(empty);
  const [savingProjectGoals, setSavingProjectGoals] = useState(false);
  const [savingProjectDraft, setSavingProjectDraft] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [highlightLibrary, setHighlightLibrary] = useState(false);
  const [activeProjectGoalId, setActiveProjectGoalId] = useState("");
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const previousProjectIdRef = useRef("");
  const librarySectionRef = useRef<HTMLDivElement | null>(null);

  const activeProject = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projectId, projects],
  );
  const activeProjectGoal = projectGoals.find((goal) => goal.id === activeProjectGoalId) ?? projectGoals[0] ?? null;

  const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
  const buildFingerprint = (goal: { level: number; code?: string | null; name: string }) =>
    `${goal.level}::${normalize(goal.code)}::${normalize(goal.name)}`;

  const load = async () => {
    const [{ data, error }, { data: projectRows, error: projectError }] = await Promise.all([
      supabase.from("goal_library").select("*").order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id,name,unit,category,description,evaluation_system_id,fiscal_year,custom_fields")
        .order("created_at", { ascending: false }),
    ]);
    if (error) return toast.error(error.message);
    if (projectError) return toast.error(projectError.message);
    setList((data as Goal[]) ?? []);
    const nextProjects = (projectRows as GoalProject[]) ?? [];
    setProjects(nextProjects);
    if (!projectId && nextProjects.length) {
      setProjectId(nextProjects[0].id);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const parsed = parseProjectGoals(activeProject?.custom_fields, activeProject?.category);
    const nextProjectId = activeProject?.id ?? "";
    const isSameProject = previousProjectIdRef.current === nextProjectId;
    previousProjectIdRef.current = nextProjectId;
    lastSavedSnapshotRef.current = projectGoalsSnapshot(parsed);
    setAutoSaveStatus(parsed.length ? "saved" : "idle");
    setLastSavedAt(null);
    setProjectGoals(parsed);
    setActiveProjectGoalId((current) => {
      if (isSameProject && current && parsed.some((goal) => goal.id === current)) return current;
      return parsed[0]?.id ?? "";
    });
  }, [activeProject?.id, activeProject?.custom_fields, activeProject?.category]);

  const handleProjectChange = (nextProjectId: string) => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    setProjectId(nextProjectId);
    setProjectGoals([]);
    setActiveProjectGoalId("");
    setAutoSaveStatus("idle");
    setLastSavedAt(null);
    lastSavedSnapshotRef.current = "";
  };

  useEffect(() => {
    if (!activeProject || !user || !canManage) return;
    const snapshot = projectGoalsSnapshot(projectGoals);
    if (snapshot === lastSavedSnapshotRef.current) return;

    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    if (projectGoals.some((goal) => !goal.name.trim())) {
      setAutoSaveStatus("idle");
      return;
    }

    setAutoSaveStatus("saving");
    autoSaveTimerRef.current = window.setTimeout(async () => {
      const ok = await saveProjectGoalsToProject(projectGoals, undefined, { silent: true });
      setAutoSaveStatus(ok ? "saved" : "error");
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectGoals, activeProject?.id, canManage, user?.id]);

  const sourceIndicatorIds = useMemo(
    () => new Set(list.map((goal) => goal.source_indicator_id).filter(Boolean) as string[]),
    [list],
  );
  const fingerprints = useMemo(
    () => new Set(list.map((goal) => buildFingerprint(goal))),
    [list],
  );
  const isGoalStored = (goal: ProjectGoal) =>
    sourceIndicatorIds.has(goal.id) || fingerprints.has(buildFingerprint(goal));

  const projectGoalRows = useMemo(
    () => buildHierarchyRows(projectGoals, { allowFallbackByOrder: true }),
    [projectGoals],
  );
  const libraryRows = useMemo(
    () => buildHierarchyRows(list),
    [list],
  );
  const libraryParentCandidates = useMemo(
    () => list.filter((goal) => goal.level === form.level - 1 && goal.id !== editing?.id),
    [editing?.id, form.level, list],
  );

  const saveProjectGoalsToProject = async (
    goals: ProjectGoal[],
    successMessage?: string,
    options: { silent?: boolean } = {},
  ) => {
    if (!user || !activeProject) return false;
    const validGoals = goals
      .map((goal) => normalizeProjectGoal(goal, activeProject.category))
      .filter((goal): goal is ProjectGoal => Boolean(goal));
    setSavingProjectDraft(true);
    const customFields = (
      activeProject.custom_fields && typeof activeProject.custom_fields === "object" && !Array.isArray(activeProject.custom_fields)
        ? activeProject.custom_fields as Record<string, unknown>
        : {}
    );
    const payload = {
      ...customFields,
      performance_targets: validGoals,
    };
    const { data, error } = await supabase
      .from("projects")
      .update({ custom_fields: payload })
      .eq("id", activeProject.id)
      .select("id,name,unit,category,description,evaluation_system_id,fiscal_year,custom_fields")
      .single();
    setSavingProjectDraft(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    const nextProject = data as GoalProject;
    setProjects((current) => current.map((project) => (project.id === nextProject.id ? nextProject : project)));
    setProjectGoals(validGoals);
    lastSavedSnapshotRef.current = projectGoalsSnapshot(validGoals);
    setLastSavedAt(new Date());
    if (!options.silent) toast.success(successMessage ?? `已保存 ${validGoals.length} 项项目绩效目标`);
    return true;
  };

  const parentCandidatesFor = (goal: ProjectGoal) =>
    projectGoals.filter((candidate) => candidate.id !== goal.id && candidate.level === goal.level - 1);

  const changeProjectGoalLevel = (id: string, nextLevel: number) => {
    setProjectGoals((current) => current.map((goal) => {
      if (goal.id !== id) return goal;
      const parentStillValid = current.some((candidate) => candidate.id === goal.parent_id && candidate.level === nextLevel - 1);
      return {
        ...goal,
        level: nextLevel,
        parent_id: nextLevel > 1 && parentStillValid ? goal.parent_id : null,
      };
    }));
  };

  const reset = () => { setForm(empty); setEditing(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) return toast.error("指标名称必填");
    const payload: any = {
      category: form.category,
      level: form.level,
      parent_goal_id: form.level === 1 ? null : form.parent_goal_id || null,
      code: form.code.trim() || null,
      name: form.name.trim(),
      weight: Number(form.weight) || 0,
      scoring_method: form.scoring_method.trim() || null,
      required_materials: form.required_materials.trim() || null,
      notes: form.notes.trim() || null,
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from("goal_library").update(payload).eq("id", editing.id));
    } else {
      payload.created_by = user.id;
      ({ error } = await supabase.from("goal_library").insert(payload));
    }
    if (error) return toast.error(error.message);
    toast.success(editing ? "已更新" : "已加入目标库");
    setOpen(false);
    reset();
    load();
  };

  const updateProjectGoal = <K extends keyof ProjectGoal>(id: string, field: K, value: ProjectGoal[K]) => {
    setProjectGoals((current) => current.map((goal) => (goal.id === id ? { ...goal, [field]: value } : goal)));
  };

  const addProjectGoal = (parent?: ProjectGoal | null) => {
    if (!activeProject) return;
    const parentLevel = parent ? Math.min(parent.level + 1, 3) : 1;
    const nextGoal: ProjectGoal = {
      ...createProjectGoal(parent?.category ?? activeProject.category),
      level: parentLevel,
      parent_id: parent && parentLevel > 1 ? parent.id : null,
    };
    setProjectGoals((current) => [...current, nextGoal]);
    setActiveProjectGoalId(nextGoal.id);
  };

  const removeProjectGoal = (id: string) => {
    setProjectGoals((current) => {
      const next = current
        .filter((goal) => goal.id !== id)
        .map((goal) => (goal.parent_id === id ? { ...goal, parent_id: null } : goal));
      return next;
    });
    if (activeProjectGoalId === id) {
      const nextActive = projectGoals.find((goal) => goal.id !== id)?.id ?? "";
      setActiveProjectGoalId(nextActive);
    }
  };

  const saveProjectGoalsToLibrary = async (goals: ProjectGoal[]) => {
    if (!user || !activeProject || !goals.length) return;
    setSavingProjectGoals(true);
    const projectGoalById = new Map(projectGoals.map((goal) => [goal.id, goal]));
    const goalsWithAncestors = new Map<string, ProjectGoal>();
    const collectWithAncestors = (goal: ProjectGoal) => {
      if (goal.parent_id) {
        const parent = projectGoalById.get(goal.parent_id);
        if (parent) collectWithAncestors(parent);
      }
      goalsWithAncestors.set(goal.id, goal);
    };
    goals.forEach(collectWithAncestors);

    const validGoals = Array.from(goalsWithAncestors.values())
      .map((goal) => normalizeProjectGoal(goal, activeProject.category))
      .filter((goal): goal is ProjectGoal => Boolean(goal) && !isGoalStored(goal))
      .sort((a, b) => a.level - b.level);

    if (!validGoals.length) {
      setSavingProjectGoals(false);
      toast.info("所选目标已在目标库中，无需重复沉淀");
      return;
    }

    const existingLibraryByProjectGoal = (goal: ProjectGoal) => {
      if (goal.source_goal_id) {
        const bySource = list.find((libraryGoal) => libraryGoal.id === goal.source_goal_id);
        if (bySource) return bySource;
      }
      return list.find((libraryGoal) => buildFingerprint(libraryGoal) === buildFingerprint(goal)) ?? null;
    };

    const insertedLibraryIdsByProjectId = new Map<string, string>();
    const insertedLibraryIdsByFingerprint = new Map<string, string>();
    let savedCount = 0;

    try {
      for (const goal of validGoals) {
        const parentProjectGoal = goal.parent_id ? projectGoalById.get(goal.parent_id) : null;
        const parentGoalId = parentProjectGoal
          ? insertedLibraryIdsByProjectId.get(parentProjectGoal.id)
            ?? insertedLibraryIdsByFingerprint.get(buildFingerprint(parentProjectGoal))
            ?? existingLibraryByProjectGoal(parentProjectGoal)?.id
            ?? null
          : null;

        const { data, error } = await supabase.from("goal_library").insert({
          category: goal.category ?? activeProject.category,
          level: goal.level,
          parent_goal_id: goal.level === 1 ? null : parentGoalId,
          code: goal.code,
          name: goal.name,
          weight: Number(goal.weight) || 0,
          scoring_method: goal.scoring_method,
          required_materials: goal.required_materials,
          source_system_id: activeProject.evaluation_system_id,
          source_indicator_id: null,
          created_by: user.id,
          notes: [goal.notes, `沉淀自项目：${activeProject.name}`].filter(Boolean).join("｜"),
        }).select("*").single();
        if (error) throw error;
        const inserted = data as Goal;
        insertedLibraryIdsByProjectId.set(goal.id, inserted.id);
        insertedLibraryIdsByFingerprint.set(buildFingerprint(goal), inserted.id);
        savedCount += 1;
      }
    } catch (error: any) {
      setSavingProjectGoals(false);
      return toast.error(error?.message ?? "沉淀目标失败");
    }

    setSavingProjectGoals(false);
    toast.success(`已沉淀 ${savedCount} 项绩效目标`);
    await load();
    setHighlightLibrary(true);
    window.setTimeout(() => setHighlightLibrary(false), 1800);
    window.setTimeout(() => {
      librarySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const applyLibraryGoalToProject = async (goal: Goal) => {
    if (!activeProject) return toast.error("请先选择要应用到的项目");
    if (!canManage) return toast.error("当前账号没有修改项目目标的权限");

    const rowById = new Map(libraryRows.map((row) => [row.item.id, row]));
    const childrenByParentId = new Map<string, Goal[]>();
    libraryRows.forEach((row) => {
      if (!row.parent) return;
      const children = childrenByParentId.get(row.parent.id) ?? [];
      children.push(row.item);
      childrenByParentId.set(row.parent.id, children);
    });

    const selectedIds = new Set<string>();
    const collectAncestors = (item: Goal) => {
      const parent = rowById.get(item.id)?.parent;
      if (parent) collectAncestors(parent);
      selectedIds.add(item.id);
    };
    const collectDescendants = (item: Goal) => {
      selectedIds.add(item.id);
      (childrenByParentId.get(item.id) ?? []).forEach(collectDescendants);
    };

    collectAncestors(goal);
    collectDescendants(goal);

    const orderedLibraryGoals = libraryRows
      .filter((row) => selectedIds.has(row.item.id))
      .map((row) => row.item);
    const existingBySourceId = new Map(
      projectGoals
        .filter((item) => item.source_goal_id)
        .map((item) => [item.source_goal_id as string, item]),
    );
    const existingByFingerprint = new Map(projectGoals.map((item) => [buildFingerprint(item), item]));
    const projectIdByLibraryId = new Map<string, string>();
    const additions: ProjectGoal[] = [];

    orderedLibraryGoals.forEach((libraryGoal) => {
      const existing = existingBySourceId.get(libraryGoal.id) ?? existingByFingerprint.get(buildFingerprint(libraryGoal));
      if (existing) {
        projectIdByLibraryId.set(libraryGoal.id, existing.id);
        return;
      }

      const parent = rowById.get(libraryGoal.id)?.parent ?? null;
      const existingParent = parent
        ? existingBySourceId.get(parent.id) ?? existingByFingerprint.get(buildFingerprint(parent))
        : null;
      const nextId = crypto.randomUUID();
      projectIdByLibraryId.set(libraryGoal.id, nextId);
      additions.push({
        id: nextId,
        source_goal_id: libraryGoal.id,
        parent_id: parent ? projectIdByLibraryId.get(parent.id) ?? existingParent?.id ?? null : null,
        category: libraryGoal.category ?? activeProject.category ?? "其他",
        level: libraryGoal.level,
        code: libraryGoal.code,
        name: libraryGoal.name,
        weight: Number(libraryGoal.weight) || 0,
        scoring_method: libraryGoal.scoring_method,
        required_materials: libraryGoal.required_materials,
        notes: libraryGoal.notes,
      });
    });

    const targetProjectGoalId = projectIdByLibraryId.get(goal.id);
    if (!additions.length) {
      if (targetProjectGoalId) setActiveProjectGoalId(targetProjectGoalId);
      return toast.info("所选目标已在当前项目中，无需重复应用");
    }

    const nextGoals = [...projectGoals, ...additions];
    const ok = await saveProjectGoalsToProject(nextGoals, `已应用 ${additions.length} 项绩效目标到当前项目`);
    if (!ok) return;

    if (targetProjectGoalId) setActiveProjectGoalId(targetProjectGoalId);
    setList((current) => current.map((item) => (
      selectedIds.has(item.id) ? { ...item, usage_count: (item.usage_count || 0) + 1 } : item
    )));
    await Promise.all(
      orderedLibraryGoals.map((item) =>
        supabase.from("goal_library").update({ usage_count: (item.usage_count || 0) + 1 }).eq("id", item.id),
      ),
    );
  };

  const editLibraryGoal = (goal: Goal) => {
    setEditing(goal);
    setForm({
      category: goal.category ?? "其他",
      level: goal.level as 1 | 2 | 3,
      parent_goal_id: goal.parent_goal_id ?? "",
      code: goal.code ?? "",
      name: goal.name,
      weight: Number(goal.weight) || 0,
      scoring_method: goal.scoring_method ?? "",
      required_materials: goal.required_materials ?? "",
      notes: goal.notes ?? "",
    });
    setOpen(true);
  };

  const removeLibraryGoal = async (goal: Goal) => {
    if (!(await confirm({
      title: `删除目标「${goal.name}」？`,
      description: "该目标会从公共目标库中删除，不影响已保存到项目里的绩效目标。",
      destructive: true,
      confirmText: "删除",
    }))) return;
    const { error } = await supabase.from("goal_library").delete().eq("id", goal.id);
    if (error) return toast.error(error.message);
    toast.success("目标库条目已删除");
    load();
  };

  const activeProjectGoalRow = activeProjectGoal
    ? projectGoalRows.find((row) => row.item.id === activeProjectGoal.id) ?? null
    : null;
  const activeProjectGoalParent = activeProjectGoalRow?.parent ?? null;
  const activeProjectGoalStored = activeProjectGoal ? isGoalStored(activeProjectGoal) : false;
  const activeProjectGoalMeta = activeProjectGoal ? goalLevelMeta(activeProjectGoal.level) : null;
  const hasUnnamedProjectGoal = projectGoals.some((goal) => !goal.name.trim());
  const autoSaveTone = hasUnnamedProjectGoal
    ? "warning"
    : autoSaveStatus === "saving"
      ? "info"
      : autoSaveStatus === "error"
        ? "danger"
        : autoSaveStatus === "saved"
          ? "success"
          : "neutral";
  const autoSaveLabel = hasUnnamedProjectGoal
    ? "填写名称后自动保存"
    : autoSaveStatus === "saving"
      ? "自动保存中…"
      : autoSaveStatus === "error"
        ? "自动保存失败"
        : autoSaveStatus === "saved"
          ? lastSavedAt
            ? `已自动保存 ${lastSavedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`
            : "已自动保存"
          : "自动保存";

  return (
    <div>
      <PageHeader
        eyebrow="LIBRARY · 09 · 绩效目标库"
        title="绩效目标库"
        subtitle="沉淀项目绩效目标承诺 · 补充目标口径 · 支持跨项目复用"
        actions={
          <PermissionGate require="canManage">
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild>
                <Button variant="hero"><Plus className="h-4 w-4" />新建公共目标</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display text-xl">{editing ? "编辑公共目标" : "新建公共目标"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>行业大类</Label>
                      <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>层级</Label>
                      <Select value={String(form.level)} onValueChange={v => setForm({ ...form, level: Number(v) as 1 | 2 | 3, parent_goal_id: "" })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">一级</SelectItem>
                          <SelectItem value="2">二级</SelectItem>
                          <SelectItem value="3">三级</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.level > 1 && (
                      <div className="col-span-2">
                        <Label>所属上级</Label>
                        <Select value={form.parent_goal_id || "none"} onValueChange={v => setForm({ ...form, parent_goal_id: v === "none" ? "" : v })}>
                          <SelectTrigger><SelectValue placeholder="请选择上级目标" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">未设置上级</SelectItem>
                            {libraryParentCandidates.map((goal) => (
                              <SelectItem key={goal.id} value={goal.id}>
                                {goal.code ? `${goal.code} · ` : ""}{goal.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div><Label>编号</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} maxLength={20} placeholder="如 1.1.1" /></div>
                    <div><Label>权重</Label><Input type="number" step="0.01" value={form.weight} onChange={e => setForm({ ...form, weight: Number(e.target.value) })} /></div>
                  </div>
                  <div><Label>目标名称 *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required maxLength={120} /></div>
                  <div><Label>衡量口径 / 目标说明</Label><Textarea value={form.scoring_method} onChange={e => setForm({ ...form, scoring_method: e.target.value })} rows={2} maxLength={500} placeholder="如：年度服务覆盖率达到 95%，按月汇总、按年考核。" /></div>
                  <div><Label>关联资料（逗号分隔）</Label><Input value={form.required_materials} onChange={e => setForm({ ...form, required_materials: e.target.value })} placeholder="如：可行性研究报告, 立项批复" /></div>
                  <div><Label>补充说明</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} placeholder="如：目标值口径、统计口径、约束条件。" /></div>
                  <DialogFooter><Button type="submit" variant="hero">{editing ? "更 新" : "保 存"}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </PermissionGate>
        }
      />

      <EditPermissionNotice />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatTile label="ENTRIES" value={list.length.toString().padStart(2, "0")} hint="目标库总数" icon={Library} tone="info" />
        <StatTile label="CATEGORIES" value={new Set(list.map(g => g.category).filter(Boolean)).size.toString().padStart(2, "0")} hint="覆盖行业大类" icon={BookMarked} tone="gold" />
        <StatTile label="REUSED" value={list.reduce((s, g) => s + (g.usage_count || 0), 0).toString().padStart(2, "0")} hint="累计被引用次数" icon={Copy} tone="success" />
      </div>

      <Card className="surface-card p-4 mb-4 border-primary/20 bg-primary/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-primary">PROJECT SOURCE · 历史项目绩效目标沉淀</div>
            <div className="mt-1 font-display text-lg font-semibold text-foreground">从项目填报目标形成可复用的绩效目标资产</div>
            <div className="mt-1 text-sm text-muted-foreground">
              这里维护的是项目申报和后续跟踪要用的绩效目标，不是评估打分时使用的指标体系。项目目标会自动保存，成熟目标可沉淀到下方公共目标库复用。
            </div>
            <div className="mt-3 rounded-md border border-primary/20 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              口径区分：评估指标体系回答“从哪些维度评估项目”，绩效目标库回答“项目最终承诺要达到什么效果、如何衡量、需要哪些支撑资料”。
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-3">
            <div>
              <Label className="text-xs font-mono tracking-wider uppercase text-muted-foreground">目标来源项目</Label>
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="请选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name} · {project.unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {activeProject ? (
              <div className="rounded-lg border border-border bg-card/70 p-3 text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">{activeProject.name}</span>
                </div>
                <div className="text-muted-foreground">{activeProject.unit}</div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="gold" dot={false}>{activeProject.category ?? "未分类"}</StatusPill>
                  <StatusPill tone="info" dot={false}>{activeProject.fiscal_year} 年</StatusPill>
                  <StatusPill tone="success" dot={false}>{projectGoals.length} 项绩效目标</StatusPill>
                </div>
                {activeProject.description && (
                  <div className="text-xs text-muted-foreground line-clamp-3">{activeProject.description}</div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <PermissionGate require="canManage">
                    <Button size="sm" variant="outline" onClick={() => addProjectGoal()}>
                      <Plus className="h-4 w-4" />
                      新增一级目标
                    </Button>
                    <StatusPill tone={autoSaveTone} dot={autoSaveStatus === "saving"}>
                      {autoSaveLabel}
                    </StatusPill>
                  </PermissionGate>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-sm text-muted-foreground">
                暂无可用项目。
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-card/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">TARGET TREE · 项目目标结构</div>
                <div className="text-sm text-muted-foreground">点击目标后在右侧编辑；从某一行新增下级会自动带上所属上级。</div>
              </div>
            </div>
            {projectGoals.length ? (
              <div className="space-y-2.5">
                {projectGoalRows.map(({ item: goal, depth, parent, orphan, childrenCount }) => {
                  const stored = isGoalStored(goal);
                  const meta = goalLevelMeta(goal.level);
                  const isActive = activeProjectGoalId === goal.id;
                  const summary = compactText(goal.scoring_method, 58)
                    || compactText(goal.required_materials ? `支撑资料：${goal.required_materials}` : "", 58)
                    || (goal.level === 1
                      ? "项目总体绩效承诺，可继续添加分类目标"
                      : parent
                        ? `归属于：${parent.name}`
                        : "请在右侧设置上级目标");
                  return (
                    <div
                      key={goal.id}
                      className="relative"
                      style={{ marginLeft: depth ? `${Math.min(depth * 24, 48)}px` : undefined }}
                    >
                      {depth > 0 && (
                        <>
                          <span className="absolute -left-4 -top-3 h-[calc(100%+12px)] w-px rounded-full bg-border" />
                          <span className="absolute -left-4 top-8 h-px w-4 rounded-full bg-border" />
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveProjectGoalId(goal.id)}
                        className={cn(
                          "group box-border w-full overflow-hidden rounded-xl border p-3 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-sm",
                          meta.cardClass,
                          isActive && "border-primary bg-primary/10 shadow-md ring-1 ring-primary/25",
                          orphan && "border-warning/45 bg-warning/10",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className={cn("grid shrink-0 place-items-center rounded-full border font-display text-sm font-bold", meta.nodeClass)}>
                            {meta.marker}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <StatusPill className="shrink-0" tone={meta.tone} dot={false}>{meta.label}</StatusPill>
                              <span className="text-[11px] text-muted-foreground">{meta.role}</span>
                              {childrenCount > 0 && <StatusPill tone="neutral" dot={false}>下级 {childrenCount} 项</StatusPill>}
                              {stored && <StatusPill tone="success" dot={false}>已入库</StatusPill>}
                              {orphan && <StatusPill tone="warning" dot={false}>未设置上级</StatusPill>}
                            </div>
                            <div className={cn("mt-2 min-w-0 break-words text-foreground", meta.nameClass)}>
                              {goal.name || `未命名${meta.label}`}
                            </div>
                            <div className="mt-1 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                              {summary}
                            </div>
                            {(parent || goal.code) && (
                              <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                                {parent && <span className="min-w-0 break-words">上级：{parent.name}</span>}
                                {goal.code && <span className="font-mono">编号：{goal.code}</span>}
                              </div>
                            )}
                          </div>
                          <PermissionGate require="canManage">
                            {goal.level < 3 && (
                              <span
                                role="button"
                                tabIndex={0}
                                className="shrink-0 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-[11px] text-muted-foreground opacity-80 transition hover:border-accent/40 hover:text-accent group-hover:opacity-100"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  addProjectGoal(goal);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  addProjectGoal(goal);
                                }}
                              >
                                新增下级
                              </span>
                            )}
                          </PermissionGate>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-background/60 p-8 text-center">
                <div className="text-sm text-muted-foreground">该项目暂未保存绩效目标。</div>
                <PermissionGate require="canManage">
                  <Button className="mt-3" variant="hero" onClick={() => addProjectGoal()}>
                    <Plus className="h-4 w-4" />
                    新增一级目标
                  </Button>
                </PermissionGate>
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-lg border border-border bg-background/80 p-4">
            {activeProjectGoal ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-primary">EDIT · 单项目标编辑</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusPill tone={activeProjectGoalMeta?.tone ?? "neutral"} dot={false}>
                        {activeProjectGoalMeta?.label ?? "目标"}
                      </StatusPill>
                      {activeProjectGoalParent ? (
                        <StatusPill className="max-w-full whitespace-normal break-words" tone="neutral" dot={false}>上级：{activeProjectGoalParent.name}</StatusPill>
                      ) : activeProjectGoal.level > 1 ? (
                        <StatusPill tone="warning" dot={false}>未设置上级</StatusPill>
                      ) : null}
                      {activeProjectGoalStored && <StatusPill tone="success" dot={false}>已入库</StatusPill>}
                    </div>
                  </div>
                  <PermissionGate require="canManage">
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={autoSaveTone} dot={autoSaveStatus === "saving"}>
                        {autoSaveLabel}
                      </StatusPill>
                      <Button
                        size="sm"
                        variant={activeProjectGoalStored ? "outline" : "hero"}
                        disabled={activeProjectGoalStored || savingProjectGoals || !activeProjectGoal.name.trim()}
                        onClick={() => saveProjectGoalsToLibrary([activeProjectGoal])}
                      >
                        {activeProjectGoalStored ? <CheckCircle2 className="h-4 w-4" /> : <Database className="h-4 w-4" />}
                        {activeProjectGoalStored ? "已入库" : "沉淀到目标库"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeProjectGoal(activeProjectGoal.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                        删除
                      </Button>
                    </div>
                  </PermissionGate>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <Label>目标名称</Label>
                    <Input
                      value={activeProjectGoal.name}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "name", event.target.value)}
                      placeholder="例如：档案存储环境达标率（温度14-24℃、湿度45%-60%）"
                    />
                  </div>
                  <div>
                    <Label>目标编号</Label>
                    <Input
                      value={activeProjectGoal.code ?? ""}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "code", event.target.value || null)}
                      placeholder="如 4-1 / G01"
                    />
                  </div>
                  <div>
                    <Label>目标层级</Label>
                    <Select
                      value={String(activeProjectGoal.level)}
                      disabled={!canManage}
                      onValueChange={(value) => changeProjectGoalLevel(activeProjectGoal.id, Number(value))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">一级</SelectItem>
                        <SelectItem value="2">二级</SelectItem>
                        <SelectItem value="3">三级</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>行业大类</Label>
                    <Select
                      value={activeProjectGoal.category ?? "其他"}
                      disabled={!canManage}
                      onValueChange={(value) => updateProjectGoal(activeProjectGoal.id, "category", value)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>参考权重</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={activeProjectGoal.weight ?? 0}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "weight", Number(event.target.value))}
                    />
                  </div>
                  {activeProjectGoal.level > 1 && (
                    <div className="lg:col-span-2">
                      <Label>所属上级</Label>
                      <Select
                        value={activeProjectGoal.parent_id ?? "none"}
                        disabled={!canManage}
                        onValueChange={(value) => updateProjectGoal(activeProjectGoal.id, "parent_id", value === "none" ? null : value)}
                      >
                        <SelectTrigger><SelectValue placeholder="请选择上级目标" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未设置上级</SelectItem>
                          {parentCandidatesFor(activeProjectGoal).map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.code ? `${candidate.code} · ` : ""}{candidate.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="lg:col-span-2">
                    <Label>衡量口径 / 目标说明</Label>
                    <Textarea
                      rows={3}
                      value={activeProjectGoal.scoring_method ?? ""}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "scoring_method", event.target.value || null)}
                      placeholder="说明该目标要达到什么程度、按什么口径统计、用什么方式确认完成。"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <Label>支撑资料</Label>
                    <Input
                      value={activeProjectGoal.required_materials ?? ""}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "required_materials", event.target.value || null)}
                      placeholder="例如：项目申报书、绩效目标表、预算测算材料"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <Label>补充说明</Label>
                    <Textarea
                      rows={3}
                      value={activeProjectGoal.notes ?? ""}
                      disabled={!canManage}
                      onChange={(event) => updateProjectGoal(activeProjectGoal.id, "notes", event.target.value || null)}
                      placeholder="补充目标值、约束条件或口径说明。"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                请先在中间新增或选择一个绩效目标。
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        ref={librarySectionRef}
        id="goal-library-list"
        className={cn(
          "surface-card p-4 transition-all",
          highlightLibrary && "border-primary/50 bg-primary/8 shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]",
        )}
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-primary">PUBLIC LIBRARY · 公共目标库</div>
            <div className="mt-1 font-display text-lg font-semibold text-foreground">已沉淀的可复用绩效目标</div>
            <div className="mt-1 text-sm text-muted-foreground">
              点击“沉淀到目标库”后的目标会出现在这里，并保留一级 / 二级 / 三级所属关系。
            </div>
          </div>
          <StatusPill tone="info" dot={false}>{list.length} 项</StatusPill>
        </div>

        {libraryRows.length ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[minmax(220px,1.5fr)_120px_120px_minmax(160px,1fr)_168px] gap-0 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
              <div>目标名称</div>
              <div>层级</div>
              <div>行业</div>
              <div>衡量口径 / 支撑资料</div>
              <div className="text-right">操作</div>
            </div>
            <div className="divide-y divide-border">
              {libraryRows.map(({ item: goal, depth, parent, childrenCount, orphan }) => {
                const meta = goalLevelMeta(goal.level);
                const summary = compactText(goal.scoring_method, 48)
                  || compactText(goal.required_materials ? `支撑资料：${goal.required_materials}` : "", 48)
                  || (parent ? `归属于：${parent.name}` : "暂无口径说明");
                return (
                  <div
                    key={goal.id}
                    className={cn(
                      "grid grid-cols-[minmax(220px,1.5fr)_120px_120px_minmax(160px,1fr)_168px] items-center gap-0 px-4 py-3 text-sm",
                      orphan && "bg-warning/8",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth ? `${Math.min(depth * 24, 56)}px` : undefined }}>
                        {depth > 0 && <span className="font-mono text-muted-foreground">└</span>}
                        <span className="min-w-0 truncate font-medium text-foreground">{goal.name}</span>
                        {childrenCount > 0 && <StatusPill tone="neutral" dot={false}>下级 {childrenCount}</StatusPill>}
                      </div>
                      {(parent || goal.code) && (
                        <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" style={{ paddingLeft: depth ? `${Math.min(depth * 24 + 18, 74)}px` : undefined }}>
                          {parent && <span className="min-w-0 truncate">上级：{parent.name}</span>}
                          {goal.code && <span className="font-mono">编号：{goal.code}</span>}
                        </div>
                      )}
                    </div>
                    <div><StatusPill tone={meta.tone} dot={false}>{meta.label}</StatusPill></div>
                    <div className="truncate text-muted-foreground">{goal.category ?? "其他"}</div>
                    <div className="min-w-0 truncate text-muted-foreground">{summary}</div>
                    <PermissionGate require="canManage">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={() => applyLibraryGoalToProject(goal)} title="应用到当前项目">
                          <Plus className="h-3.5 w-3.5" />
                          应用
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => editLibraryGoal(goal)} title="编辑目标库条目">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeLibraryGoal(goal)} title="删除目标库条目">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </PermissionGate>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-background/60 p-8 text-center">
            <Library className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="mt-3 text-sm font-medium text-foreground">目标库暂无条目</div>
            <div className="mt-1 text-sm text-muted-foreground">先在上方项目目标中填写目标名称，再点击“沉淀到目标库”。</div>
          </div>
        )}
      </Card>

      <ConfirmDialog />
    </div>
  );
};

export default GoalLibrary;

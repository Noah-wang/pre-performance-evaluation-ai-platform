import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState, SectionHeader, StatTile, StatusPill } from "@/components/ui-kit";
import { ArrowLeft, EyeOff, Filter, FolderKanban, KeyRound, Pencil, RefreshCw, Save, ShieldAlert, ShieldCheck, Trash2, Users2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type AppRole = "admin" | "group_member" | "expert";

interface Profile {
  user_id: string;
  display_name: string | null;
  organization: string | null;
  phone: string | null;
}

interface UserDirectoryRow {
  user_id: string;
  email: string | null;
}

interface UserRoleRow {
  id: string;
  user_id: string;
  role: AppRole;
}

interface ProjectRow {
  id: string;
  name: string;
  unit: string | null;
  created_by: string | null;
}

interface ProjectMemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: "group_member" | "expert";
  source: string;
  created_at: string;
}

interface ColumnFilters {
  user: string;
  organization: string;
  contact: string;
  role: AppRole | "all";
  projects: string;
}

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "管理员",
  group_member: "工作组成员",
  expert: "专家",
};

const ROLE_OPTIONS: AppRole[] = ["admin", "group_member", "expert"];

const ROLE_PRIORITY: Record<AppRole, number> = {
  admin: 1,
  group_member: 2,
  expert: 3,
};

const ROLE_TONE: Record<AppRole, "danger" | "info" | "gold"> = {
  admin: "danger",
  group_member: "info",
  expert: "gold",
};

const EMPTY_FILTERS: ColumnFilters = {
  user: "",
  organization: "",
  contact: "",
  role: "all",
  projects: "",
};

const MATRIX_ROWS = [
  { module: "评估对象 / 专家 / 资料维护", admin: "全量管理", group_member: "不可访问 / 只读", expert: "只读" },
  { module: "专家打分", admin: "查看与管理", group_member: "不可访问", expert: "提交本人评分" },
  { module: "现场调研记录", admin: "全量查看", group_member: "不可访问", expert: "查看并配合签字" },
  { module: "项目可见范围", admin: "全量查看 / 分配项目", group_member: "仅查看被分配项目", expert: "仅查看被分配项目" },
  { module: "操作日志 / 模板管理", admin: "可访问", group_member: "不可访问", expert: "不可访问" },
  { module: "结果归档 / 安全外发", admin: "可归档 / 吊销", group_member: "不可访问", expert: "不可操作" },
];

const SECURITY_RULES = [
  { title: "行级权限保护", desc: "数据库 RLS 已开启，核心业务写操作统一限制为管理员账号。" },
  { title: "敏感字段脱敏", desc: "专家联系方式、资料评审备注等通过脱敏函数或受限页面控制展示。" },
  { title: "关键操作二次确认", desc: "删除资料、删除现场记录、删除角色等高风险操作会先弹窗确认。" },
  { title: "审计留痕", desc: "项目、报告、角色、模板等关键写操作自动写入 audit_logs，便于追溯。" },
  { title: "安全外发访问留痕", desc: "报告外发链接的访问时间、IP、User-Agent、成功/失败原因会单独记录到 share_link_views。" },
];

const AUDIT_OBJECTS = [
  "projects",
  "experts",
  "reports",
  "materials",
  "evaluation_packages",
  "work_groups",
  "work_tasks",
  "user_roles",
  "doc_templates",
  "share_links",
  "share_link_views",
];

const pickPrimaryRole = (roleList: AppRole[]): AppRole => {
  if (roleList.length === 0) return "group_member";
  if (roleList.length > 1) return "admin";
  return [...roleList].sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b])[0];
};

const SecurityCenter = () => {
  const { isAdmin, loading: authLoading, user, session } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userDirectory, setUserDirectory] = useState<UserDirectoryRow[]>([]);
  const [roles, setRoles] = useState<UserRoleRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [editingUserId, setEditingUserId] = useState("");
  const [draftProfile, setDraftProfile] = useState<Profile | null>(null);
  const [draftRole, setDraftRole] = useState<AppRole>("group_member");
  const [projectPickerUserId, setProjectPickerUserId] = useState("");
  const [projectPickerSearch, setProjectPickerSearch] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ userId: string; displayName: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [
      { data: profileData, error: profileError },
      { data: roleData, error: roleError },
      { data: projectData, error: projectError },
      { data: memberData, error: memberError },
      { data: directoryData, error: directoryError },
    ] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,organization,phone").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("id,user_id,role").order("created_at", { ascending: false }),
      supabase.from("projects").select("id,name,unit,created_by").order("created_at", { ascending: false }),
      (supabase as any).from("project_members").select("id,project_id,user_id,role,source,created_at").order("created_at", { ascending: false }),
      (supabase as any).rpc("get_user_directory"),
    ]);
    setLoading(false);
    if (profileError) return toast.error(profileError.message);
    if (roleError) return toast.error(roleError.message);
    if (projectError) return toast.error(projectError.message);
    if (memberError) return toast.error(memberError.message);
    if (directoryError) toast.warning("用户邮箱目录暂不可用，联系方式将暂用手机号显示");
    setProfiles((profileData as Profile[]) ?? []);
    setUserDirectory((directoryData as UserDirectoryRow[]) ?? []);
    setRoles((roleData as UserRoleRow[]) ?? []);
    const nextProjects = (projectData as ProjectRow[]) ?? [];
    setProjects(nextProjects);
    setProjectMembers((memberData as ProjectMemberRow[]) ?? []);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile])), [profiles]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const projectMembersByUser = useMemo(() => {
    const map = new Map<string, ProjectMemberRow[]>();
    projectMembers.forEach((member) => {
      const next = map.get(member.user_id) ?? [];
      next.push(member);
      map.set(member.user_id, next);
    });
    return map;
  }, [projectMembers]);
  const createdProjectsByUser = useMemo(() => {
    const map = new Map<string, ProjectRow[]>();
    projects.forEach((project) => {
      if (!project.created_by) return;
      const next = map.get(project.created_by) ?? [];
      next.push(project);
      map.set(project.created_by, next);
    });
    return map;
  }, [projects]);

  const rows = useMemo(() => {
    const roleMap = new Map<string, Set<AppRole>>();
    const emailMap = new Map(userDirectory.map((item) => [item.user_id, item.email]));
    roles.forEach((row) => {
      if (!roleMap.has(row.user_id)) roleMap.set(row.user_id, new Set<AppRole>());
      roleMap.get(row.user_id)?.add(row.role);
    });

    return profiles.map((profile) => {
      const roleSet = roleMap.get(profile.user_id) ?? new Set<AppRole>(["group_member"]);
      const roleList = Array.from(roleSet);
      const primaryRole = pickPrimaryRole(roleList);
      const memberProjects = projectMembersByUser.get(profile.user_id) ?? [];
      const createdProjects = createdProjectsByUser.get(profile.user_id) ?? [];
      const projectIds = new Set<string>();
      memberProjects.forEach((member) => projectIds.add(member.project_id));
      createdProjects.forEach((project) => projectIds.add(project.id));
      const accessibleProjects = Array.from(projectIds)
        .map((projectId) => projectMap.get(projectId))
        .filter(Boolean) as ProjectRow[];
      return {
        ...profile,
        email: emailMap.get(profile.user_id) ?? null,
        roleList,
        primaryRole,
        accessibleProjects,
        memberProjects,
        createdProjects,
      };
    }).filter((row) => {
      const globalKw = search.trim().toLowerCase();
      const haystack = [
        row.display_name ?? "",
        row.organization ?? "",
        row.email ?? "",
        row.phone ?? "",
        row.user_id,
        row.roleList.map((item) => ROLE_LABEL[item]).join(" "),
        row.accessibleProjects.map((project) => project.name).join(" "),
      ].join(" ").toLowerCase();
      if (globalKw && !haystack.includes(globalKw)) return false;
      if (columnFilters.user.trim()) {
        const kw = columnFilters.user.trim().toLowerCase();
        if (![row.display_name ?? "", row.user_id].join(" ").toLowerCase().includes(kw)) return false;
      }
      if (columnFilters.organization.trim()) {
        const kw = columnFilters.organization.trim().toLowerCase();
        if (!(row.organization ?? "").toLowerCase().includes(kw)) return false;
      }
      if (columnFilters.contact.trim()) {
        const kw = columnFilters.contact.trim().toLowerCase();
        if (![row.email ?? "", row.phone ?? ""].join(" ").toLowerCase().includes(kw)) return false;
      }
      if (columnFilters.role !== "all" && row.primaryRole !== columnFilters.role) return false;
      if (columnFilters.projects.trim()) {
        const kw = columnFilters.projects.trim().toLowerCase();
        if (!row.accessibleProjects.map((project) => project.name).join(" ").toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [columnFilters, createdProjectsByUser, profiles, projectMap, projectMembersByUser, roles, search, userDirectory]);

  const stats = useMemo(() => {
    const primaryRoleByUser = new Map<string, AppRole>();
    profiles.forEach((profile) => {
      const userRoles = roles.filter((item) => item.user_id === profile.user_id).map((item) => item.role);
      primaryRoleByUser.set(profile.user_id, pickPrimaryRole(userRoles));
    });
    return {
      users: profiles.length,
      admins: Array.from(primaryRoleByUser.values()).filter((role) => role === "admin").length,
      experts: Array.from(primaryRoleByUser.values()).filter((role) => role === "expert").length,
      members: Array.from(primaryRoleByUser.values()).filter((role) => role === "group_member").length,
    };
  }, [profiles, roles]);

  const applyAccountRole = async (userId: string, role: AppRole) => {
    const { error } = await (supabase as any).rpc("set_user_role", {
      target_user_id: userId,
      target_role: role,
    });
    if (error) {
      const missingRpc = /set_user_role|function .* does not exist|Could not find the function/i.test(error.message);
      if (!missingRpc) return toast.error(error.message);

      const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (deleteError) return toast.error(deleteError.message);
      const { error: insertError } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (insertError) return toast.error(insertError.message);
    }
    if (role !== "admin") {
      await (supabase as any)
        .from("project_members")
        .update({ role: role === "expert" ? "expert" : "group_member" })
        .eq("user_id", userId);
    }
    return true;
  };

  const saveProfile = async (target: Profile, showToast = true) => {
    const payload = {
      display_name: target.display_name ?? "",
      organization: target.organization ?? "",
      phone: target.phone ?? "",
    };
    const { error } = await (supabase as any).rpc("set_user_profile", {
      target_user_id: target.user_id,
      target_display_name: payload.display_name,
      target_organization: payload.organization,
      target_phone: payload.phone,
    });
    if (error) {
      const missingRpc = /set_user_profile|function .* does not exist|Could not find the function/i.test(error.message);
      if (!missingRpc) {
        toast.error(error.message);
        return false;
      }
      const { error: updateError } = await supabase
        .from("profiles")
        .update(payload)
        .eq("user_id", target.user_id);
      if (updateError) {
        toast.error(updateError.message);
        return false;
      }
    }
    if (showToast) {
      toast.success("用户信息已保存");
      load();
    }
    return true;
  };

  const updateColumnFilter = <K extends keyof ColumnFilters>(key: K, value: ColumnFilters[K]) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  };

  const clearColumnFilters = () => setColumnFilters(EMPTY_FILTERS);

  const hasColumnFilters = Object.values(columnFilters).some((value) => value !== "" && value !== "all");

  const startEditUser = (row: Profile & { primaryRole: AppRole }) => {
    setEditingUserId(row.user_id);
    setDraftProfile({
      user_id: row.user_id,
      display_name: row.display_name ?? "",
      organization: row.organization ?? "",
      phone: row.phone ?? "",
    });
    setDraftRole(row.primaryRole);
  };

  const cancelEditUser = () => {
    setEditingUserId("");
    setDraftProfile(null);
  };

  const updateDraftProfile = (patch: Partial<Pick<Profile, "display_name" | "organization" | "phone">>) => {
    setDraftProfile((current) => (current ? { ...current, ...patch } : current));
  };

  const saveEditedUser = async (currentRole: AppRole) => {
    if (!draftProfile) return;
    if (draftProfile.user_id === user?.id && draftRole !== "admin") {
      toast.error("不能把当前登录的管理员账号改成普通角色");
      return;
    }
    const profileSaved = await saveProfile(draftProfile, false);
    if (!profileSaved) return;
    if (draftRole !== currentRole) {
      const roleSaved = await applyAccountRole(draftProfile.user_id, draftRole);
      if (!roleSaved) return;
    }
    toast.success("账号信息已保存");
    cancelEditUser();
    load();
  };

  const projectRoleForUser = (userId: string): "group_member" | "expert" => {
    const role = pickPrimaryRole(roles.filter((item) => item.user_id === userId).map((item) => item.role));
    return role === "expert" ? "expert" : "group_member";
  };

  const toggleUserProject = async (targetUserId: string, projectId: string, checked: boolean) => {
    const project = projectMap.get(projectId);
    if (!project) return;
    if (project.created_by === targetUserId && !checked) {
      toast.info("用户自己创建的项目会自动保留在可见项目里");
      return;
    }

    if (checked) {
      const { error } = await (supabase as any)
        .from("project_members")
        .upsert({
          project_id: projectId,
          user_id: targetUserId,
          role: projectRoleForUser(targetUserId),
          source: "admin",
          created_by: user?.id ?? null,
        }, { onConflict: "project_id,user_id" });
      if (error) return toast.error(error.message);
      toast.success("项目已分配");
    } else {
      const { error } = await (supabase as any)
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", targetUserId);
      if (error) return toast.error(error.message);
      toast.success("项目已移除");
    }
    load();
  };

  const deleteUser = async (targetUserId: string, displayName: string) => {
    if (targetUserId === user?.id) {
      toast.error("不能删除当前登录账号");
      return;
    }
    if (!session?.access_token) {
      toast.error("登录已失效，请重新登录后再试");
      return;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`;
    const previewRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ targetUserId, dryRun: true }),
    });
    const previewJson = await previewRes.json().catch(() => ({}));
    if (!previewRes.ok) {
      toast.error(previewJson.error ?? "无法获取删除影响");
      return;
    }

    const impact = previewJson.impact ?? { projects: 0, experts: 0, reports: 0 };
    const roleLabels = Array.isArray(previewJson.roles)
      ? previewJson.roles.map((role: AppRole) => ROLE_LABEL[role]).join(" / ")
      : "无";

    const ok = await confirm({
      title: `删除用户“${displayName || "未命名用户"}”？`,
      description: `该操作会永久删除账号，并同步删除其角色/档案。若该用户创建过业务数据，还会级联删除：项目 ${impact.projects} 个、专家 ${impact.experts} 个、报告 ${impact.reports} 份。当前角色：${roleLabels}。`,
      destructive: true,
      confirmText: "确认删除用户",
    });
    if (!ok) return;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ targetUserId, dryRun: false }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "删除失败");
      return;
    }
    toast.success("用户已删除");
    load();
  };

  const openResetPassword = (userId: string, displayName: string) => {
    setResetTarget({ userId, displayName });
    setResetPassword("");
    setResetOpen(true);
  };

  const submitResetPassword = async () => {
    if (!resetTarget || !session?.access_token) {
      toast.error("登录已失效，请重新登录");
      return;
    }
    if (resetPassword.trim().length < 6) {
      toast.error("密码至少 6 位");
      return;
    }
    setResetting(true);
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        targetUserId: resetTarget.userId,
        newPassword: resetPassword.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setResetting(false);
    if (!res.ok) {
      toast.error(json.error ?? "重置密码失败");
      return;
    }
    toast.success("密码已重置");
    setResetOpen(false);
    setResetTarget(null);
    setResetPassword("");
  };

  const projectPickerProfile = projectPickerUserId ? profileMap.get(projectPickerUserId) : null;
  const projectPickerMembers = projectPickerUserId ? (projectMembersByUser.get(projectPickerUserId) ?? []) : [];
  const projectPickerAssignedIds = new Set(projectPickerMembers.map((member) => member.project_id));
  const projectPickerCreatedIds = new Set(
    projectPickerUserId
      ? (createdProjectsByUser.get(projectPickerUserId) ?? []).map((project) => project.id)
      : [],
  );
  const projectPickerSelectedIds = new Set([...projectPickerAssignedIds, ...projectPickerCreatedIds]);
  const visibleProjectPickerProjects = projects.filter((project) => {
    const kw = projectPickerSearch.trim().toLowerCase();
    if (!kw) return true;
    return [project.name, project.unit ?? ""].join(" ").toLowerCase().includes(kw);
  });

  const filterButton = (active: boolean, children: ReactNode) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title="筛选"
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        {children}
      </PopoverContent>
    </Popover>
  );

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <Card className="surface-card p-0">
        <EmptyState
          icon={ShieldAlert}
          title="仅管理员可访问"
          hint="权限矩阵、角色管理和安全规则属于管理员后台能力。"
        />
        <div className="p-6">
          <Link to="/"><Button variant="outline"><ArrowLeft className="h-4 w-4" />返回工作台</Button></Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ADMIN · 20 · 权限与安全"
        title="权限与安全中心"
        subtitle="统一查看角色权限矩阵、用户角色分配、脱敏规则与审计覆盖范围"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/audit-logs"><Button variant="outline" size="sm">查看审计日志</Button></Link>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="USERS" value={stats.users} hint="系统账号" icon={Users2} tone="info" />
        <StatTile label="ADMINS" value={stats.admins} hint="管理员" icon={ShieldCheck} tone="danger" />
        <StatTile label="MEMBERS" value={stats.members} hint="工作组成员" icon={KeyRound} tone="success" />
        <StatTile label="AUDIT TABLES" value={AUDIT_OBJECTS.length} hint="已纳入审计" icon={ShieldAlert} tone="gold" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="surface-card p-4 xl:col-span-2">
          <SectionHeader eyebrow="ROLE MATRIX" title="权限矩阵" icon={ShieldCheck} />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模块</TableHead>
                  <TableHead>管理员</TableHead>
                  <TableHead>工作组成员</TableHead>
                  <TableHead>专家</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MATRIX_ROWS.map((row) => (
                  <TableRow key={row.module}>
                    <TableCell className="font-medium">{row.module}</TableCell>
                    <TableCell>{row.admin}</TableCell>
                    <TableCell>{row.group_member}</TableCell>
                    <TableCell>{row.expert}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card className="surface-card p-4">
          <SectionHeader eyebrow="SECURITY RULES" title="安全规则" icon={EyeOff} />
          <div className="space-y-3">
            {SECURITY_RULES.map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{item.title}</div>
                  <StatusPill tone="success" dot={false}>已启用</StatusPill>
                </div>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="surface-card p-4">
        <SectionHeader
          eyebrow="USER ACCESS"
          title="用户与项目权限"
          icon={KeyRound}
          actions={
            <div className="text-xs text-muted-foreground">
              管理员可查看全部；工作组成员和专家只查看被分配或自己创建的项目。
            </div>
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="全局搜索姓名 / 单位 / 邮箱 / 用户 ID / 角色 / 项目"
            className="max-w-md"
          />
          <div className="text-xs text-muted-foreground font-mono">{rows.length} / {profiles.length} 人</div>
          {hasColumnFilters && (
            <Button variant="outline" size="sm" className="h-9" onClick={clearColumnFilters}>
              清空表头筛选
            </Button>
          )}
        </div>
        {/*
          表头筛选框挂在这张表的 TableHead 里。如果筛不到结果就把整张表换成空状态，
          正在输入的筛选框会随表一起卸载——表现为“打第二个字母时输入框消失、页面跳回
          顶部”。因此只有在完全没有数据时才隐藏表格，筛选无结果时保留表头，把提示放在
          表体里。
        */}
        {rows.length === 0 && !hasColumnFilters ? (
          <EmptyState icon={Users2} title="暂无可管理用户" hint={loading ? "正在加载…" : "当前还没有 profiles 数据"} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[1180px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[210px]">
                    <div className="flex items-center gap-1">
                      用户
                      {filterButton(Boolean(columnFilters.user), (
                        <div className="space-y-2">
                          <Label>筛选用户</Label>
                          <Input
                            value={columnFilters.user}
                            onChange={(event) => updateColumnFilter("user", event.target.value)}
                            placeholder="姓名 / 用户 ID"
                          />
                        </div>
                      ))}
                    </div>
                  </TableHead>
                  <TableHead className="w-[160px]">
                    <div className="flex items-center gap-1">
                      所属单位
                      {filterButton(Boolean(columnFilters.organization), (
                        <div className="space-y-2">
                          <Label>筛选单位</Label>
                          <Input
                            value={columnFilters.organization}
                            onChange={(event) => updateColumnFilter("organization", event.target.value)}
                            placeholder="输入单位名称"
                          />
                        </div>
                      ))}
                    </div>
                  </TableHead>
                  <TableHead className="w-[230px]">
                    <div className="flex items-center gap-1">
                      联系方式
                      {filterButton(Boolean(columnFilters.contact), (
                        <div className="space-y-2">
                          <Label>筛选联系方式</Label>
                          <Input
                            value={columnFilters.contact}
                            onChange={(event) => updateColumnFilter("contact", event.target.value)}
                            placeholder="邮箱 / 电话"
                          />
                        </div>
                      ))}
                    </div>
                  </TableHead>
                  <TableHead className="w-[160px]">
                    <div className="flex items-center gap-1">
                      账号角色
                      {filterButton(columnFilters.role !== "all", (
                        <div className="space-y-2">
                          <Label>筛选角色</Label>
                          <Select value={columnFilters.role} onValueChange={(value) => updateColumnFilter("role", value as ColumnFilters["role"])}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部角色</SelectItem>
                              {ROLE_OPTIONS.map((role) => (
                                <SelectItem key={`role-filter-${role}`} value={role}>{ROLE_LABEL[role]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </TableHead>
                  <TableHead className="w-[300px]">
                    <div className="flex items-center gap-1">
                      所分配项目
                      {filterButton(Boolean(columnFilters.projects), (
                        <div className="space-y-2">
                          <Label>筛选项目</Label>
                          <Input
                            value={columnFilters.projects}
                            onChange={(event) => updateColumnFilter("projects", event.target.value)}
                            placeholder="输入项目名称"
                          />
                        </div>
                      ))}
                    </div>
                  </TableHead>
                  <TableHead className="w-[240px] text-right">
                    <div className="flex items-center justify-end gap-2">
                      {hasColumnFilters && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={clearColumnFilters}>
                          清空筛选
                        </Button>
                      )}
                      操作
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">
                      没有符合当前筛选条件的用户，请调整或清空表头筛选。
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => {
                  const isCurrentUser = row.user_id === user?.id;
                  const isAdminRow = row.primaryRole === "admin";
                  const isEditing = editingUserId === row.user_id;
                  return (
                    <TableRow key={row.user_id} className={isEditing ? "bg-muted/20" : "h-[72px]"}>
                      <TableCell className="align-middle">
                        {isEditing && draftProfile ? (
                          <div className="space-y-1">
                            <Input
                              value={draftProfile.display_name ?? ""}
                              onChange={(event) => updateDraftProfile({ display_name: event.target.value })}
                              placeholder="姓名"
                              className="h-8"
                            />
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{row.user_id}</div>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.display_name || "未填写姓名"}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{row.user_id}</div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        {isEditing && draftProfile ? (
                          <Input
                            value={draftProfile.organization ?? ""}
                            onChange={(event) => updateDraftProfile({ organization: event.target.value })}
                            placeholder="所属单位"
                            className="h-8"
                          />
                        ) : (
                          <div className="truncate text-sm">{row.organization || "未填写"}</div>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        {isEditing && draftProfile ? (
                          <div className="space-y-1">
                            <div className="truncate text-xs font-mono text-muted-foreground">{row.email || "未绑定邮箱"}</div>
                            <Input
                              value={draftProfile.phone ?? ""}
                              onChange={(event) => updateDraftProfile({ phone: event.target.value })}
                              placeholder="联系电话"
                              className="h-8"
                            />
                          </div>
                        ) : (
                          <div className="min-w-0 space-y-0.5">
                            <div className="truncate text-xs font-mono">{row.email || "未绑定邮箱"}</div>
                            <div className="truncate text-xs text-muted-foreground">{row.phone || "未填写电话"}</div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        {isEditing ? (
                          <Select
                            value={draftRole}
                            disabled={isCurrentUser}
                            onValueChange={(value) => setDraftRole(value as AppRole)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((role) => (
                                <SelectItem key={`${row.user_id}-role-${role}`} value={role}>
                                  {ROLE_LABEL[role]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <StatusPill tone={ROLE_TONE[row.primaryRole]} dot={false}>
                            {ROLE_LABEL[row.primaryRole]}
                          </StatusPill>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        <div className="min-w-0">
                          {isAdminRow ? (
                            <StatusPill tone="danger" dot={false}>管理员默认可见全部项目</StatusPill>
                          ) : row.accessibleProjects.length === 0 ? (
                            <span className="text-xs text-muted-foreground">暂未分配项目</span>
                          ) : (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button type="button" className="cursor-default">
                                    <StatusPill tone="info" dot={false}>
                                      已分配 {row.accessibleProjects.length} 个项目
                                    </StatusPill>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start" className="w-80 max-w-[80vw] p-0">
                                  <div className="border-b border-border px-3 py-2 text-xs font-medium">
                                    已分配项目清单
                                  </div>
                                  <div className="max-h-64 overflow-y-auto p-2">
                                    {row.accessibleProjects.map((project, index) => (
                                      <div key={`${row.user_id}-tooltip-project-${project.id}`} className="rounded-md px-2 py-1.5 text-xs">
                                        <div className="line-clamp-2 font-medium">
                                          {index + 1}. {project.name}
                                        </div>
                                        <div className="mt-0.5 truncate text-muted-foreground">
                                          {project.unit || "未填写单位"}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {isEditing && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 h-8"
                              disabled={isAdminRow}
                              onClick={() => setProjectPickerUserId(row.user_id)}
                            >
                              <FolderKanban className="h-3.5 w-3.5" />
                              编辑项目
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-middle text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="hero" className="h-8" onClick={() => saveEditedUser(row.primaryRole)}>
                              <Save className="h-3.5 w-3.5" />
                              保存
                            </Button>
                            <Button size="sm" variant="outline" className="h-8" onClick={cancelEditUser}>
                              <X className="h-3.5 w-3.5" />
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" className="h-8" onClick={() => startEditUser(row)}>
                              <Pencil className="h-3.5 w-3.5" />
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              onClick={() => openResetPassword(row.user_id, row.display_name || "未命名用户")}
                            >
                              重置密码
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-8"
                              disabled={isCurrentUser}
                              onClick={() => deleteUser(row.user_id, row.display_name || "未命名用户")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="surface-card p-4">
        <SectionHeader eyebrow="AUDIT COVERAGE" title="审计与脱敏覆盖范围" icon={ShieldAlert} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {AUDIT_OBJECTS.map((item) => (
            <div key={item} className="rounded-lg border border-border bg-muted/25 p-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-sm">{item}</div>
                <div className="text-[11px] text-muted-foreground">关键写操作已纳入日志</div>
              </div>
              <StatusPill tone="info" dot={false}>已审计</StatusPill>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog />
      <Dialog
        open={!!projectPickerUserId}
        onOpenChange={(open) => {
          if (!open) {
            setProjectPickerUserId("");
            setProjectPickerSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑可见项目</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{projectPickerProfile?.display_name || "未命名用户"}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  勾选项目即可分配；用户自己创建的项目会自动保留。
                </div>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-right">
                <div className="font-mono text-2xl font-semibold">{projectPickerSelectedIds.size}</div>
                <div className="text-xs text-muted-foreground">已分配项目</div>
              </div>
            </div>
            <Input
              value={projectPickerSearch}
              onChange={(event) => setProjectPickerSearch(event.target.value)}
              placeholder="搜索项目名称 / 单位"
              className="h-9"
            />
            <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-border">
              {projects.length === 0 ? (
                <EmptyState icon={FolderKanban} title="暂无项目" hint="当前没有可分配的项目。" />
              ) : visibleProjectPickerProjects.length === 0 ? (
                <EmptyState icon={FolderKanban} title="未找到项目" hint="请换一个关键词再筛选。" />
              ) : (
                <div className="grid gap-2 p-3 sm:grid-cols-2">
                  {visibleProjectPickerProjects.map((project) => {
                    const isCreated = projectPickerCreatedIds.has(project.id);
                    const checked = isCreated || projectPickerAssignedIds.has(project.id);
                    return (
                      <label
                        key={`project-picker-${project.id}`}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                          checked ? "border-primary/30 bg-primary/5" : "border-border hover:bg-muted/30"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-border"
                          checked={checked}
                          disabled={isCreated}
                          onChange={(event) => toggleUserProject(projectPickerUserId, project.id, event.target.checked)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{project.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{project.unit || "未填写单位"}</div>
                        </div>
                        <StatusPill tone={isCreated ? "gold" : checked ? "success" : "info"} dot={false}>
                          {isCreated ? "创建" : checked ? "已分配" : "未选"}
                        </StatusPill>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectPickerUserId("")}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重置用户密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {resetTarget ? `为 ${resetTarget.displayName} 设置新的临时密码。` : "设置新的临时密码。"}
            </p>
            <div className="space-y-1.5">
              <Label>新密码</Label>
              <Input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="至少 6 位"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button variant="hero" onClick={submitResetPassword} disabled={resetting}>
              {resetting ? "保存中…" : "确认重置"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SecurityCenter;

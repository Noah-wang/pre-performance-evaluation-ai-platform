import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState, SectionHeader, StatTile, StatusPill } from "@/components/ui-kit";
import { ArrowLeft, EyeOff, FolderKanban, KeyRound, Plus, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Users2 } from "lucide-react";
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
}

interface ProjectMemberRow {
  id: string;
  project_id: string;
  user_id: string;
  role: "group_member" | "expert";
  source: string;
  created_at: string;
}

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "管理员",
  group_member: "工作组成员",
  expert: "专家",
};

const ROLE_TONE: Record<AppRole, "danger" | "info" | "gold"> = {
  admin: "danger",
  group_member: "info",
  expert: "gold",
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

const maskPhone = (value: string | null) => {
  if (!value) return "未填写";
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
};

const contactLabel = (email: string | null | undefined, phone: string | null) => {
  if (email) return email;
  return maskPhone(phone);
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
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedProjectRole, setSelectedProjectRole] = useState<"group_member" | "expert">("group_member");
  const [assigning, setAssigning] = useState(false);
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
      supabase.from("projects").select("id,name,unit").order("created_at", { ascending: false }),
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
    setSelectedProjectId((current) => current || nextProjects[0]?.id || "");
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

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
      return {
        ...profile,
        email: emailMap.get(profile.user_id) ?? null,
        roleList,
      };
    }).filter((row) => {
      if (!search.trim()) return true;
      const kw = search.trim().toLowerCase();
      return [
        row.display_name ?? "",
        row.organization ?? "",
        row.email ?? "",
        row.user_id,
        row.roleList.map((item) => ROLE_LABEL[item]).join(" "),
      ].join(" ").toLowerCase().includes(kw);
    });
  }, [profiles, roles, search, userDirectory]);

  const stats = useMemo(() => ({
    users: profiles.length,
    admins: new Set(roles.filter((item) => item.role === "admin").map((item) => item.user_id)).size,
    experts: new Set(roles.filter((item) => item.role === "expert").map((item) => item.user_id)).size,
    members: new Set(roles.filter((item) => item.role === "group_member").map((item) => item.user_id)).size,
  }), [profiles.length, roles]);

  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.user_id, profile])), [profiles]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const projectAssignmentRows = useMemo(() => {
    const kw = assignmentSearch.trim().toLowerCase();
    return projectMembers
      .map((member) => ({
        ...member,
        project: projectMap.get(member.project_id),
        profile: profileMap.get(member.user_id),
      }))
      .filter((row) => {
        if (!kw) return true;
        return [
          row.project?.name ?? "",
          row.project?.unit ?? "",
          row.profile?.display_name ?? "",
          row.profile?.organization ?? "",
          row.user_id,
          ROLE_LABEL[row.role],
        ].join(" ").toLowerCase().includes(kw);
      });
  }, [assignmentSearch, profileMap, projectMap, projectMembers]);

  const selectedProjectMembers = useMemo(
    () => projectMembers.filter((item) => item.project_id === selectedProjectId),
    [projectMembers, selectedProjectId],
  );

  const assignProject = async () => {
    if (!selectedProjectId || !selectedUserId) {
      toast.error("请选择项目和账号");
      return;
    }
    setAssigning(true);
    const { error } = await (supabase as any)
      .from("project_members")
      .upsert({
        project_id: selectedProjectId,
        user_id: selectedUserId,
        role: selectedProjectRole,
        source: "admin",
        created_by: user?.id ?? null,
      }, { onConflict: "project_id,user_id" });
    setAssigning(false);
    if (error) return toast.error(error.message);
    const profile = profileMap.get(selectedUserId);
    const project = projectMap.get(selectedProjectId);
    toast.success(`已将 ${profile?.display_name || "该账号"} 分配到 ${project?.name || "项目"}`);
    setSelectedUserId("");
    load();
  };

  const removeProjectMember = async (member: ProjectMemberRow) => {
    const profile = profileMap.get(member.user_id);
    const project = projectMap.get(member.project_id);
    const ok = await confirm({
      title: "移除项目权限？",
      description: `移除后，${profile?.display_name || "该账号"} 将不能再查看「${project?.name || "该项目"}」。`,
      destructive: true,
      confirmText: "移除",
    });
    if (!ok) return;
    const { error } = await (supabase as any).from("project_members").delete().eq("id", member.id);
    if (error) return toast.error(error.message);
    toast.success("项目权限已移除");
    load();
  };

  const grantRole = async (userId: string, role: AppRole) => {
    const exists = roles.some((item) => item.user_id === userId && item.role === role);
    if (exists) return toast.info("该角色已存在");
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return toast.error(error.message);
    toast.success(`已授予${ROLE_LABEL[role]}`);
    load();
  };

  const revokeRole = async (userId: string, role: AppRole) => {
    const ownedRoles = roles.filter((item) => item.user_id === userId);
    if (ownedRoles.length <= 1) {
      toast.error("至少保留一个角色");
      return;
    }
    const ok = await confirm({
      title: `移除${ROLE_LABEL[role]}？`,
      description: "该用户将失去对应菜单和数据权限，请确认。",
      destructive: true,
      confirmText: "移除角色",
    });
    if (!ok) return;
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) return toast.error(error.message);
    toast.success(`已移除${ROLE_LABEL[role]}`);
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
        <SectionHeader eyebrow="USER ACCESS" title="用户角色分配" icon={KeyRound} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名 / 单位 / 用户 ID / 角色"
            className="max-w-md"
          />
          <div className="text-xs text-muted-foreground font-mono">{rows.length} / {profiles.length} 人</div>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Users2} title="暂无可管理用户" hint={loading ? "正在加载…" : "当前还没有 profiles 数据"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>所属单位</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead>当前角色</TableHead>
                  <TableHead>授予角色</TableHead>
                  <TableHead className="w-40">密码</TableHead>
                  <TableHead className="w-28 text-right">删除用户</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <div className="font-medium">{row.display_name || "未命名用户"}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{row.user_id}</div>
                    </TableCell>
                    <TableCell>{row.organization || "未填写"}</TableCell>
                    <TableCell className="font-mono text-xs">{contactLabel(row.email, row.phone)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {row.roleList.map((role) => (
                          <button
                            key={`${row.user_id}-${role}`}
                            onClick={() => revokeRole(row.user_id, role)}
                            className="text-left"
                            type="button"
                          >
                            <StatusPill tone={ROLE_TONE[role]} dot={false} className="cursor-pointer">
                              {ROLE_LABEL[role]}
                            </StatusPill>
                          </button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {(["admin", "group_member", "expert"] as AppRole[]).map((role) => (
                          <Button
                            key={`${row.user_id}-grant-${role}`}
                            size="sm"
                            variant={row.roleList.includes(role) ? "secondary" : "outline"}
                            className="h-7"
                            disabled={row.roleList.includes(role)}
                            onClick={() => grantRole(row.user_id, role)}
                          >
                            授予{ROLE_LABEL[role]}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openResetPassword(row.user_id, row.display_name || "未命名用户")}
                      >
                        重置密码
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        disabled={row.user_id === user?.id}
                        onClick={() => deleteUser(row.user_id, row.display_name || "未命名用户")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Card className="surface-card p-4">
        <SectionHeader
          eyebrow="PROJECT ACCESS"
          title="项目权限分配"
          icon={FolderKanban}
          actions={
            <div className="text-xs text-muted-foreground">
              管理员可查看全部；工作组成员和专家只看这里分配给自己的项目。
            </div>
          }
        />
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 lg:grid-cols-[1.2fr_1fr_180px_auto]">
          <div className="space-y-1.5">
            <Label>选择项目</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>选择账号</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="请选择已注册账号" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.user_id} value={profile.user_id}>
                    {profile.display_name || "未命名用户"}{profile.organization ? ` · ${profile.organization}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>项目身份</Label>
            <Select value={selectedProjectRole} onValueChange={(value: "group_member" | "expert") => setSelectedProjectRole(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="group_member">工作组成员</SelectItem>
                <SelectItem value="expert">专家</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="hero" className="w-full" onClick={assignProject} disabled={assigning || !selectedProjectId || !selectedUserId}>
              <Plus className="h-4 w-4" />
              {assigning ? "分配中…" : "分配项目"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[360px_1fr]">
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">当前项目成员</div>
                <div className="text-xs text-muted-foreground">
                  {projectMap.get(selectedProjectId)?.name ?? "请选择项目"}
                </div>
              </div>
              <StatusPill tone="info" dot={false}>{selectedProjectMembers.length} 人</StatusPill>
            </div>
            {selectedProjectMembers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                暂无分配账号
              </div>
            ) : (
              <div className="space-y-2">
                {selectedProjectMembers.map((member) => {
                  const profile = profileMap.get(member.user_id);
                  return (
                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{profile?.display_name || "未命名用户"}</div>
                        <div className="truncate text-xs text-muted-foreground">{profile?.organization || member.user_id}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusPill tone={ROLE_TONE[member.role]} dot={false}>{ROLE_LABEL[member.role]}</StatusPill>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeProjectMember(member)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Input
                value={assignmentSearch}
                onChange={(event) => setAssignmentSearch(event.target.value)}
                placeholder="搜索项目 / 账号 / 单位 / 角色"
                className="max-w-md"
              />
              <div className="text-xs text-muted-foreground font-mono">
                {projectAssignmentRows.length} / {projectMembers.length} 条分配
              </div>
            </div>
            {projectAssignmentRows.length === 0 ? (
              <EmptyState icon={FolderKanban} title="暂无项目分配记录" hint="请先在上方选择项目和账号，再点击“分配项目”。" />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>项目</TableHead>
                      <TableHead>账号</TableHead>
                      <TableHead>项目身份</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead className="w-24 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectAssignmentRows.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="font-medium">{member.project?.name || "项目已删除"}</div>
                          <div className="text-xs text-muted-foreground">{member.project?.unit || "—"}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{member.profile?.display_name || "未命名用户"}</div>
                          <div className="text-xs text-muted-foreground">{member.profile?.organization || member.user_id}</div>
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={ROLE_TONE[member.role]} dot={false}>{ROLE_LABEL[member.role]}</StatusPill>
                        </TableCell>
                        <TableCell>{member.source === "admin" ? "管理员分配" : "历史分配"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => removeProjectMember(member)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            移除
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
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

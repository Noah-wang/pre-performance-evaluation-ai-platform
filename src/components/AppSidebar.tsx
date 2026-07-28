import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, FolderKanban, Users, BookUser, FileSearch,
  ClipboardList, ScrollText, FileText, Archive, LogOut, Layers, Package, Award, ShieldAlert, Library, FileCode, ListTodo, Database,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Seal } from "./Seal";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "./ui/button";

const groups = [
  {
    label: "OVERVIEW",
    cnLabel: "总览",
    items: [
      { title: "工作台", url: "/", icon: LayoutDashboard, code: "00" },
    ],
  },
  {
    label: "PHASE I",
    cnLabel: "一·准备阶段",
    items: [
      { title: "评估包管理", url: "/packages", icon: Package, code: "01A" },
      { title: "评估对象管理", url: "/projects", icon: FolderKanban, code: "01" },
      { title: "工作组与方案", url: "/work-groups", icon: Users, code: "02" },
      { title: "专家库管理", url: "/experts", icon: BookUser, code: "03" },
    ],
  },
  {
    label: "PHASE II",
    cnLabel: "二·实施阶段",
    items: [
      { title: "资料收集审核", url: "/materials", icon: FileSearch, code: "04" },
      { title: "评估指标体系", url: "/evaluation-system", icon: Layers, code: "04A" },
      { title: "绩效目标库", url: "/goal-library", icon: Library, code: "04B" },
      { title: "现场调研记录", url: "/field-research", icon: ClipboardList, code: "05" },
      // 预评估要参考专家打分结果，所以排在打分汇总之后。
      { title: "专家打分汇总", url: "/expert-scoring", icon: Award, code: "06" },
      { title: "预评估", url: "/evaluations", icon: ScrollText, code: "06A" },
    ],
  },
  {
    label: "PHASE III",
    cnLabel: "三·总结应用",
    items: [
      { title: "评估报告（AI）", url: "/reports", icon: FileText, code: "07" },
      { title: "整改任务看板", url: "/rectifications", icon: ListTodo, code: "07A" },
      { title: "结果应用与项目库", url: "/archive", icon: Archive, code: "08" },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { user, signOut, isAdmin, roles } = useAuth();
  const isExpertUser = roles.includes("expert") && !isAdmin;
  const isBusinessUser = !!user && (roles.includes("group_member") || roles.length === 0) && !isExpertUser;
  const expertGroups = [
    {
      label: "OVERVIEW",
      cnLabel: "总览",
      items: [
        { title: "工作台", url: "/", icon: LayoutDashboard, code: "00" },
      ],
    },
    {
      label: "EXPERT",
      cnLabel: "专家工作区",
      items: [
        { title: "专家打分", url: "/expert-scoring", icon: Award, code: "06A" },
        { title: "现场调研记录", url: "/field-research", icon: ClipboardList, code: "05" },
      ],
    },
  ];
  const viewerGroups = [
    {
      label: "OVERVIEW",
      cnLabel: "总览",
      items: [
        { title: "工作台", url: "/", icon: LayoutDashboard, code: "00" },
      ],
    },
  ];
  const baseGroups = isAdmin ? groups : (isExpertUser ? expertGroups : (isBusinessUser ? groups : viewerGroups));
  const groupsToShow = isAdmin
    ? [...baseGroups, {
        label: "ADMIN",
        cnLabel: "管理",
        items: [
          { title: "权限与安全", url: "/security-center", icon: ShieldAlert, code: "20" },
          { title: "操作日志", url: "/audit-logs", icon: ShieldAlert, code: "21" },
          { title: "文档模板", url: "/doc-templates", icon: FileCode, code: "22" },
          { title: "文件库（RAG）", url: "/knowledge-base", icon: Database, code: "23" },
        ],
      }]
    : baseGroups;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-3 px-2 py-3">
          <Seal size={collapsed ? 32 : 40} text="PE" />
          {!collapsed && (
            <div className="flex flex-col leading-tight min-w-0">
              <span className="font-display text-base font-bold text-sidebar-foreground truncate">
                绩效评估
              </span>
              <span className="text-[10px] tracking-[0.22em] font-mono text-sidebar-primary mt-0.5">
                ZI ZHENG · HUI MIN
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar">
        {groupsToShow.map((g) => (
          <SidebarGroup key={g.label}>
            {!collapsed && (
              <SidebarGroupLabel className="font-mono text-[10px] tracking-[0.22em] text-sidebar-primary/70 px-3 mt-2">
                <span className="opacity-60 mr-1">—</span>{g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          className={[
                            "group relative rounded-md transition-all duration-200",
                            active
                              ? "bg-sidebar-accent text-sidebar-primary font-medium"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-primary",
                          ].join(" ")}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-sidebar-primary shadow-[0_0_8px_hsl(var(--cyan)/0.6)]" />
                          )}
                          <item.icon className={`h-4 w-4 transition-colors ${active ? "text-sidebar-primary" : ""}`} />
                          {!collapsed && (
                            <>
                              <span className="flex-1 text-sm">{item.title}</span>
                              <span className="font-mono text-[10px] text-sidebar-foreground/40 tabular-nums">
                                {item.code}
                              </span>
                            </>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border bg-sidebar p-2">
        {!collapsed && user && (
          <div className="px-2 pb-2">
            <div className="text-[10px] font-mono tracking-wider text-sidebar-foreground/50 uppercase">
              Signed in
            </div>
            <div className="text-xs text-sidebar-foreground/90 truncate">{user.email}</div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="justify-start gap-2 text-sidebar-foreground/80 hover:text-sidebar-primary hover:bg-sidebar-accent/50"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>退出登录</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

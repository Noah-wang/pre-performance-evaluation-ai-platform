import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const ROLE_PRIORITY: Record<string, number> = {
  admin: 1,
  group_member: 2,
  expert: 3,
};

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: string[];
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, loading: true, roles: [], isAdmin: false, signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    // 浏览器标签页重新获得焦点时，Supabase 会自动刷新 token 并触发这个回调，
    // 每次都带来一个内容相同但引用不同的 user 对象。如果直接 setUser，依赖它的
    // effect 会重跑并把 loading 置为 true，ProtectedRoute 随即卸载整棵路由树——
    // 表现就是"切到别的应用再回来，页面自己刷新了"，正在进行的报告生成也会丢失。
    // 只有用户真的变了才更新对象引用。
    const applyUser = (next: User | null) =>
      setUser((prev) => (prev?.id && prev.id === next?.id ? prev : next));

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      applyUser(s?.user ?? null);
      if (!s?.user) {
        setRoles([]);
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      applyUser(s?.user ?? null);
      if (!s?.user) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load roles whenever user changes (deferred to avoid auth deadlock)
  useEffect(() => {
    if (!user) { setRoles([]); setLoading(false); return; }
    setLoading(true);
    // 依赖用户 ID 而非对象引用：token 刷新不应触发重新加载角色。
    setTimeout(async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const loadedRoles = (data ?? [])
        .map((r: any) => r.role)
        .filter(Boolean)
        .sort((a: string, b: string) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99));
      const primaryRole = loadedRoles[0];
      // New accounts are business users by default; this also keeps legacy
      // accounts without a role from getting stuck with only the dashboard.
      setRoles(primaryRole ? [primaryRole] : ["group_member"]);
      setLoading(false);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{ user, session, loading, roles, isAdmin: roles.includes("admin"), signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) {
        setRoles([]);
        setLoading(false);
      } else {
        setLoading(true);
      }
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load roles whenever user changes (deferred to avoid auth deadlock)
  useEffect(() => {
    if (!user) { setRoles([]); setLoading(false); return; }
    setLoading(true);
    setTimeout(async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const loadedRoles = (data ?? []).map((r: any) => r.role);
      // New accounts are business users by default; this also keeps legacy
      // accounts without a role from getting stuck with only the dashboard.
      setRoles(loadedRoles.length > 0 ? loadedRoles : ["group_member"]);
      setLoading(false);
    }, 0);
  }, [user]);

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{ user, session, loading, roles, isAdmin: roles.includes("admin"), signOut }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);

import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

type Mode = "admin" | "business" | "business-or-expert";

interface RoleRouteProps {
  mode: Mode;
  children: ReactNode;
}

export const RoleRoute = ({ mode, children }: RoleRouteProps) => {
  const { user, loading, isAdmin, roles } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="font-serif text-vermillion text-lg">载入中…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  const isGroupMember = roles.includes("group_member") || roles.length === 0;
  const isExpert = roles.includes("expert");
  const allow =
    mode === "admin"
      ? isAdmin
      : mode === "business"
        ? isAdmin || isGroupMember
        : isAdmin || isGroupMember || isExpert;

  if (!allow) return <Navigate to="/" replace />;

  return <>{children}</>;
};

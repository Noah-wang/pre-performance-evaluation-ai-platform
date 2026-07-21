import { forwardRef, ReactNode } from "react";
import { usePermissions } from "@/hooks/usePermissions";

type Perm = "canManage" | "canAdmin" | "canScore" | "canExport";

interface Props {
  require: Perm;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Conditionally renders children only when the current user has the given permission. */
export const PermissionGate = forwardRef<HTMLElement, Props>(({ require, children, fallback = null }, _ref) => {
  const perms = usePermissions();
  return <>{perms[require] ? children : fallback}</>;
});
PermissionGate.displayName = "PermissionGate";

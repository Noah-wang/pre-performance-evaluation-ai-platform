import { useAuth } from "@/hooks/useAuth";

/**
 * Role-based permission helpers.
 * Roles: admin | group_member | expert
 *
 * Rules:
 * - admin: full access
 * - group_member: manage projects, experts, materials, work groups, evaluation
 * - expert: read-only on most pages, can submit own scores
 */
export function usePermissions() {
  const { roles, isAdmin, user, loading } = useAuth();
  const isAuthenticated = !!user;
  const effectiveRoles = roles.length > 0 ? roles : (isAuthenticated ? ["group_member"] : []);
  const isExpert = effectiveRoles.includes("expert");
  const isGroupMember = effectiveRoles.includes("group_member");

  return {
    user,
    loading,
    roles: effectiveRoles,
    isAdmin,
    isExpert,
    isGroupMember,
    /** Business users can operate business data; admin-only pages stay protected by canAdmin. */
    canManage: isAdmin || isGroupMember,
    /** Only admins can manage user roles, audit logs, archive operations. */
    canAdmin: isAdmin,
    /** Experts can submit scores; admins can also. */
    canScore: isExpert || isAdmin,
    /** Logged-in users may export / download visible files. */
    canExport: isAuthenticated,
  };
}

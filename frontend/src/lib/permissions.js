import { useAuth } from "@/lib/auth";

// Mirrors PERMISSION_MODULES/PERMISSION_LEVELS in django-backend/api/models.py.
export const PERMISSION_MODULES = [
  "students", "teachers", "parents", "courses", "groups",
  "sessions", "payments", "grades", "attendance", "messages",
];
export const PERMISSION_LEVELS = ["hidden", "view", "edit"];

const FULL_ACCESS_ROLES = ["owner", "director", "super_admin"];

/** Effective access level for a tab/module — mirrors User.get_permission()
 * server-side. Owner/director/super_admin always get "edit"; everyone else
 * falls back to their stored permissions map, defaulting to "hidden". */
export function getModulePermission(user, moduleKey) {
  if (!user) return "hidden";
  if (FULL_ACCESS_ROLES.includes(user.role)) return "edit";
  return user.permissions?.[moduleKey] || "hidden";
}

export function isFullAccessRole(role) {
  return FULL_ACCESS_ROLES.includes(role);
}

/** `const { level, canView, canEdit } = usePermission("students")` */
export function usePermission(moduleKey) {
  const { user } = useAuth();
  const level = getModulePermission(user, moduleKey);
  return { level, canView: level === "view" || level === "edit", canEdit: level === "edit" };
}

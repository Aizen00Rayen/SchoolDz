import { useAuth } from "@/lib/auth";

// Mirrors PERMISSION_MODULES/PERMISSION_LEVELS in django-backend/api/models.py.
export const PERMISSION_MODULES = [
  "dashboard", "students", "teachers", "parents", "courses", "groups",
  "sessions", "calendar", "rooms", "payments", "expenses", "teacher_payments",
  "grades", "attendance", "messages", "quizzes", "website", "reports",
  "logs", "users", "settings",
];
export const PERMISSION_LEVELS = ["hidden", "view", "edit"];

// Mirrors DEFAULT_MODULE_PERMISSIONS server-side: pages that were never
// permission-gated stay visible for existing staff accounts that have no
// explicit entry, while the money/audit/user-management pages stay hidden
// until an owner grants them.
const DEFAULT_MODULE_PERMISSIONS = {
  dashboard: "view",
  calendar: "view",
  // 'view' by default so existing staff can still populate the room
  // dropdown when creating a group/session — only full room management
  // needs an explicit 'edit' grant.
  rooms: "view",
  reports: "view",
  settings: "view",
  website: "view",
};

const FULL_ACCESS_ROLES = ["owner", "director", "super_admin"];

/** Effective access level for a tab/module — mirrors User.get_permission()
 * server-side. Owner/director/super_admin always get "edit"; everyone else
 * falls back to their stored permissions map, then the per-module default. */
export function getModulePermission(user, moduleKey) {
  if (!user) return "hidden";
  if (FULL_ACCESS_ROLES.includes(user.role)) return "edit";
  return user.permissions?.[moduleKey] || DEFAULT_MODULE_PERMISSIONS[moduleKey] || "hidden";
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

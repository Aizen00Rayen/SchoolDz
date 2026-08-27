import { useAuth } from "@/lib/auth";

// Mirrors PERMISSION_MODULES/PERMISSION_FLAGS in django-backend/api/models.py.
export const PERMISSION_MODULES = [
  "dashboard", "students", "teachers", "parents", "courses", "groups",
  "sessions", "calendar", "timetable", "rooms", "payments", "debts", "expenses", "teacher_payments",
  "grades", "attendance", "messages", "quizzes", "website", "reports",
  "logs", "users", "settings", "trips", "books",
];
export const PERMISSION_FLAGS = ["view", "add", "modify", "delete"];

// Mirrors DEFAULT_MODULE_PERMISSIONS server-side: pages that were never
// permission-gated stay visible for existing staff accounts that have no
// explicit entry, while the money/audit/user-management pages stay hidden
// until an owner grants them.
const DEFAULT_MODULE_PERMISSIONS = {
  dashboard: { view: true },
  calendar: { view: true },
  timetable: { view: true },
  // view-only by default so existing staff can still populate the room
  // dropdown when creating a group/session — only full room management
  // needs an explicit grant.
  rooms: { view: true },
  reports: { view: true },
  settings: { view: true },
  website: { view: true },
};

const FULL_ACCESS_ROLES = ["owner", "director", "super_admin"];

/** Raw {view, add, modify, delete} flags for a module — mirrors
 * User._module_flags() server-side. Owner/director/super_admin always get
 * every flag; everyone else falls back to their stored permissions map,
 * then the per-module default. */
export function getModuleFlags(user, moduleKey) {
  if (!user) return {};
  if (FULL_ACCESS_ROLES.includes(user.role)) return { view: true, add: true, modify: true, delete: true };
  return user.permissions?.[moduleKey] || DEFAULT_MODULE_PERMISSIONS[moduleKey] || {};
}

export function canViewModule(user, moduleKey) {
  return !!getModuleFlags(user, moduleKey).view;
}

export function isFullAccessRole(role) {
  return FULL_ACCESS_ROLES.includes(role);
}

/** `const { canView, canAdd, canModify, canDelete } = usePermission("students")` */
export function usePermission(moduleKey) {
  const { user } = useAuth();
  const flags = getModuleFlags(user, moduleKey);
  const canView = !!flags.view;
  return {
    canView,
    canAdd: canView && !!flags.add,
    canModify: canView && !!flags.modify,
    canDelete: canView && !!flags.delete,
  };
}

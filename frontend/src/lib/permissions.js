import { useAuth } from "@/lib/auth";

// Mirrors PERMISSION_MODULES/PERMISSION_FLAGS in django-backend/api/models.py.
export const PERMISSION_MODULES = [
  "dashboard", "students", "teachers", "parents", "courses", "groups",
  "sessions", "calendar", "timetable", "rooms", "payments", "debts", "expenses", "other_incomes", "teacher_payments",
  "grades", "attendance", "messages", "quizzes", "website", "reports",
  "logs", "users", "settings", "trips", "books", "insurances",
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
  const entry = user.permissions?.[moduleKey];
  if (entry !== undefined && entry !== null) {
    return typeof entry === "object" ? entry : {};
  }
  return DEFAULT_MODULE_PERMISSIONS[moduleKey] || {};
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

export const APP_NAV_ITEMS = [
  { key: "dashboard", to: "/app/dashboard", module: "dashboard" },
  { key: "students", to: "/app/students", module: "students" },
  { key: "parents", to: "/app/parents", module: "parents" },
  { key: "teachers", to: "/app/teachers", module: "teachers" },
  { key: "courses", to: "/app/courses", module: "courses" },
  { key: "groups", to: "/app/groups", module: "groups" },
  { key: "sessions", to: "/app/sessions", module: "sessions" },
  { key: "calendar", to: "/app/calendar", premiumOnly: true, module: "calendar" },
  { key: "timetable", to: "/app/timetable", module: "timetable" },
  { key: "rooms", to: "/app/rooms", module: "rooms" },
  { key: "attendance", to: "/app/attendance", module: "attendance" },
  { key: "session_sheet", to: "/app/session-sheet", module: "attendance" },
  { key: "grades", to: "/app/grades", module: "grades" },
  { key: "quizzes", to: "/app/quizzes", premiumOnly: true, module: "quizzes" },
  { key: "trips", to: "/app/trips", module: "trips" },
  { key: "books", to: "/app/books", module: "books" },
  { key: "payments", to: "/app/payments", module: "payments" },
  { key: "insurances", to: "/app/insurances", module: "insurances" },
  { key: "debts", to: "/app/debts", module: "debts" },
  { key: "expenses", to: "/app/expenses", module: "expenses" },
  { key: "other_incomes", to: "/app/other-incomes", module: "other_incomes" },
  { key: "teacher_payments", to: "/app/teacher-payments", module: "teacher_payments" },
  { key: "reports", to: "/app/reports", module: "reports" },
  { key: "logs", to: "/app/logs", module: "logs" },
  { key: "messages", to: "/app/messages", standardPlusOnly: true, module: "messages" },
  { key: "website", to: "/app/website", premiumOnly: true, module: "website" },
  { key: "users", to: "/app/users", adminOnly: true },
  { key: "settings", to: "/app/settings", module: "settings" },
  { key: "archive", to: "/app/archive", module: "courses" },
];

export function isNavItemAllowed(item, user, tenant) {
  if (!user) return false;
  const isAdmin = user.role === "owner" || user.role === "director" || user.role === "super_admin";
  if (item.adminOnly && !isAdmin) return false;
  if (item.premiumOnly && tenant?.plan !== "premium") return false;
  if (item.standardPlusOnly && (!tenant?.plan || tenant.plan === "basic")) return false;
  if (item.module && !canViewModule(user, item.module)) return false;
  return true;
}

export function getDefaultAppPath(user, tenant) {
  if (!user) return "/login";
  if (user.role === "parent") return "/portal";
  for (const item of APP_NAV_ITEMS) {
    if (isNavItemAllowed(item, user, tenant)) {
      return item.to;
    }
  }
  return "/app/dashboard";
}


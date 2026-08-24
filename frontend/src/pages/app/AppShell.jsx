import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Award, BarChart3, BookOpen, Building2, CalendarClock, CalendarDays, ChevronsUpDown, ClipboardCheck,
  DoorOpen, FileBarChart2, FileQuestion, GraduationCap, Globe, HandCoins, Languages, LogOut, Menu, MessageSquare, Moon,
  PanelLeft, PanelLeftClose, Plane, Receipt, ScrollText, Search, Settings, Sun, Users, UserRound, Wallet, Layers, Table2, X,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme, useTenantBranding } from "@/lib/theme";
import { APPUI, AUTH } from "@/constants/testIds";
import { api, resolveFileUrl } from "@/lib/api";
import { getModulePermission } from "@/lib/permissions";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Grouped under category headers so a 20+ item sidebar stays scannable —
// "overview" renders with no header (dashboard just sits at the top), every
// other group gets an uppercase label that collapses away in rail mode
// (see the railMode divider fallback in the render below).
const NAV_GROUPS = [
  {
    key: "overview",
    items: [
      { key: "dashboard", to: "/app/dashboard", icon: BarChart3, module: "dashboard" },
    ],
  },
  {
    key: "people",
    items: [
      { key: "students", to: "/app/students", icon: GraduationCap, module: "students" },
      { key: "parents", to: "/app/parents", icon: UserRound, module: "parents" },
      { key: "teachers", to: "/app/teachers", icon: Users, module: "teachers" },
    ],
  },
  {
    key: "academics",
    items: [
      { key: "courses", to: "/app/courses", icon: BookOpen, module: "courses" },
      { key: "groups", to: "/app/groups", icon: Layers, module: "groups" },
      { key: "sessions", to: "/app/sessions", icon: CalendarClock, module: "sessions" },
      { key: "calendar", to: "/app/calendar", icon: CalendarDays, premiumOnly: true, module: "calendar" },
      { key: "timetable", to: "/app/timetable", icon: Table2, module: "timetable" },
      { key: "rooms", to: "/app/rooms", icon: DoorOpen, module: "rooms" },
      { key: "attendance", to: "/app/attendance", icon: ClipboardCheck, module: "attendance" },
      { key: "grades", to: "/app/grades", icon: Award, module: "grades" },
      { key: "quizzes", to: "/app/quizzes", icon: FileQuestion, premiumOnly: true, module: "quizzes" },
    ],
  },
  {
    key: "activities",
    items: [
      { key: "trips", to: "/app/trips", icon: Plane, module: "trips" },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "payments", to: "/app/payments", icon: Wallet, module: "payments" },
      { key: "expenses", to: "/app/expenses", icon: Receipt, module: "expenses" },
      { key: "teacher_payments", to: "/app/teacher-payments", icon: HandCoins, module: "teacher_payments" },
    ],
  },
  {
    key: "insights",
    items: [
      { key: "reports", to: "/app/reports", icon: FileBarChart2, module: "reports" },
      { key: "logs", to: "/app/logs", icon: ScrollText, module: "logs" },
    ],
  },
  {
    key: "administration",
    items: [
      { key: "messages", to: "/app/messages", icon: MessageSquare, standardPlusOnly: true, module: "messages" },
      { key: "website", to: "/app/website", icon: Globe, premiumOnly: true, module: "website" },
      { key: "users", to: "/app/users", icon: Users, adminOnly: true },
      { key: "settings", to: "/app/settings", icon: Settings, module: "settings" },
    ],
  },
];

export default function AppShell() {
  const { user, tenant, logout } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggle } = useTheme();
  useTenantBranding(tenant);
  const nav = useNavigate();
  const location = useLocation();

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdResults, setCmdResults] = useState([]);
  const [cmdBusy, setCmdBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar_collapsed") === "1");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // The drawer is an overlay on phones: close it whenever navigation happens,
  // and stop the page behind it from scrolling while it's open.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (e) => e.key === "Escape" && setMobileNavOpen(false);
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!cmdOpen) {
      setCmdQuery("");
      setCmdResults([]);
      return;
    }
  }, [cmdOpen]);

  // The collapsed "icon rail" only exists at lg+. Below that the sidebar is a
  // full-width drawer, so a collapse preference saved on a desktop must not
  // leave a phone user with an unlabelled strip of icons.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync); // belt and braces: some embedded
    sync();                                  // webviews don't fire mq change
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  const railMode = collapsed && isDesktop;

  useEffect(() => {
    if (!cmdQuery.trim()) {
      setCmdResults([]);
      return;
    }
    setCmdBusy(true);
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q: cmdQuery.trim() } });
        setCmdResults(data.results || []);
      } catch (_) {
        setCmdResults([]);
      } finally {
        setCmdBusy(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [cmdQuery]);

  const isAdmin = user && (user.role === "owner" || user.role === "director" || user.role === "super_admin");
  const isPremium = tenant?.plan === "premium";
  const isStandardPlus = tenant?.plan && tenant.plan !== "basic";

  const initials = useMemo(() => {
    const n = user?.name || user?.email || "?";
    return n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  }, [user]);

  const goTo = (r) => {
    setCmdOpen(false);
    const map = {
      student: `/app/students`,
      teacher: `/app/teachers`,
      parent: `/app/parents`,
      course: `/app/courses`,
      group: `/app/groups`,
      payment: `/app/payments`,
      session: `/app/sessions`,
      grade: `/app/grades`,
      user: `/app/users`,
    };
    nav(map[r.type] || "/app/dashboard");
  };

  return (
    <div className={`min-h-screen bg-background text-foreground lg:grid ${collapsed ? "lg:grid-cols-[68px_1fr]" : "lg:grid-cols-[240px_1fr]"} lg:transition-[grid-template-columns] lg:duration-200`}>
      {/* Scrim behind the mobile drawer */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label={t("actions.close")}
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* Sidebar — off-canvas drawer below lg, static grid column at lg+ */}
      <aside
        data-testid={APPUI.sidebar}
        className="mobile-drawer fixed inset-y-0 start-0 z-50 w-[264px] border-e border-border bg-card flex flex-col h-screen overflow-hidden lg:sticky lg:top-0 lg:z-auto lg:w-auto lg:bg-card/40"
        style={{
          transform: isDesktop
            ? undefined
            : mobileNavOpen
              ? "translateX(0)"
              : `translateX(${dir === "rtl" ? "100%" : "-100%"})`,
        }}
      >
        <div className={`p-4 border-b border-border flex items-center gap-1 ${railMode ? "flex-col" : ""}`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid={APPUI.tenantSwitcher}
                className="flex-1 min-w-0 flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="w-8 h-8 rounded-md bg-primary grid place-items-center flex-shrink-0 overflow-hidden">
                  {tenant?.logo_url ? (
                    <img
                      src={resolveFileUrl(tenant.logo_url)}
                      alt={tenant?.name || "Workspace logo"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="font-display font-black text-primary-foreground text-sm">
                      {(tenant?.name || "S")[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                {!railMode && (
                  <>
                    <div className="min-w-0 flex-1 text-start">
                      <div className="text-sm font-semibold truncate">
                        {tenant?.name || "Scolaris"}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {tenant?.slug ? `${tenant.slug}.scolaris.cloud` : "workspace"}
                      </div>
                    </div>
                    <ChevronsUpDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-popover" align="start">
              <DropdownMenuLabel className="text-xs">{t("common.workspace")}</DropdownMenuLabel>
              <DropdownMenuItem>
                <Building2 className="w-4 h-4 me-2" />
                <div className="text-sm">
                  <div className="font-medium">{tenant?.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {tenant?.plan ? t(`plan.${tenant.plan}`) : ""} · {tenant?.status ? t(`status.${tenant.status}`) : ""}
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/app/settings">
                  <Settings className="w-4 h-4 me-2" />
                  {t("common.workspace_settings")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex flex-shrink-0 h-8 w-8"
            onClick={() => setCollapsed((v) => !v)}
            data-testid="sidebar-collapse-toggle"
            aria-label={t(collapsed ? "common.expand_sidebar" : "common.collapse_sidebar")}
            title={t(collapsed ? "common.expand_sidebar" : "common.collapse_sidebar")}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden flex-shrink-0 h-8 w-8"
            onClick={() => setMobileNavOpen(false)}
            data-testid="sidebar-close"
            aria-label={t("actions.close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 p-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((n) =>
              (!n.adminOnly || isAdmin) &&
              (!n.premiumOnly || isPremium) &&
              (!n.standardPlusOnly || isStandardPlus) &&
              (!n.module || getModulePermission(user, n.module) !== "hidden")
            );
            if (items.length === 0) return null;
            return (
              <div
                key={group.key}
                className={
                  railMode
                    ? "mt-2 pt-2 border-t border-border first:mt-0 first:pt-0 first:border-0"
                    : "mb-4 last:mb-0"
                }
              >
                {!railMode && group.key !== "overview" && (
                  <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t(`nav_category.${group.key}`)}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.key}
                      to={item.to}
                      data-testid={APPUI.sidebarLink(item.key)}
                      title={railMode ? t(`menu.${item.key}`) : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-md text-sm transition-colors ${railMode ? "justify-center" : ""} ${
                          isActive
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`
                      }
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {!railMode && <span className="truncate">{t(`menu.${item.key}`)}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          {!railMode && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 px-2">
                {t("common.plan_active")}
              </div>
              <div className="px-2 pb-3 text-xs text-muted-foreground capitalize">
                {tenant?.plan ? t(`plan.${tenant.plan}`) : t("common.free")}
                {tenant?.billing_cycle ? ` · ${t(`cycle.${tenant.billing_cycle}`)}` : ""}
              </div>
            </>
          )}
          <Button
            variant="outline"
            size={railMode ? "icon" : "sm"}
            className={railMode ? "w-full" : "w-full text-xs"}
            onClick={() => nav("/app/settings")}
            data-testid="sidebar-upgrade-button"
            title={railMode ? t("common.upgrade") : undefined}
          >
            {railMode ? <Layers className="w-4 h-4" /> : t("common.upgrade")}
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border glass-nav flex items-center gap-2 sm:gap-3 px-3 sm:px-6 sticky top-0 z-30">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden flex-shrink-0 h-9 w-9"
            onClick={() => setMobileNavOpen(true)}
            data-testid="mobile-nav-toggle"
            aria-label={t("common.expand_sidebar")}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <button
            onClick={() => setCmdOpen(true)}
            data-testid={APPUI.topbarSearch}
            aria-label={t("actions.search")}
            className="flex items-center justify-center sm:justify-start gap-2 w-9 sm:w-full sm:max-w-md h-9 rounded-lg border border-border bg-background text-muted-foreground sm:px-3 text-sm hover:border-foreground/40 transition-colors flex-shrink-0 sm:flex-shrink"
          >
            <Search className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">{t("actions.search")}</span>
            <span className="ms-auto hidden md:flex gap-1">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
            </span>
          </button>

          <div className="ms-auto flex items-center gap-0.5 sm:gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid={APPUI.langSwitcher} aria-label="Language">
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover">
                {["fr", "en", "ar"].map((l) => (
                  <DropdownMenuItem key={l} onClick={() => setLang(l)}>
                    {l === "fr" ? "Français" : l === "en" ? "English" : "العربية"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="ghost" size="icon" onClick={toggle}
              data-testid={APPUI.themeToggle} aria-label="Theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 h-9 rounded-full p-1 md:ps-1 md:pe-3 hover:bg-muted transition-colors"
                  data-testid={APPUI.userMenu}
                  aria-label={user?.name || t("common.signed_in_as")}
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-accent text-accent-foreground font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block text-start leading-tight max-w-[140px]">
                    <div className="text-xs font-medium truncate">{user?.name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize truncate">{user?.role}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover">
                <DropdownMenuLabel>
                  <div className="text-xs font-normal text-muted-foreground">{t("common.signed_in_as")}</div>
                  <div className="text-sm truncate">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/app/settings">
                    <Settings className="w-4 h-4 me-2" /> {t("menu.settings")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await logout();
                    nav("/", { replace: true });
                  }}
                  data-testid={AUTH.logout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="w-4 h-4 me-2" /> {t("common.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput
          placeholder={t("actions.search")}
          value={cmdQuery}
          onValueChange={setCmdQuery}
          data-testid={APPUI.topbarSearchInput}
        />
        <CommandList>
          {cmdBusy && <div className="p-3 text-xs text-muted-foreground">{t("search.searching")}</div>}
          {!cmdBusy && cmdResults.length === 0 && cmdQuery && (
            <CommandEmpty>{t("search.no_results")}</CommandEmpty>
          )}
          {!cmdQuery && (
            <CommandGroup heading={t("search.quick_actions")}>
              {[
                { l: t("search.go_to", { module: t("menu.students") }), to: "/app/students" },
                { l: t("search.go_to", { module: t("menu.payments") }), to: "/app/payments" },
                { l: t("search.go_to", { module: t("menu.sessions") }), to: "/app/sessions" },
                { l: t("search.mark_attendance"), to: "/app/attendance" },
              ].map((a) => (
                <CommandItem
                  key={a.to}
                  onSelect={() => {
                    setCmdOpen(false);
                    nav(a.to);
                  }}
                >
                  {a.l}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {cmdResults.length > 0 && (
            <CommandGroup heading={t("search.results")}>
              {cmdResults.map((r) => (
                <CommandItem
                  key={`${r.type}-${r.id}`}
                  onSelect={() => goTo(r)}
                  data-testid={APPUI.topbarSearchResult(r.id)}
                  className="flex items-center gap-2"
                >
                  <span className="text-[10px] uppercase font-mono text-muted-foreground w-16">
                    {r.type}
                  </span>
                  <span>{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </div>
  );
}

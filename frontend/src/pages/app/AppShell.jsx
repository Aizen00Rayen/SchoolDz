import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, BookOpen, Building2, CalendarClock, ChevronsUpDown, ClipboardCheck,
  FileBarChart2, GraduationCap, Languages, LogOut, Moon, Search, Settings,
  Sun, Users, UserRound, Wallet, Layers,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { APPUI, AUTH } from "@/constants/testIds";
import { api } from "@/lib/api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const NAV = [
  { key: "dashboard", to: "/app/dashboard", icon: BarChart3 },
  { key: "students", to: "/app/students", icon: GraduationCap },
  { key: "parents", to: "/app/parents", icon: UserRound },
  { key: "teachers", to: "/app/teachers", icon: Users },
  { key: "courses", to: "/app/courses", icon: BookOpen },
  { key: "groups", to: "/app/groups", icon: Layers },
  { key: "sessions", to: "/app/sessions", icon: CalendarClock },
  { key: "attendance", to: "/app/attendance", icon: ClipboardCheck },
  { key: "payments", to: "/app/payments", icon: Wallet },
  { key: "reports", to: "/app/reports", icon: FileBarChart2 },
  { key: "users", to: "/app/users", icon: Users, adminOnly: true },
  { key: "settings", to: "/app/settings", icon: Settings },
];

export default function AppShell() {
  const { user, tenant, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [cmdResults, setCmdResults] = useState([]);
  const [cmdBusy, setCmdBusy] = useState(false);

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
    };
    nav(map[r.type] || "/app/dashboard");
  };

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-[240px_1fr]">
      {/* Sidebar */}
      <aside
        data-testid={APPUI.sidebar}
        className="border-e border-border bg-card/40 flex flex-col h-screen sticky top-0"
      >
        <div className="p-4 border-b border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid={APPUI.tenantSwitcher}
                className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted transition-colors group"
              >
                <div className="w-8 h-8 rounded-md bg-primary grid place-items-center flex-shrink-0">
                  <span className="font-display font-black text-primary-foreground text-sm">
                    {(tenant?.name || "S")[0]?.toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1 text-start">
                  <div className="text-sm font-semibold truncate">
                    {tenant?.name || "SchoolDZ"}
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">
                    {tenant?.slug ? `${tenant.slug}.schooldz.com` : "workspace"}
                  </div>
                </div>
                <ChevronsUpDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 bg-popover" align="start">
              <DropdownMenuLabel className="text-xs">Workspace</DropdownMenuLabel>
              <DropdownMenuItem>
                <Building2 className="w-4 h-4 me-2" />
                <div className="text-sm">
                  <div className="font-medium">{tenant?.name}</div>
                  <div className="text-[10px] text-muted-foreground capitalize">
                    {tenant?.plan} · {tenant?.status}
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => nav("/app/settings")}>
                <Settings className="w-4 h-4 me-2" />
                Workspace settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              data-testid={APPUI.sidebarLink(item.key)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{t(`menu.${item.key}`)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 px-2">
            Trial
          </div>
          <div className="px-2 pb-3 text-xs text-muted-foreground">
            {tenant?.plan === "pro" ? "Pro plan active" : "14 days remaining"}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => nav("/app/settings")}
            data-testid="sidebar-upgrade-button"
          >
            Manage subscription
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 border-b border-border glass-nav flex items-center gap-3 px-6 sticky top-0 z-30">
          <button
            onClick={() => setCmdOpen(true)}
            data-testid={APPUI.topbarSearch}
            className="flex items-center gap-2 w-full max-w-md h-9 rounded-lg border border-border bg-background text-muted-foreground px-3 text-sm hover:border-foreground/40 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span>{t("actions.search")}</span>
            <span className="ms-auto flex gap-1">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
            </span>
          </button>

          <div className="ms-auto flex items-center gap-1">
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
                  className="flex items-center gap-2 h-9 rounded-full ps-1 pe-3 hover:bg-muted transition-colors"
                  data-testid={APPUI.userMenu}
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-accent text-accent-foreground font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden md:block text-start leading-tight">
                    <div className="text-xs font-medium">{user?.name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{user?.role}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-popover">
                <DropdownMenuLabel>
                  <div className="text-xs font-normal text-muted-foreground">Signed in as</div>
                  <div className="text-sm truncate">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => nav("/app/settings")}>
                  <Settings className="w-4 h-4 me-2" /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    nav("/", { replace: true });
                  }}
                  data-testid={AUTH.logout}
                  className="text-red-600 focus:text-red-600"
                >
                  <LogOut className="w-4 h-4 me-2" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 min-w-0">
          <motion.div
            key={window.location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="max-w-[1280px] mx-auto px-6 py-8"
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
          {cmdBusy && <div className="p-3 text-xs text-muted-foreground">Searching…</div>}
          {!cmdBusy && cmdResults.length === 0 && cmdQuery && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {!cmdQuery && (
            <CommandGroup heading="Quick actions">
              {[
                { l: "Go to Students", to: "/app/students" },
                { l: "Go to Payments", to: "/app/payments" },
                { l: "Go to Sessions", to: "/app/sessions" },
                { l: "Mark Attendance", to: "/app/attendance" },
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
            <CommandGroup heading="Results">
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

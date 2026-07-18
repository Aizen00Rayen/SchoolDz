import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MessageSquare, Moon, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme, useTenantBranding } from "@/lib/theme";
import { api, resolveFileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Light, standalone layout for the parent portal — deliberately not AppShell
 * (no 12-item staff sidebar, no admin nav) since parents only ever see their
 * own children's read-only data. */
export default function PortalShell() {
  const { user, tenant, logout } = useAuth();
  const { theme, toggle } = useTheme();
  useTenantBranding(tenant);
  const nav = useNavigate();

  const { data: convo } = useQuery({
    queryKey: ["portal-conversation"],
    queryFn: async () => (await api.get("/portal/conversation")).data,
    refetchInterval: 20000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="h-14 border-b border-border glass-nav flex items-center gap-3 px-6 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-primary grid place-items-center flex-shrink-0 overflow-hidden">
            {tenant?.logo_url ? (
              <img src={resolveFileUrl(tenant.logo_url)} alt={tenant?.name || "Workspace logo"} className="w-full h-full object-cover" />
            ) : (
              <span className="font-display font-black text-primary-foreground text-xs">
                {(tenant?.name || "S")[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold">{tenant?.name || "Scolaris"}</div>
          <span className="text-xs text-muted-foreground ms-2">Parent portal</span>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <span className="hidden md:block text-xs text-muted-foreground">{user?.name}</span>
          <Button variant="ghost" size="icon" asChild className="relative">
            <Link to="/portal/messages" aria-label="Messages">
              <MessageSquare className="h-4 w-4" />
              {convo?.unread_by_guardian && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" />
              )}
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            onClick={async () => { await logout(); nav("/", { replace: true }); }}
            className="text-destructive hover:bg-destructive/10"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

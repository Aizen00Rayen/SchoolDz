import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Languages, Moon, Sun } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export default function AuthLayout({ children, title, subtitle, footer }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-background grid grid-cols-1 lg:grid-cols-2">
      {/* Left panel (branding) */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground overflow-hidden">
        <div className="absolute inset-0 grid-hero opacity-30 pointer-events-none" />
        <Link to="/" className="relative flex items-center gap-2 z-10" data-testid="auth-brand-link">
          <div className="w-8 h-8 bg-accent rounded-md grid place-items-center">
            <span className="font-display font-black text-accent-foreground text-sm">S</span>
          </div>
          <span className="font-display font-bold text-lg tracking-tight">schooldz</span>
        </Link>

        <div className="relative z-10">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-primary-foreground/60 mb-3">
            {t("auth.brand.tag")}
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-black leading-[1.05] tracking-tighter mb-6">
            {t("auth.brand.title")}
          </h2>
          <p className="text-primary-foreground/70 max-w-md leading-relaxed">
            {t("auth.brand.desc")}
          </p>
        </div>

        <div className="relative z-10 font-mono text-xs text-primary-foreground/50">
          <div className="mb-2">→ schooldz.com/&lt;yourschool&gt;</div>
          <div>© {new Date().getFullYear()} SchoolDZ</div>
        </div>
      </div>

      {/* Right panel (form) */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-6">
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <div className="w-7 h-7 bg-primary rounded-md grid place-items-center">
              <span className="font-display font-black text-primary-foreground text-xs">S</span>
            </div>
            <span className="font-display font-bold tracking-tight">schooldz</span>
          </Link>
          <div className="ms-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="auth-lang-switcher">
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
            <Button variant="ghost" size="icon" onClick={toggle} data-testid="auth-theme-toggle">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-md">
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-2">
              {title}
            </h1>
            {subtitle && <p className="text-muted-foreground mb-8">{subtitle}</p>}
            {children}
            {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

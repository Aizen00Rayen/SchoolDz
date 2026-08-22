import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { MARKETING } from "@/constants/testIds";
import { Menu, Moon, Sun, Languages, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SECTIONS = [
  { to: "/#features", key: "nav.features" },
  { to: "/pricing", key: "nav.pricing" },
  { to: "/about", key: "nav.about" },
];

export default function MarketingNav() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the panel on any navigation — it overlays the page it links into.
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-40 glass-nav" key={location.pathname}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4">
        <Link to="/" className="group" data-testid="marketing-logo-link">
          <Logo size={28} textClassName="text-lg" />
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          {SECTIONS.map((s) => (
            <Link key={s.to} to={s.to} className="text-muted-foreground hover:text-foreground transition-colors">
              {t(s.key)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-testid={MARKETING.langSwitcher}
                aria-label="Change language"
              >
                <Languages className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {["fr", "en", "ar"].map((l) => (
                <DropdownMenuItem
                  key={l}
                  onClick={() => setLang(l)}
                  data-testid={`lang-option-${l}`}
                  className={lang === l ? "font-semibold" : ""}
                >
                  {l === "fr" ? "Français" : l === "en" ? "English" : "العربية"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            data-testid={MARKETING.themeToggle}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button variant="ghost" size="sm" className="hidden md:inline-flex text-sm font-medium" asChild>
            <Link to="/login" data-testid={MARKETING.navLogin}>
              {t("nav.login")}
            </Link>
          </Button>
          <Button
            size="sm"
            className="hidden md:inline-flex text-sm font-medium bg-accent hover:bg-accent/90 text-accent-foreground"
            asChild
          >
            <Link to="/register" data-testid={MARKETING.navSignup}>
              {t("nav.signup")}
            </Link>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            data-testid="marketing-menu-toggle"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? t("actions.close") : t("nav.menu")}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Phone menu. Without this the section links and sign-in are simply
          unreachable below md — they were display:none with nothing replacing them. */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-xl px-4 py-3 flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              onClick={closeMenu}
              className="py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t(s.key)}
            </Link>
          ))}
          <div className="h-px bg-border my-2" />
          <Button variant="outline" size="sm" className="w-full" asChild onClick={closeMenu}>
            <Link to="/login" data-testid={`${MARKETING.navLogin}-mobile`}>{t("nav.login")}</Link>
          </Button>
          <Button
            size="sm"
            className="w-full mt-2 bg-accent hover:bg-accent/90 text-accent-foreground"
            asChild
            onClick={closeMenu}
          >
            <Link to="/register" data-testid={`${MARKETING.navSignup}-mobile`}>{t("nav.signup")}</Link>
          </Button>
        </div>
      )}
    </header>
  );
}

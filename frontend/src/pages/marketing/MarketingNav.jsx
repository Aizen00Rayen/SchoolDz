import { Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { MARKETING } from "@/constants/testIds";
import { Moon, Sun, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MarketingNav() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 glass-nav">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 group" data-testid="marketing-logo-link">
          <div className="w-8 h-8 bg-primary rounded-md grid place-items-center">
            <span className="font-display font-black text-primary-foreground text-sm">S</span>
          </div>
          <span className="font-display font-bold text-lg tracking-tight">schooldz</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
            {t("nav.features")}
          </a>
          <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
            {t("nav.pricing")}
          </Link>
          <a href="#about" className="text-muted-foreground hover:text-foreground transition-colors">
            {t("nav.about")}
          </a>
        </nav>

        <div className="flex items-center gap-2">
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

          <Link to="/login" data-testid={MARKETING.navLogin}>
            <Button variant="ghost" size="sm" className="text-sm font-medium">
              {t("nav.login")}
            </Button>
          </Link>
          <Link to="/register" data-testid={MARKETING.navSignup}>
            <Button
              size="sm"
              className="text-sm font-medium bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {t("nav.signup")}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

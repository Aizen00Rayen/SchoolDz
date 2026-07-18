import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("schooldz_theme") || "light");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("schooldz_theme", theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** #rrggbb -> "H S% L%" matching the app's --var format (see index.css). */
function hexToHslString(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Picks a readable black/white foreground for a given #rrggbb background. */
function contrastForeground(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "240 5% 4%" : "0 0% 98%";
}

/**
 * Applies a tenant's white-label primary/accent colors as CSS custom
 * property overrides on the document root, so a school's chosen branding
 * (Settings → Branding) actually shows up across their workspace instead of
 * only being stored. Scoped to whichever shell calls it (AppShell,
 * PortalShell) — unmounting reverts to the base Scolaris theme.
 */
export function useTenantBranding(tenant) {
  useEffect(() => {
    const root = document.documentElement;
    const primaryHsl = hexToHslString(tenant?.primary_color);
    const accentHsl = hexToHslString(tenant?.accent_color);

    if (primaryHsl) {
      root.style.setProperty("--primary", primaryHsl);
      root.style.setProperty("--ring", primaryHsl);
      root.style.setProperty("--primary-foreground", contrastForeground(tenant.primary_color));
    }
    if (accentHsl) {
      root.style.setProperty("--accent", accentHsl);
      root.style.setProperty("--accent-foreground", contrastForeground(tenant.accent_color));
    }

    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-foreground");
    };
  }, [tenant?.primary_color, tenant?.accent_color]);
}

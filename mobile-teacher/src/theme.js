// Shared design tokens — keep mobile-parent and mobile-teacher visually consistent.
export const ACCENT = "#E53935";
export const ACCENT_DARK = "#C62828";
export const INK = "#0A0A0B";
export const MUTED = "#71717A";
export const BORDER = "#E7E7EA";
export const BG = "#F7F7F9";
export const CARD = "#FFFFFF";

export const OK = "#16A34A";
export const WARN = "#D97706";
export const INFO = "#2563EB";

export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Soft elevation for cards — same recipe on iOS (shadow*) and Android (elevation).
export const SHADOW_SM = {
  shadowColor: "#0A0A0B",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
  elevation: 2,
};

export const SHADOW_MD = {
  shadowColor: "#0A0A0B",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 4,
};

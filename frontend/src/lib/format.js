// Shared, language-aware formatting for money, numbers and dates.
//
// The current UI language is pushed here by I18nProvider (setFormatLang) so
// plain helpers can be called anywhere — table cell renderers, print HTML
// builders — without threading `lang` through every call. Components that
// use these helpers already re-render on a language change because they
// read `t` from useI18n.

let currentLang = "en";

export function setFormatLang(lang) {
  currentLang = lang || "en";
}

export function getFormatLang() {
  return currentLang;
}

// Algeria writes Western digits even in Arabic, hence "-u-nu-latn".
const NUMBER_LOCALES = { en: "en-US", fr: "fr-FR", ar: "ar-DZ-u-nu-latn" };
// en-GB rather than en-US: day before month, like the rest of the country.
const DATE_LOCALES = { en: "en-GB", fr: "fr-FR", ar: "ar-DZ-u-nu-latn" };

function numberLocale(lang = currentLang) {
  return NUMBER_LOCALES[lang] || NUMBER_LOCALES.en;
}

export function dateLocale(lang = currentLang) {
  return DATE_LOCALES[lang] || DATE_LOCALES.en;
}

/** "DZD" is shown the way people write it: دج in Arabic, DA in French. */
export function currencyLabel(code, lang = currentLang) {
  const c = String(code || "DZD").toUpperCase();
  if (c === "DZD") return lang === "ar" ? "دج" : lang === "fr" ? "DA" : "DZD";
  return c;
}

export function formatNumber(value, { decimals = 0, lang = currentLang } = {}) {
  const n = Number(value || 0);
  return new Intl.NumberFormat(numberLocale(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** 1,250,000 DZD — or, with compact, 1.25M DZD (full value goes in a title). */
export function formatMoney(value, currency, { compact = false, decimals = 0, lang = currentLang } = {}) {
  const n = Number(value || 0);
  const label = currencyLabel(currency, lang);
  if (compact && Math.abs(n) >= 100000) {
    const short = new Intl.NumberFormat(numberLocale(lang), {
      notation: "compact",
      maximumFractionDigits: Math.abs(n) >= 1e6 ? 2 : 1,
    }).format(n);
    return `${short} ${label}`;
  }
  return `${formatNumber(n, { decimals, lang })} ${label}`;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare "YYYY-MM-DD" is a calendar date, not midnight UTC.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE_STYLES = {
  short: { day: "2-digit", month: "2-digit", year: "numeric" },           // 22/10/2026
  medium: { day: "numeric", month: "short", year: "numeric" },            // 22 Oct 2026
  long: { weekday: "long", day: "numeric", month: "long", year: "numeric" }, // Thursday 22 October 2026
  month: { month: "short" },                                              // Oct
  monthYear: { month: "long", year: "numeric" },                          // October 2026
};

export function formatDate(value, style = "medium", lang = currentLang) {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(dateLocale(lang), DATE_STYLES[style] || DATE_STYLES.medium).format(d);
}

export function formatTime(value, lang = currentLang) {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDateTime(value, lang = currentLang) {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(d, "medium", lang)} · ${formatTime(d, lang)}`;
}

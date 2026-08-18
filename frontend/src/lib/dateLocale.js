import { enUS, fr, arDZ } from "date-fns/locale";
import { useI18n } from "@/lib/i18n";

const LOCALES = { en: enUS, fr, ar: arDZ };

/** date-fns locale matching the current UI language — arDZ specifically
 * (not the Gulf 'ar') since Algeria writes Western-Arabic digits, only the
 * month/weekday names and AM/PM markers actually change with locale. */
export function useDateLocale() {
  const { lang } = useI18n();
  return LOCALES[lang] || enUS;
}

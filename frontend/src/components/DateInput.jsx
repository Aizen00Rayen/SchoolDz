import { forwardRef, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { dateLocale } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Drop-in replacement for <Input type="date">: same `value` ("YYYY-MM-DD"
// or "") and the same onChange(e) shape (e.target.value), but it always
// shows day/month/year — the browser's native field follows the browser's
// language (mm/dd/yyyy on most machines) and can't be changed per page.

const pad = (n) => String(n).padStart(2, "0");
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Accepts 22/10/2026, 22-10-2026, 22.10.2026, 2026-10-22 and 22/10/26. */
export function parseTypedDate(text) {
  const s = (text || "").trim();
  if (!s) return "";
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  let y, mo, d;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return toIso(date);
}

// Layout classes size the wrapper; everything else styles the input itself.
const LAYOUT_CLASS = /^(?:[a-z]+:)?(?:w-|min-w-|max-w-|flex-|basis-|grow|shrink|col-|row-|self-|order-|m[trblxyse]?-)/;
function splitClasses(className = "") {
  const parts = className.split(/\s+/).filter(Boolean);
  return [parts.filter((c) => LAYOUT_CLASS.test(c)).join(" "), parts.filter((c) => !LAYOUT_CLASS.test(c)).join(" ")];
}

const display = (iso) => {
  const d = parseIso(iso);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "";
};

const PLACEHOLDER = { ar: "يوم/شهر/سنة", fr: "jj/mm/aaaa", en: "dd/mm/yyyy" };
const LABELS = {
  ar: { today: "اليوم", clear: "مسح", open: "اختيار التاريخ", prev: "الشهر السابق", next: "الشهر التالي" },
  fr: { today: "Aujourd'hui", clear: "Effacer", open: "Choisir une date", prev: "Mois précédent", next: "Mois suivant" },
  en: { today: "Today", clear: "Clear", open: "Pick a date", prev: "Previous month", next: "Next month" },
};

const DateInput = forwardRef(function DateInput(
  { value, onChange, className, disabled, required, min, max, placeholder, id, name, ...rest },
  ref,
) {
  const { lang, dir } = useI18n();
  const labels = LABELS[lang] || LABELS.en;
  const [text, setText] = useState(display(value));
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const [view, setView] = useState(() => selected || new Date());

  // Keep the text in sync when the value changes from outside (form reset).
  useEffect(() => {
    setText(display(value));
    const d = parseIso(value);
    if (d) setView(d);
  }, [value]);

  const emit = (iso) => onChange?.({ target: { value: iso, name } });

  const commitText = () => {
    const iso = parseTypedDate(text);
    if (iso === null) return; // leave the typed text; the field shows as invalid
    if (iso !== (value || "")) emit(iso);
    setText(display(iso));
  };

  const minD = parseIso(min);
  const maxD = parseIso(max);
  const isDisabled = (d) => (minD && d < minD) || (maxD && d > maxD);

  const locale = dateLocale(lang);
  const weekStart = lang === "en" || lang === "fr" ? 1 : 0; // Monday; Sunday in Arabic
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    // 2024-01-07 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 7 + ((i + weekStart) % 7))));
  }, [locale, weekStart]);
  const months = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: "long" });
    return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2024, i, 1)));
  }, [locale]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  const thisYear = new Date().getFullYear();
  const fromYear = minD ? minD.getFullYear() : Math.min(1940, year);
  const toYear = maxD ? maxD.getFullYear() : Math.max(thisYear + 5, year);
  const years = [];
  for (let y = toYear; y >= fromYear; y -= 1) years.push(y);
  const todayIso = toIso(new Date());
  const invalid = text && parseTypedDate(text) === null;
  const [wrapperClass, inputClass] = splitClasses(className);
  const Prev = dir === "rtl" ? ChevronRight : ChevronLeft;
  const Next = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div dir="ltr" className={cn("relative w-full", wrapperClass)}>
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          disabled={disabled}
          required={required}
          placeholder={placeholder || PLACEHOLDER[lang] || PLACEHOLDER.en}
          aria-invalid={invalid || undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitText(); }
          }}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent ps-3 pe-9 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm font-mono text-start",
            inputClass,
            invalid && "border-destructive focus-visible:ring-destructive",
          )}
          {...rest}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={labels.open}
            title={labels.open}
            className="absolute inset-y-0 end-0 px-2.5 grid place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <CalendarDays className="w-4 h-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" className="w-[17rem] p-3" dir={dir}>
        <div className="flex items-center gap-1 mb-2">
          <button type="button" aria-label={labels.prev} className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted"
                  onClick={() => setView(new Date(year, month - 1, 1))}>
            <Prev className="w-4 h-4" />
          </button>
          <select aria-label="month" value={month} onChange={(e) => setView(new Date(year, Number(e.target.value), 1))}
                  className="flex-1 min-w-0 h-7 rounded-md border border-input bg-transparent px-1 text-sm">
            {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select aria-label="year" value={year} onChange={(e) => setView(new Date(Number(e.target.value), month, 1))}
                  className="w-[4.75rem] h-7 rounded-md border border-input bg-transparent px-1 text-sm font-mono">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" aria-label={labels.next} className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted"
                  onClick={() => setView(new Date(year, month + 1, 1))}>
            <Next className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground mb-1">
          {weekdays.map((w, i) => <div key={i}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />;
            const iso = toIso(d);
            const isSel = selected && iso === toIso(selected);
            return (
              <button
                key={iso}
                type="button"
                disabled={isDisabled(d)}
                onClick={() => { emit(iso); setOpen(false); }}
                className={cn(
                  "h-8 rounded-md text-sm font-mono hover:bg-muted disabled:opacity-30 disabled:pointer-events-none",
                  iso === todayIso && !isSel && "ring-1 ring-border",
                  isSel && "bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 pt-2 border-t">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { emit(""); setOpen(false); }}>
            {labels.clear}
          </button>
          <button type="button" className="text-xs font-medium hover:underline"
                  onClick={() => { emit(todayIso); setOpen(false); }}>
            {labels.today}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
});

export { DateInput };
export default DateInput;

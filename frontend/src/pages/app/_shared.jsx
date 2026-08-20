import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, format, addMonths, subMonths, addWeeks, subWeeks,
} from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Download, Repeat, Send, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { api, extractError, downloadExport } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useDateLocale } from "@/lib/dateLocale";
import { SCHOOL_LEVELS, SCHOOL_LEVEL_YEAR_COUNT, specialtiesFor } from "@/lib/schoolLevels";

export function Field({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

/** Level -> year -> specialty selectors for the Algerian school system,
 * shared by the student and course forms. The specialty select only appears
 * for high-school years, and offers the common-core tracks in year 1 vs the
 * branch specialties in years 2-3 (see lib/schoolLevels.js). */
export function SchoolLevelFields({ form, setForm }) {
  const { t } = useI18n();
  const specialties = specialtiesFor(form.school_level, form.school_year);
  return (
    <>
      <Field label={t("field.school_level")}>
        <Select
          value={form.school_level || "__none"}
          onValueChange={(v) => setForm({ ...form, school_level: v === "__none" ? "" : v, school_year: "", specialty: "" })}
        >
          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="__none">—</SelectItem>
            {SCHOOL_LEVELS.map((lvl) => (
              <SelectItem key={lvl} value={lvl}>{t(`school_level.${lvl}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("field.school_year")}>
        <Select
          value={form.school_year ? String(form.school_year) : "__none"}
          onValueChange={(v) => setForm({ ...form, school_year: v === "__none" ? "" : Number(v), specialty: "" })}
          disabled={!form.school_level}
        >
          <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="__none">—</SelectItem>
            {Array.from({ length: SCHOOL_LEVEL_YEAR_COUNT[form.school_level] || 0 }, (_, i) => i + 1).map((y) => (
              <SelectItem key={y} value={String(y)}>{t("common.year_n", { n: y })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {specialties.length > 0 && (
        <div className="md:col-span-2">
          <Field label={t("field.specialty")}>
            <Select
              value={form.specialty || "__none"}
              onValueChange={(v) => setForm({ ...form, specialty: v === "__none" ? "" : v })}
            >
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="__none">—</SelectItem>
                {specialties.map((sp) => (
                  <SelectItem key={sp} value={sp}>{t(`specialty.${sp}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
    </>
  );
}

/** Compact "High school · Year 2 / Experimental Sciences" cell for list views. */
export function SchoolLevelCell({ row }) {
  const { t } = useI18n();
  if (!row.school_level) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="text-xs">
      <div>
        {t(`school_level.${row.school_level}`)}
        {row.school_year ? ` · ${t("common.year_n", { n: row.school_year })}` : ""}
      </div>
      {row.specialty && <div className="text-muted-foreground">{t(`specialty.${row.specialty}`)}</div>}
    </div>
  );
}

/** Room dropdown sourced from /rooms, used by Groups and Sessions forms
 * instead of a free-text field — lets the Rooms occupancy view actually
 * know which sessions are in which room. */
export function RoomSelect({ value, onChange }) {
  const { t } = useI18n();
  const { data: rooms } = useQuery({
    queryKey: ["rooms-list"],
    queryFn: async () => (await api.get("/rooms")).data,
  });
  return (
    <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
      <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent className="bg-popover">
        <SelectItem value="__none">—</SelectItem>
        {(rooms?.items || []).map((r) => (
          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Single-student search-by-name-or-code field — the same search pattern as
 * StudentPicker (ParentsPage.jsx) but for a single id instead of a list, for
 * forms like Payments where a plain dropdown of every student doesn't scale
 * past a few hundred records. */
export function StudentSearchSelect({ value, onChange, placeholder }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isFetching } = useQuery({
    queryKey: ["students-search", debounced],
    queryFn: async () => (await api.get("/students", { params: { q: debounced, limit: 10 } })).data,
    enabled: open && debounced.length > 0,
  });

  // Resolve a label for a pre-selected id (editing an existing record) that
  // never came through a search result in this render.
  useQuery({
    queryKey: ["students-labels", value],
    queryFn: async () => {
      const { data } = await api.get("/students", { params: { ids: value } });
      const s = data.items[0];
      if (s) setLabel(`${s.first_name} ${s.last_name}`);
      return data;
    },
    enabled: !!value && !label,
  });

  const select = (s) => {
    onChange(s.id);
    setLabel(`${s.first_name} ${s.last_name}`);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setLabel("");
    setQuery("");
  };

  if (value && label && !open) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-border bg-background text-sm">
        <span className="flex-1 truncate font-medium">{label}</span>
        <button type="button" onClick={clear} className="text-muted-foreground hover:text-destructive flex-shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || t("picker.search_students")}
        data-testid="student-search-select"
      />
      {open && debounced && (
        <div className="absolute z-10 w-full border border-border rounded-lg mt-1.5 max-h-48 overflow-y-auto bg-popover shadow-md">
          {isFetching ? (
            <div className="text-xs text-muted-foreground p-2">{t("actions.loading")}</div>
          ) : (results?.items || []).length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">{t("picker.no_students")}</div>
          ) : (
            results.items.map((s) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(s)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-start hover:bg-muted/60 cursor-pointer"
                data-testid={`student-search-select-result-${s.id}`}
              >
                <span>{s.first_name} {s.last_name}</span>
                <span className="text-[11px] font-mono text-muted-foreground ms-auto">{s.student_code}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-16 px-6 border border-dashed border-border rounded-xl bg-card/40">
      {Icon && (
        <div className="w-12 h-12 rounded-lg bg-muted mx-auto mb-4 grid place-items-center">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="font-display font-semibold text-lg mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** "Export" dropdown (CSV / Excel) for a list page — hits GET /{resource}/export
 * on the backend, which streams every record the current user can see for
 * that module (not just the currently-paginated/searched page). */
export function ExportMenu({ resource }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const download = async (format) => {
    setBusy(true);
    try {
      await downloadExport(resource, format);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          <Download className="w-4 h-4 me-2" /> {t("export.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover">
        <DropdownMenuItem onClick={() => download("csv")}>{t("export.csv")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download("xlsx")}>{t("export.excel")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Generic "invite to portal/app" button + share-link dialog. Posts to
 * `${endpoint}/${person.id}/invite`, which creates (or reuses) a linked
 * User account and returns a one-time password-set link. Used for both
 * parents (parent portal) and teachers (mobile scanner app). */
export function InviteButton({ person, endpoint, invalidateKey, canInvite = true }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState(null);

  const inviteMut = useMutation({
    mutationFn: () => api.post(`${endpoint}/${person.id}/invite`).then((r) => r.data),
    onSuccess: (data) => {
      setInviteUrl(data.invite_url);
      qc.invalidateQueries({ queryKey: [invalidateKey] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  if (!canInvite) {
    return (
      <Button size="sm" variant="outline" disabled title={t("invite.available_plans")}>
        <Send className="w-3.5 h-3.5 me-1.5" /> {t("invite.invite")}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm" variant="outline"
        disabled={!person.email || inviteMut.isPending}
        onClick={() => inviteMut.mutate()}
        title={!person.email ? t("invite.add_email_first") : undefined}
      >
        <Send className="w-3.5 h-3.5 me-1.5" /> {person.user_id ? t("invite.reinvite") : t("invite.invite")}
      </Button>
      <Dialog open={!!inviteUrl} onOpenChange={(open) => !open && setInviteUrl(null)}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("invite.link_ready")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("invite.share_hint", { name: person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim() })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={inviteUrl || ""} className="font-mono text-xs" />
            <Button
              type="button" size="icon" variant="outline"
              onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success(t("toast.copied")); }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StatusPill({ status, tone = "default" }) {
  const { t } = useI18n();
  const map = {
    active: "bg-success/10 text-success",
    paid: "bg-success/10 text-success",
    completed: "bg-success/10 text-success",
    scheduled: "bg-info/10 text-info",
    pending: "bg-warning/10 text-warning",
    partial: "bg-warning/10 text-warning",
    pending_payment: "bg-warning/10 text-warning",
    inactive: "bg-muted text-muted-foreground",
    suspended: "bg-destructive/10 text-destructive",
    cancelled: "bg-destructive/10 text-destructive",
    refunded: "bg-destructive/10 text-destructive",
    absent: "bg-destructive/10 text-destructive",
    present: "bg-success/10 text-success",
    late: "bg-warning/10 text-warning",
    excused: "bg-info/10 text-info",
    draft: "bg-muted text-muted-foreground",
    graduated: "bg-info/10 text-info",
    archived: "bg-muted text-muted-foreground",
    published: "bg-success/10 text-success",
    closed: "bg-muted text-muted-foreground",
    not_started: "bg-muted text-muted-foreground",
    in_progress: "bg-info/10 text-info",
    submitted: "bg-success/10 text-success",
  };
  const cls = map[status] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls}`}>
      {status ? t(`status.${status}`) : status}
    </span>
  );
}

export function LoadingRows({ rows = 4, cols = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FadeIn({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      {children}
    </motion.div>
  );
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Pure month-grid calendar — dumb/presentational, takes a flat sessions list
 * and groups it by day itself so callers never need to pre-bucket anything.
 * Used by both the staff Calendar page (full CRUD via onDayClick) and the
 * parent portal's read-only session calendar. */
/** Month grid (6 weeks) or a single week strip, depending on `view`.
 * `anchor` is any date inside the period being shown. */
export function CalendarGrid({ month: anchor, sessions, onDayClick, view = "month" }) {
  const { t } = useI18n();
  const isWeek = view === "week";
  const start = isWeek ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor));
  const end = isWeek ? endOfWeek(anchor) : endOfWeek(endOfMonth(anchor));
  const days = eachDayOfInterval({ start, end });

  const byDay = {};
  (sessions || []).forEach((s) => {
    const key = format(new Date(s.start_at), "yyyy-MM-dd");
    (byDay[key] = byDay[key] || []).push(s);
  });

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAY_KEYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium uppercase tracking-widest text-muted-foreground py-2">
            {t(`weekday.${d}`)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const daySessions = (byDay[key] || []).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
          const dimmed = !isWeek && !isSameMonth(day, anchor);
          const visible = isWeek ? daySessions.length : 3;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick?.(day, daySessions)}
              className={`${isWeek ? "min-h-[220px]" : "min-h-[92px]"} p-1.5 border-b border-e border-border text-start align-top hover:bg-muted/40 transition-colors ${dimmed ? "bg-muted/20 text-muted-foreground" : ""}`}
            >
              <div
                className={`text-xs font-mono mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                  isToday(day) ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {daySessions.slice(0, visible).map((s) => (
                  <div key={s.id} className="text-[10px] rounded px-1 py-0.5 bg-accent/10 text-accent">
                    <div className="font-mono">{format(new Date(s.start_at), "HH:mm")}</div>
                    <div className="truncate">{s.group_name || s.topic || ""}</div>
                    {isWeek && s.teacher_name && (
                      <div className="truncate text-muted-foreground">{s.teacher_name}</div>
                    )}
                  </div>
                ))}
                {daySessions.length > visible && (
                  <div className="text-[10px] text-muted-foreground px-1">{t("calendar.more", { count: daySessions.length - visible })}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Header row for a CalendarGrid: month label + prev/next/today nav. */
export function CalendarMonthNav({ month, onChange, view = "month" }) {
  const locale = useDateLocale();
  const isWeek = view === "week";
  const step = (dir) => {
    if (isWeek) return onChange(dir > 0 ? addWeeks(month, 1) : subWeeks(month, 1));
    return onChange(dir > 0 ? addMonths(month, 1) : subMonths(month, 1));
  };
  const label = isWeek
    ? `${format(startOfWeek(month), "d MMM", { locale })} – ${format(endOfWeek(month), "d MMM yyyy", { locale })}`
    : format(month, "MMMM yyyy", { locale });

  return (
    <div className="flex items-center justify-between mb-4">
      <button
        type="button"
        onClick={() => step(-1)}
        className="w-8 h-8 grid place-items-center rounded-md border border-border hover:bg-muted transition-colors"
        aria-label="Previous"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <div className="font-display font-semibold">{label}</div>
      <button
        type="button"
        onClick={() => step(1)}
        className="w-8 h-8 grid place-items-center rounded-md border border-border hover:bg-muted transition-colors"
        aria-label="Next"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

const nowLocalIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** The backend stores everything in UTC (settings.TIME_ZONE='UTC'), but every
 * date/time <input> in this app works in naive "local wall-clock" strings
 * with no timezone marker (e.g. "2026-08-05T14:30"). Sending that string to
 * the API as-is gets misread as 14:30 UTC instead of 14:30 local — wrong by
 * the browser's UTC offset, and visibly so whenever it crosses midnight.
 * These two convert at the boundary so every picker always shows/sends the
 * user's actual local time regardless of server timezone. */
export function isoToLocalInput(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** "Make recurring" dialog — generates up to 12 weeks of sessions for a
 * group in one call. Shared between SessionsPage and CalendarPage so both
 * surfaces stay wired to the same /sessions/generate-recurring mutation. */
export function RecurringDialog({ groups }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ group_id: "", start_at: nowLocalIso(), end_at: nowLocalIso(), weeks: 8 });

  const mut = useMutation({
    mutationFn: () => api.post("/sessions/generate-recurring", {
      ...form,
      start_at: localInputToIso(form.start_at),
      end_at: localInputToIso(form.end_at),
    }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(t("toast.sessions_created", { count: data.items?.length || 0 }));
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Repeat className="w-4 h-4 me-2" /> {t("recurring.make_recurring")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("recurring.title")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("recurring.desc")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-4">
            <Field label={t("field.group")} required>
              <Select value={form.group_id} onValueChange={(v) => setForm({ ...form, group_id: v })}>
                <SelectTrigger className="bg-background"><SelectValue placeholder={t("sessions.select_group")} /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {(groups?.items || []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("field.first_session_start")} required>
              <Input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} required />
            </Field>
            <Field label={t("field.first_session_end")} required>
              <Input type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} required />
            </Field>
            <Field label={t("field.weeks_1_12")} required>
              <Input type="number" min={1} max={12} value={form.weeks} onChange={(e) => setForm({ ...form, weeks: parseInt(e.target.value, 10) || 1 })} required />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={!form.group_id || mut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("recurring.generate")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Dumb chat-thread UI: message bubbles + composer. Owns no data-fetching —
 * the page wrapper passes in `messages` and an `onSend(body)` callback, so
 * the same component drives both the staff inbox and the parent portal. */
export function ChatThread({ messages, onSend, currentRole, sending, readOnly = false }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText("");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {(messages || []).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{t("chat.no_messages")}</p>
        )}
        {(messages || []).map((m) => {
          const mine = m.sender_role === currentRole;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {!mine && <div className="text-[11px] font-semibold opacity-70 mb-0.5">{m.sender_name}</div>}
                <div className="whitespace-pre-wrap break-words">{m.body}</div>
                <div className={`text-[10px] mt-1 ${mine ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                  {new Date(m.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {!readOnly && (
        <form onSubmit={submit} className="flex items-end gap-2 p-3 border-t border-border">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder={t("chat.placeholder")}
            rows={1}
            className="resize-none min-h-[40px] max-h-32"
          />
          <Button
            type="submit" size="icon"
            disabled={!text.trim() || sending}
            className="bg-accent hover:bg-accent/90 text-accent-foreground flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

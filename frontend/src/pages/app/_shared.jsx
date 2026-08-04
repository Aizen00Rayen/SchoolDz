import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isToday, format, addMonths, subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Copy, Download, Repeat, Send } from "lucide-react";
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
export function CalendarGrid({ month, sessions, onDayClick }) {
  const { t } = useI18n();
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
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
          const inMonth = isSameMonth(day, month);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick?.(day, daySessions)}
              className={`min-h-[92px] p-1.5 border-b border-e border-border text-start align-top hover:bg-muted/40 transition-colors ${inMonth ? "" : "bg-muted/20 text-muted-foreground"}`}
            >
              <div
                className={`text-xs font-mono mb-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                  isToday(day) ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {daySessions.slice(0, 3).map((s) => (
                  <div key={s.id} className="text-[10px] truncate rounded px-1 py-0.5 bg-accent/10 text-accent">
                    {format(new Date(s.start_at), "HH:mm")} {s.topic || ""}
                  </div>
                ))}
                {daySessions.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">{t("calendar.more", { count: daySessions.length - 3 })}</div>
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
export function CalendarMonthNav({ month, onChange }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="font-display text-lg font-semibold">{format(month, "MMMM yyyy")}</div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onChange(subMonths(month, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => onChange(new Date())}>
          {t("calendar.today")}
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onChange(addMonths(month, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

const nowLocalIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** "Make recurring" dialog — generates up to 12 weeks of sessions for a
 * group in one call. Shared between SessionsPage and CalendarPage so both
 * surfaces stay wired to the same /sessions/generate-recurring mutation. */
export function RecurringDialog({ groups }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ group_id: "", start_at: nowLocalIso(), end_at: nowLocalIso(), weeks: 8 });

  const mut = useMutation({
    mutationFn: () => api.post("/sessions/generate-recurring", form).then((r) => r.data),
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

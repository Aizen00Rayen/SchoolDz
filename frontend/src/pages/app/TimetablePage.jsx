import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PageHeader, Field } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
const DURATIONS = [60, 90, 120, 180];
const SLOT_MINUTES = 30;
const DEFAULT_COLOR = "#E53935";

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Weekly timetable (استعمال الزمن) — a fixed grid that repeats all year
 * until the tenant changes it, unlike Sessions/Calendar which are dated
 * one-off occurrences. Rendered as a real <table> with rowSpan for each
 * entry's duration, since that's the simplest correct way to lay out
 * variable-length blocks in a time grid (and it just works in RTL too). */
export default function TimetablePage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("timetable");
  const qc = useQueryClient();
  const [dialogState, setDialogState] = useState(null);

  const { data } = useQuery({
    queryKey: ["timetable"],
    queryFn: async () => (await api.get("/timetable")).data,
  });

  const items = useMemo(() => data?.items || [], [data]);
  const gridStartMin = toMinutes(data?.grid_start || "08:00");
  const gridEndMin = toMinutes(data?.grid_end || "22:00");

  const slots = useMemo(() => {
    const out = [];
    for (let m = gridStartMin; m < gridEndMin; m += SLOT_MINUTES) out.push(m);
    return out;
  }, [gridStartMin, gridEndMin]);

  const byDayStart = useMemo(() => {
    const map = {};
    for (const it of items) map[`${it.day_of_week}:${toMinutes(it.start_time.slice(0, 5))}`] = it;
    return map;
  }, [items]);

  const covered = useMemo(() => {
    const set = new Set();
    for (const it of items) {
      const start = toMinutes(it.start_time.slice(0, 5));
      for (let m = start; m < start + it.duration_minutes; m += SLOT_MINUTES) {
        set.add(`${it.day_of_week}:${m}`);
      }
    }
    return set;
  }, [items]);

  const saveMut = useMutation({
    mutationFn: (payload) => {
      if (payload.id) return api.patch(`/timetable/${payload.id}`, payload).then((r) => r.data);
      return api.post("/timetable", payload).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["timetable"] });
      setDialogState(null);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/timetable/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      qc.invalidateQueries({ queryKey: ["timetable"] });
      setDialogState(null);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openCreate = (day, start) => {
    if (!canEdit) return;
    setDialogState({ mode: "create", day, start, title: "", duration_minutes: 60, color: DEFAULT_COLOR });
  };
  const openEdit = (entry) => {
    setDialogState({
      mode: "edit", id: entry.id, day: entry.day_of_week, start: toMinutes(entry.start_time.slice(0, 5)),
      title: entry.title, duration_minutes: entry.duration_minutes, color: entry.color,
    });
  };

  const overlaps = (day, start, duration, excludeId) => {
    for (const it of items) {
      if (it.id === excludeId || it.day_of_week !== day) continue;
      const itStart = toMinutes(it.start_time.slice(0, 5));
      const itEnd = itStart + it.duration_minutes;
      if (start < itEnd && start + duration > itStart) return true;
    }
    return false;
  };

  const onSubmitDialog = () => {
    if (!dialogState.title.trim()) { toast.error(t("timetable.title_required")); return; }
    if (dialogState.start + dialogState.duration_minutes > gridEndMin) { toast.error(t("timetable.exceeds_grid")); return; }
    if (overlaps(dialogState.day, dialogState.start, dialogState.duration_minutes, dialogState.id)) {
      toast.error(t("timetable.overlap"));
      return;
    }
    saveMut.mutate({
      id: dialogState.id,
      day_of_week: dialogState.day,
      start_time: toHHMM(dialogState.start),
      duration_minutes: dialogState.duration_minutes,
      title: dialogState.title,
      color: dialogState.color,
    });
  };

  return (
    <div>
      <PageHeader title={t("menu.timetable")} subtitle={t("subtitle.timetable")} />
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse" data-testid="timetable-grid">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="w-16 px-2 py-2 text-start font-medium text-muted-foreground" />
                {DAYS.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`weekday.${d}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((slotStart) => (
                <tr key={slotStart} className="border-b border-border/50 h-9">
                  <td className="px-2 text-[10px] font-mono text-muted-foreground align-top whitespace-nowrap">
                    {slotStart % 60 === 0 ? toHHMM(slotStart) : ""}
                  </td>
                  {DAYS.map((day) => {
                    const key = `${day}:${slotStart}`;
                    const entry = byDayStart[key];
                    if (entry) {
                      return (
                        <td
                          key={day} rowSpan={entry.duration_minutes / SLOT_MINUTES}
                          onClick={() => openEdit(entry)}
                          className="align-top p-1 cursor-pointer border-s border-border/50"
                          data-testid={`timetable-entry-${entry.id}`}
                        >
                          <div
                            className="rounded-md h-full px-2 py-1 text-white text-[11px] font-medium leading-snug overflow-hidden"
                            style={{ backgroundColor: entry.color }}
                            title={entry.title}
                          >
                            {entry.title}
                          </div>
                        </td>
                      );
                    }
                    if (covered.has(key)) return null;
                    return (
                      <td
                        key={day}
                        onClick={() => openCreate(day, slotStart)}
                        className={`border-s border-border/50 ${canEdit ? "cursor-pointer hover:bg-muted/60" : ""}`}
                        data-testid={`timetable-cell-${day}-${slotStart}`}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!dialogState} onOpenChange={(o) => !o && setDialogState(null)}>
        <DialogContent className="max-w-md bg-card">
          {dialogState && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">
                  {dialogState.mode === "edit" ? t("timetable.edit_entry") : t("timetable.new_entry")}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {t(`weekday.${dialogState.day}`)} · {toHHMM(dialogState.start)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Field label={t("field.title")} required>
                  <Input
                    value={dialogState.title}
                    onChange={(e) => setDialogState({ ...dialogState, title: e.target.value })}
                    disabled={!canEdit}
                    autoFocus
                    data-testid="timetable-title-input"
                  />
                </Field>
                <Field label={t("timetable.duration")}>
                  <Select
                    value={String(dialogState.duration_minutes)}
                    onValueChange={(v) => setDialogState({ ...dialogState, duration_minutes: Number(v) })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover">
                      {DURATIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>{t(`timetable.duration_${d}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("field.color")}>
                  <Input
                    type="color" value={dialogState.color}
                    onChange={(e) => setDialogState({ ...dialogState, color: e.target.value })}
                    disabled={!canEdit}
                    className="h-10"
                  />
                </Field>
                <div className="flex justify-between items-center pt-2">
                  {dialogState.mode === "edit" && canEdit ? (
                    <Button
                      type="button" variant="ghost" className="text-destructive hover:bg-destructive/10"
                      onClick={() => deleteMut.mutate(dialogState.id)} disabled={deleteMut.isPending}
                      data-testid="timetable-delete"
                    >
                      <Trash2 className="w-4 h-4 me-2" /> {t("actions.delete")}
                    </Button>
                  ) : <span />}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setDialogState(null)}>
                      {t("actions.cancel")}
                    </Button>
                    {canEdit && (
                      <Button
                        type="button" onClick={onSubmitDialog} disabled={saveMut.isPending}
                        className="bg-accent hover:bg-accent/90 text-accent-foreground"
                        data-testid="timetable-save"
                      >
                        {t("actions.save")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

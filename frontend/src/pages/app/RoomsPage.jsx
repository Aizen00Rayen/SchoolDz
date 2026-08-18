import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DoorOpen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Field, PageHeader } from "./_shared";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = { name: "", capacity: "", notes: "", status: "active" };

/** Read-only availability check for a chosen window — separate from the
 * CrudPanel list below (which shows every room regardless of time) since
 * the two questions "what rooms exist" and "what's free right now" have
 * different natural UIs. */
function AvailabilityChecker() {
  const { t } = useI18n();
  const now = new Date();
  const [from, setFrom] = useState(now.toISOString().slice(0, 16));
  const [to, setTo] = useState(new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 16));

  const { data, isFetching } = useQuery({
    queryKey: ["rooms-occupancy", from, to],
    queryFn: async () => (await api.get("/rooms", {
      params: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    })).data,
  });

  const rooms = data?.items || [];

  return (
    <div className="surface-card p-5 mb-6">
      <h3 className="font-display font-semibold text-lg mb-1">{t("rooms.check_availability")}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Field label={t("reports.from")}>
          <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("reports.to")}>
          <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {isFetching ? (
        <div className="text-sm text-muted-foreground">{t("actions.loading")}</div>
      ) : rooms.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("crud.no_items_yet", { module: t("menu.rooms") })}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg border p-3 ${r.occupied ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{r.name}</span>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${r.occupied ? "text-destructive" : "text-success"}`}>
                  {r.occupied ? t("rooms.occupied") : t("rooms.free")}
                </span>
              </div>
              {r.capacity != null && (
                <div className="text-xs text-muted-foreground">{t("field.capacity")}: {r.capacity}</div>
              )}
              {r.occupying_sessions?.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1.5 pt-1.5 border-t border-border">
                  {t("rooms.occupied_by")}: {r.occupying_sessions.map((s) => s.group_name || s.course_title).filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RoomsPage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("rooms");

  return (
    <div>
      <PageHeader title={t("menu.rooms")} subtitle={t("subtitle.rooms")} />

      <AvailabilityChecker />

      <CrudPanel
        moduleKey="rooms"
        endpoint="/rooms"
        title={t("menu.rooms")}
        subtitle=""
        emptyIcon={DoorOpen}
        defaultForm={DEFAULT_FORM}
        canEdit={canEdit}
        canCreate={canEdit}
        columns={[
          { key: "name", label: t("field.room_name"), render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "capacity", label: t("field.capacity"), render: (r) => r.capacity ?? <span className="text-muted-foreground">—</span> },
          { key: "notes", label: t("field.notes"), render: (r) => r.notes || <span className="text-muted-foreground">—</span> },
          { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
        ]}
        renderForm={(form, setForm) => (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("field.room_name")} required>
              <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t("field.capacity")}>
              <Input
                type="number" min="0"
                value={form.capacity ?? ""}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </Field>
            <Field label={t("field.status")}>
              <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="active">{t("status.active")}</SelectItem>
                  <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label={t("field.notes")}>
                <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </Field>
            </div>
          </div>
        )}
      />
    </div>
  );
}

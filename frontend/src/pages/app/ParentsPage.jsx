import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel from "./CrudPanel";
import { Check, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Field, InviteButton, ExportMenu } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

/** Same amber/dimmed-red treatment as StudentsPage's approvalRowClass — a
 * parent who self-registered via public enrollment gets the same pending
 * review state, since approving/rejecting either the parent or their child
 * cascades to the other (see GuardianViewSet.approve/reject). */
function approvalRowClass(row) {
  if (row.approval_status === "pending") return "bg-warning/10 hover:!bg-warning/15";
  if (row.approval_status === "rejected") return "bg-destructive/5 text-muted-foreground hover:!bg-destructive/10";
  return "";
}

const DEFAULT_FORM = {
  name: "", name_latin: "", email: "", phone: "", address: "", occupation: "", relationship: "father",
  emergency_contact: "", id_card_number: "", student_ids: [],
};

/** Shows the student's Latin-script name alongside the Arabic one when set,
 * so a school that enters names in Arabic can still recognize the right
 * student in a search result or selection chip. */
function studentLabel(s) {
  const latin = [s.first_name_latin, s.last_name_latin].filter(Boolean).join(" ");
  const base = `${s.first_name} ${s.last_name}`;
  return latin ? `${base} (${latin})` : base;
}

/** Search-by-name-or-code picker — a tenant with thousands of students can't
 * reasonably render them all as a checkbox list (that's what this replaced).
 * `max` (optional) caps how many students can be selected — used by
 * GroupsPage to keep enrollment from exceeding the group's capacity field.
 * Selecting fewer is always fine; once at max, matches just can't be added
 * until something is removed. Omit `max` for unlimited pickers (e.g. linking
 * a guardian's own children, which has no such ceiling). */
export function StudentPicker({ selected, onChange, max }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [labels, setLabels] = useState({});
  const ids = selected || [];
  const hasMax = typeof max === "number" && !Number.isNaN(max);
  const atMax = hasMax && ids.length >= max;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results, isFetching } = useQuery({
    queryKey: ["students-search", debounced],
    queryFn: async () => (await api.get("/students", { params: { q: debounced, limit: 10 } })).data,
    enabled: debounced.length > 0,
  });

  // Chips need a label for every selected id, including ones picked in an
  // earlier session (editing an existing group/guardian) that never came
  // through a search result in this render.
  const missingIds = ids.filter((id) => !labels[id]);
  useQuery({
    queryKey: ["students-labels", missingIds.join(",")],
    queryFn: async () => {
      const { data } = await api.get("/students", { params: { ids: missingIds.join(",") } });
      setLabels((prev) => {
        const next = { ...prev };
        for (const s of data.items) next[s.id] = studentLabel(s);
        return next;
      });
      return data;
    },
    enabled: missingIds.length > 0,
  });

  useEffect(() => {
    if (results?.items?.length) {
      setLabels((prev) => {
        const next = { ...prev };
        for (const s of results.items) next[s.id] = studentLabel(s);
        return next;
      });
    }
  }, [results]);

  const toggle = (studentId, label) => {
    if (ids.includes(studentId)) {
      onChange(ids.filter((id) => id !== studentId));
      return;
    }
    if (atMax) return;
    if (label) setLabels((prev) => ({ ...prev, [studentId]: label }));
    onChange([...ids, studentId]);
  };

  return (
    <div>
      {hasMax && (
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">{t("picker.selected_count", { count: ids.length, max })}</span>
          {atMax && <span className="text-warning font-medium">{t("picker.max_reached")}</span>}
        </div>
      )}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("picker.search_students")}
        data-testid="student-picker-search"
      />

      {debounced && (
        <div className="border border-border rounded-lg mt-1.5 max-h-48 overflow-y-auto bg-background">
          {isFetching ? (
            <div className="text-xs text-muted-foreground p-2">{t("actions.loading")}</div>
          ) : (results?.items || []).length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">{t("picker.no_students")}</div>
          ) : (
            results.items.map((s) => {
              const checked = ids.includes(s.id);
              const disabled = !checked && atMax;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(s.id, studentLabel(s))}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm text-start ${
                    checked ? "bg-accent/10" : ""
                  } ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/60 cursor-pointer"}`}
                  data-testid={`student-picker-result-${s.id}`}
                >
                  <span className={checked ? "font-medium" : ""}>{studentLabel(s)}</span>
                  <span className="text-[11px] font-mono text-muted-foreground ms-auto">{s.student_code}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
              data-testid={`student-picker-chip-${id}`}
            >
              {labels[id] || "…"}
              <button type="button" onClick={() => toggle(id)} className="text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ParentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const canInvite = tenant?.plan && tenant.plan !== "basic";
  const { canEdit } = usePermission("parents");
  const qc = useQueryClient();

  const approveMut = useMutation({
    mutationFn: (id) => api.post(`/parents/${id}/approve`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("parents.approved_toast"));
      qc.invalidateQueries({ queryKey: ["parents"] });
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });
  const rejectMut = useMutation({
    mutationFn: (id) => api.post(`/parents/${id}/reject`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("parents.rejected_toast"));
      qc.invalidateQueries({ queryKey: ["parents"] });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <CrudPanel
      moduleKey="parents"
      endpoint="/parents"
      canEdit={canEdit}
      canCreate={canEdit}
      title={t("menu.parents")}
      subtitle={t("subtitle.parents")}
      emptyIcon={UserRound}
      defaultForm={DEFAULT_FORM}
      rowClassName={approvalRowClass}
      renderRowActions={(row) => row.approval_status === "pending" && canEdit ? (
        <>
          <Button
            size="icon" variant="ghost"
            onClick={() => approveMut.mutate(row.id)}
            className="h-8 w-8 text-success hover:bg-success/10"
            title={t("parents.approve")}
            data-testid={`parents-approve-${row.id}`}
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon" variant="ghost"
            onClick={() => rejectMut.mutate(row.id)}
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            title={t("parents.reject")}
            data-testid={`parents-reject-${row.id}`}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </>
      ) : null}
      extraActions={<ExportMenu resource="parents" />}
      columns={[
        {
          key: "name", label: t("field.full_name"),
          render: (r) => (
            <div className="flex items-center gap-1.5">
              <span className="font-medium">{r.name}</span>
              {r.approval_status === "pending" && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-warning">{t("parents.approval_pending")}</span>
              )}
              {r.approval_status === "rejected" && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-destructive">{t("parents.approval_rejected")}</span>
              )}
            </div>
          ),
        },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "relationship", label: t("field.relationship"), render: (r) => <span className="capitalize text-xs">{r.relationship ? t(`relationship.${r.relationship}`) : "—"}</span> },
        {
          key: "portal", label: t("field.portal"),
          render: (r) => <InviteButton person={r} endpoint="/parents" invalidateKey="parents" canInvite={canInvite} />,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.full_name")} required>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label={t("field.name_latin")}>
            <Input value={form.name_latin || ""} onChange={(e) => setForm({ ...form, name_latin: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t("field.relationship")}>
            <Select value={form.relationship || "father"} onValueChange={(v) => setForm({ ...form, relationship: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="father">{t("relationship.father")}</SelectItem>
                <SelectItem value="mother">{t("relationship.mother")}</SelectItem>
                <SelectItem value="guardian">{t("relationship.guardian")}</SelectItem>
                <SelectItem value="other">{t("relationship.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label={t("field.email")}>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("field.occupation")}>
            <Input value={form.occupation || ""} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
          </Field>
          <Field label={t("field.emergency_contact")}>
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <Field label={t("field.id_card_number")}>
            <Input value={form.id_card_number || ""} onChange={(e) => setForm({ ...form, id_card_number: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.address")}>
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs font-medium mb-1.5 block">{t("field.students")}</Label>
            <StudentPicker
              selected={form.student_ids}
              onChange={(ids) => setForm({ ...form, student_ids: ids })}
            />
          </div>
        </div>
      )}
    />
  );
}

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Check, GraduationCap, Upload, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field, ExportMenu, SchoolLevelFields, SchoolLevelCell } from "./_shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];

const DEFAULT_FORM = {
  first_name: "",
  last_name: "",
  first_name_latin: "",
  last_name_latin: "",
  gender: "male",
  school_level: "",
  school_year: "",
  specialty: "",
  insurance_status: "",
  health_condition: "",
  blood_type: "",
  birth_date: "",
  email: "",
  phone: "",
  address: "",
  emergency_contact: "",
  medical_notes: "",
  status: "active",
  notes: "",
};

const MAX_CSV_BYTES = 2 * 1024 * 1024;

function ImportCsvDialog() {
  const qc = useQueryClient();
  const fileInputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);

  const importMut = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post("/students/import", body).then((r) => r.data);
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const { t } = useI18n();

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.error(t("import.csv_too_large"));
      return;
    }
    setResult(null);
    importMut.mutate(file);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4 me-2" /> {t("import.csv")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("import.students_title")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("import.columns_hint")}
            </DialogDescription>
          </DialogHeader>

          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileSelect} />
          <Button type="button" variant="outline" disabled={importMut.isPending} onClick={() => fileInputRef.current?.click()}>
            {importMut.isPending ? t("import.importing") : t("import.choose_file")}
          </Button>

          {result && (
            <div className="text-sm space-y-2">
              <div className="text-success font-medium">{t("import.result", { created: result.created, total: result.total })}</div>
              {result.failed?.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <tbody>
                      {result.failed.map((f) => (
                        <tr key={f.row} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{t("import.row", { row: f.row })}</td>
                          <td className="px-3 py-1.5 text-destructive">{f.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Amber for a self-enrolled record awaiting a secretary's review, dimmed
 * red once rejected — so the ones needing attention stand out in the list
 * without having to open each row. */
function approvalRowClass(row) {
  if (row.approval_status === "pending") return "bg-warning/10 hover:!bg-warning/15";
  if (row.approval_status === "rejected") return "bg-destructive/5 text-muted-foreground hover:!bg-destructive/10";
  return "";
}

export default function StudentsPage() {
  const { t } = useI18n();
  const { canAdd, canModify, canDelete } = usePermission("students");
  const qc = useQueryClient();

  const approveMut = useMutation({
    mutationFn: (id) => api.post(`/students/${id}/approve`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("students.approved_toast"));
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });
  const rejectMut = useMutation({
    mutationFn: (id) => api.post(`/students/${id}/reject`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("students.rejected_toast"));
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <CrudPanel
      moduleKey="students"
      endpoint="/students"
      title={t("menu.students")}
      subtitle={t("subtitle.students")}
      emptyIcon={GraduationCap}
      defaultForm={DEFAULT_FORM}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      rowClassName={approvalRowClass}
      renderRowActions={(row) => row.approval_status === "pending" && canModify ? (
        <>
          <Button
            size="icon" variant="ghost"
            onClick={() => approveMut.mutate(row.id)}
            className="h-8 w-8 text-success hover:bg-success/10"
            title={t("students.approve")}
            data-testid={`students-approve-${row.id}`}
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon" variant="ghost"
            onClick={() => rejectMut.mutate(row.id)}
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            title={t("students.reject")}
            data-testid={`students-reject-${row.id}`}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </>
      ) : null}
      extraActions={(
        <>
          {canAdd && <ImportCsvDialog />}
          <ExportMenu resource="students" />
        </>
      )}
      columns={[
        {
          key: "name", label: t("field.full_name"),
          render: (r) => (
            <div>
              <div className="font-medium flex items-center gap-1.5">
                {r.first_name} {r.last_name}
                {r.approval_status === "pending" && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-warning">{t("students.approval_pending")}</span>
                )}
                {r.approval_status === "rejected" && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-destructive">{t("students.approval_rejected")}</span>
                )}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground">{r.student_code}</div>
            </div>
          ),
        },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "gender", label: t("field.gender"), render: (r) => <span className="capitalize text-xs">{r.gender ? t(`gender.${r.gender}`) : "—"}</span> },
        { key: "school_level", label: t("field.school_level"), render: (r) => <SchoolLevelCell row={r} /> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.first_name")} required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required data-testid="student-form-firstname" />
          </Field>
          <Field label={t("field.last_name")} required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required data-testid="student-form-lastname" />
          </Field>
          <Field label={t("field.first_name_latin")}>
            <Input value={form.first_name_latin || ""} onChange={(e) => setForm({ ...form, first_name_latin: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t("field.last_name_latin")}>
            <Input value={form.last_name_latin || ""} onChange={(e) => setForm({ ...form, last_name_latin: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t("field.gender")}>
            <Select value={form.gender || "male"} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="male">{t("gender.male")}</SelectItem>
                <SelectItem value="female">{t("gender.female")}</SelectItem>
                <SelectItem value="other">{t("gender.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <SchoolLevelFields form={form} setForm={setForm} />
          <Field label={t("field.insurance_status")}>
            <Select
              value={form.insurance_status || "__none"}
              onValueChange={(v) => setForm({ ...form, insurance_status: v === "__none" ? "" : v })}
            >
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="__none">—</SelectItem>
                <SelectItem value="insured">{t("insurance.insured")}</SelectItem>
                <SelectItem value="uninsured">{t("insurance.uninsured")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.blood_type")}>
            <Select
              value={form.blood_type || "__none"}
              onValueChange={(v) => setForm({ ...form, blood_type: v === "__none" ? "" : v })}
            >
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="__none">—</SelectItem>
                {BLOOD_TYPES.map((bt) => (
                  <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.health_condition")}>
              <Textarea value={form.health_condition || ""} onChange={(e) => setForm({ ...form, health_condition: e.target.value })} rows={2} />
            </Field>
          </div>
          <Field label={t("field.birth_date")}>
            <Input type="date" value={(form.birth_date || "").slice(0, 10)} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          </Field>
          <Field label={t("field.email")}>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="student-form-email" />
          </Field>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label={t("field.emergency_contact")}>
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <Field label={t("field.status")}>
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
                <SelectItem value="graduated">{t("status.graduated")}</SelectItem>
                <SelectItem value="suspended">{t("status.suspended")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.address")}>
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label={t("field.notes")}>
              <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

export { Field };

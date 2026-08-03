import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { GraduationCap, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "./_shared";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  first_name: "",
  last_name: "",
  gender: "male",
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

export default function StudentsPage() {
  const { t } = useI18n();
  return (
    <CrudPanel
      moduleKey="students"
      endpoint="/students"
      title={t("menu.students")}
      subtitle={t("subtitle.students")}
      emptyIcon={GraduationCap}
      defaultForm={DEFAULT_FORM}
      extraActions={<ImportCsvDialog />}
      columns={[
        {
          key: "name", label: t("field.full_name"),
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{r.student_code}</div>
            </div>
          ),
        },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "gender", label: t("field.gender"), render: (r) => <span className="capitalize text-xs">{r.gender ? t(`gender.${r.gender}`) : "—"}</span> },
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

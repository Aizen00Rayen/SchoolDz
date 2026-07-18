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

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.error("CSV must be under 2MB");
      return;
    }
    setResult(null);
    importMut.mutate(file);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4 me-2" /> Import CSV
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Import students from CSV</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Columns: first_name, last_name (required), email, phone, gender, birth_date,
              address, emergency_contact, parent_name, parent_email, parent_phone (optional).
            </DialogDescription>
          </DialogHeader>

          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFileSelect} />
          <Button type="button" variant="outline" disabled={importMut.isPending} onClick={() => fileInputRef.current?.click()}>
            {importMut.isPending ? "Importing…" : "Choose CSV file"}
          </Button>

          {result && (
            <div className="text-sm space-y-2">
              <div className="text-success font-medium">{result.created} of {result.total} students created</div>
              {result.failed?.length > 0 && (
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                  <table className="w-full text-xs">
                    <tbody>
                      {result.failed.map((f) => (
                        <tr key={f.row} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">Row {f.row}</td>
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
      subtitle="Manage learners, profiles, and enrollment status."
      emptyIcon={GraduationCap}
      defaultForm={DEFAULT_FORM}
      extraActions={<ImportCsvDialog />}
      columns={[
        {
          key: "name", label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{r.student_code}</div>
            </div>
          ),
        },
        { key: "email", label: "Email", render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "gender", label: "Gender", render: (r) => <span className="capitalize text-xs">{r.gender || "—"}</span> },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First name" required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required data-testid="student-form-firstname" />
          </Field>
          <Field label="Last name" required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required data-testid="student-form-lastname" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender || "male"} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Birth date">
            <Input type="date" value={(form.birth_date || "").slice(0, 10)} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="student-form-email" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Emergency contact">
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="graduated">Graduated</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

export { Field };

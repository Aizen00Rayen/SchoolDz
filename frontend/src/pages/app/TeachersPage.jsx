import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { ExternalLink, FileText, Loader2, Upload, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Field, InviteButton, ExportMenu } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError, resolveFileUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  first_name: "", last_name: "", first_name_latin: "", last_name_latin: "", email: "", phone: "", subjects: [],
  status: "active",
};

/** Multi-select for a teacher's subjects, sourced from the center's courses.
 * Any legacy free-form subjects not matching a course are still shown (and
 * kept checked) so editing an existing teacher never silently drops them. */
function SubjectPicker({ selected, onChange }) {
  const { t } = useI18n();
  const { data: courses, isLoading } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const selectedSubjects = selected || [];

  // Union of course titles + any already-selected subjects that aren't courses.
  const courseTitles = (courses?.items || []).map((c) => c.title).filter(Boolean);
  const options = Array.from(new Set([...courseTitles, ...selectedSubjects]));

  const toggle = (subject, checked) => {
    onChange(checked
      ? [...selectedSubjects, subject]
      : selectedSubjects.filter((s) => s !== subject));
  };

  return (
    <div className="border border-border rounded-lg max-h-48 overflow-y-auto p-2 space-y-1 bg-background">
      {isLoading ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.loading_subjects")}</div>
      ) : options.length === 0 ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.no_courses")}</div>
      ) : (
        options.map((subject) => (
          <label key={subject} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-sm">
            <Checkbox
              checked={selectedSubjects.includes(subject)}
              onCheckedChange={(checked) => toggle(subject, !!checked)}
            />
            <span>{subject}</span>
          </label>
        ))
      )}
    </div>
  );
}

/** Upload/replace + view/download for an optional HR document (CV or
 * diploma) — only usable once the teacher exists (needs an id to upload
 * against), so the create dialog shows a hint instead until saved once. */
function DocumentField({ label, url, uploadPath, teacherId, onUploaded }) {
  const { t } = useI18n();
  const inputRef = useRef(null);

  const uploadMut = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/teachers/${teacherId}${uploadPath}`, body).then((r) => r.data);
    },
    onSuccess: (data) => {
      toast.success(t("toast.updated"));
      onUploaded(data);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadMut.mutate(file);
  };

  if (!teacherId) {
    return <p className="text-xs text-muted-foreground">{t("teacher.save_before_documents")}</p>;
  }

  return (
    <div className="flex items-center gap-2">
      {url && (
        <a
          href={resolveFileUrl(url)} target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-accent hover:underline truncate"
        >
          <FileText className="w-3.5 h-3.5 flex-shrink-0" /> {t("teacher.view_document")} <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      )}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={onFileSelect} />
      <Button type="button" variant="outline" size="sm" disabled={uploadMut.isPending} onClick={() => inputRef.current?.click()}>
        {uploadMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 me-1.5" />}
        {url ? t("actions.replace") : t("teacher.upload_document")}
      </Button>
    </div>
  );
}

export default function TeachersPage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("teachers");
  const qc = useQueryClient();
  return (
    <CrudPanel
      moduleKey="teachers"
      endpoint="/teachers"
      title={t("menu.teachers")}
      subtitle={t("subtitle.teachers")}
      emptyIcon={Users}
      defaultForm={DEFAULT_FORM}
      canEdit={canEdit}
      canCreate={canEdit}
      extraActions={<ExportMenu resource="teachers" />}
      columns={[
        {
          key: "name", label: t("field.full_name"),
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] text-muted-foreground">{(r.subjects || []).join(", ")}</div>
            </div>
          ),
        },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
        {
          key: "portal", label: t("field.portal"),
          render: (r) => <InviteButton person={r} endpoint="/teachers" invalidateKey="teachers" />,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.first_name")} required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          </Field>
          <Field label={t("field.last_name")} required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          </Field>
          <Field label={t("field.first_name_latin")}>
            <Input value={form.first_name_latin || ""} onChange={(e) => setForm({ ...form, first_name_latin: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t("field.last_name_latin")}>
            <Input value={form.last_name_latin || ""} onChange={(e) => setForm({ ...form, last_name_latin: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t("field.email")}>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.subjects")}>
              <SubjectPicker
                selected={form.subjects}
                onChange={(subjects) => setForm({ ...form, subjects })}
              />
            </Field>
          </div>
          <Field label={t("field.status")}>
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("teacher.cv")}>
            <DocumentField
              label={t("teacher.cv")} url={form.cv_url} uploadPath="/cv" teacherId={form.id}
              onUploaded={(data) => { setForm({ ...form, cv_url: data.cv_url }); qc.invalidateQueries({ queryKey: ["teachers"] }); }}
            />
          </Field>
          <Field label={t("teacher.diploma")}>
            <DocumentField
              label={t("teacher.diploma")} url={form.diploma_url} uploadPath="/diploma" teacherId={form.id}
              onUploaded={(data) => { setForm({ ...form, diploma_url: data.diploma_url }); qc.invalidateQueries({ queryKey: ["teachers"] }); }}
            />
          </Field>
        </div>
      )}
    />
  );
}

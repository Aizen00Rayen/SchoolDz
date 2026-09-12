import CrudPanel, { StatusPill } from "./CrudPanel";
import { BookOpen, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "./StudentsPage";
import { SchoolLevelFields, SchoolLevelCell } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  title: "", description: "", category: "", pricing_type: "fixed_sessions", sessions_count: 12, price: 0,
  max_students: 20, color: "#0A0A0B", status: "active", show_on_enrollment: false,
  school_level: "", school_year: "", specialty: "", kind: "regular",
};

function pricingLabel(r, t) {
  if (r.pricing_type === "per_session") return t("course.pricing_per_session");
  if (r.pricing_type === "per_month") return t("course.pricing_per_month_count", { count: r.sessions_count || 0 });
  return t("course.pricing_fixed_sessions_count", { count: r.sessions_count || 0 });
}

export default function CoursesPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canAdd, canModify, canDelete } = usePermission("courses");
  return (
    <CrudPanel
      moduleKey="courses"
      endpoint="/courses"
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      title={t("menu.courses")}
      subtitle={t("subtitle.courses")}
      emptyIcon={BookOpen}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "title", label: t("field.course_title"),
          render: (r) => (
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color || "#0A0A0B" }} />
              <div>
                <div className="font-medium flex items-center gap-1.5">
                  {r.title}
                  {(r.kind === "package" || r.kind === "standalone") && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{t("course.kind_package_badge")}</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">{r.category || "—"}</div>
              </div>
            </div>
          ),
        },
        { key: "pricing_type", label: t("field.pricing"), render: (r) => <span className="text-xs">{pricingLabel(r, t)}</span> },
        {
          key: "price", label: t("field.price"),
          render: (r) => (
            <span className="font-mono">
              {r.price?.toLocaleString?.() || 0} {tenant?.currency || "DZD"}
            </span>
          ),
        },
        { key: "max_students", label: t("field.capacity") },
        { key: "school_level", label: t("field.school_level"), render: (r) => <SchoolLevelCell row={r} /> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
        {
          key: "show_on_enrollment", label: t("field.public"),
          render: (r) => r.show_on_enrollment ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success"><Globe className="w-3 h-3" /> {t("course.public_listed")}</span>
          ) : <span className="text-[11px] text-muted-foreground">—</span>,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label={t("field.course_title")} required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
          </div>
          <Field label={t("field.category")}>
            <Input value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("course.category_placeholder")} />
          </Field>
          <Field label={t("field.status")}>
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="draft">{t("status.draft")}</SelectItem>
                <SelectItem value="archived">{t("status.archived")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <SchoolLevelFields form={form} setForm={setForm} />
          <Field label={t("field.course_kind")}>
            <Select
              value={form.kind === "standalone" ? "package" : (form.kind || "regular")}
              onValueChange={(v) => setForm({ ...form, kind: v })}
            >
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="regular">{t("course.kind_regular")}</SelectItem>
                <SelectItem value="package">{t("course.kind_package")}</SelectItem>
              </SelectContent>
            </Select>
            {(form.kind === "package" || form.kind === "standalone") && (
              <p className="text-[11px] text-muted-foreground mt-1.5">{t("course.kind_package_hint")}</p>
            )}
          </Field>
          <Field label={t("field.pricing_type")}>
            <Select
              value={form.pricing_type || "fixed_sessions"}
              onValueChange={(v) => setForm({ ...form, pricing_type: v, sessions_count: v === "per_session" ? null : (form.sessions_count || 12) })}
            >
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="per_session">{t("course.pricing_per_session")}</SelectItem>
                <SelectItem value="per_month">{t("course.pricing_per_month")}</SelectItem>
                <SelectItem value="fixed_sessions">{t("course.pricing_fixed_sessions")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.price")}>
            <Input type="number" value={form.price || 0} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
          </Field>
          {form.pricing_type !== "per_session" && (
            <Field label={form.pricing_type === "per_month" ? t("course.sessions_per_month") : t("course.total_sessions")}>
              <Input
                type="number" value={form.sessions_count || ""}
                onChange={(e) => setForm({ ...form, sessions_count: parseInt(e.target.value) || null })}
              />
            </Field>
          )}
          <Field label={t("field.max_students")}>
            <Input type="number" value={form.max_students || 20} onChange={(e) => setForm({ ...form, max_students: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label={t("field.color")}>
            <Input type="color" value={form.color || "#0A0A0B"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10" />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.description")}>
              <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2.5 rounded-lg border border-border p-3 cursor-pointer">
              <Checkbox
                checked={!!form.show_on_enrollment}
                onCheckedChange={(v) => setForm({ ...form, show_on_enrollment: !!v })}
              />
              <div>
                <div className="text-sm font-medium">{t("course.show_on_enrollment")}</div>
                <div className="text-xs text-muted-foreground">{t("course.show_on_enrollment_desc")}</div>
              </div>
            </label>
          </div>
        </div>
      )}
    />
  );
}

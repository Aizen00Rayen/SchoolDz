import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { FileQuestion, ArrowUpRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = { title: "", description: "", course_id: "", group_id: "" };

export default function QuizzesPage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("quizzes");
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  return (
    <CrudPanel
      moduleKey="quizzes"
      endpoint="/quizzes"
      title={t("menu.quizzes")}
      subtitle={t("subtitle.quizzes")}
      emptyIcon={FileQuestion}
      defaultForm={DEFAULT_FORM}
      canEdit={canEdit}
      canCreate={canEdit}
      columns={[
        { key: "title", label: t("field.title"), render: (r) => <span className="font-medium">{r.title}</span> },
        { key: "group", label: t("field.group"), render: (r) => r.group_name || <span className="text-muted-foreground">—</span> },
        { key: "questions", label: t("quiz.questions"), render: (r) => <span className="font-mono text-xs">{r.question_count}</span> },
        {
          key: "attempts", label: t("quiz.attempts"),
          render: (r) => <span className="font-mono text-xs">{r.attempts_total}</span>,
        },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
        {
          key: "open", label: "",
          render: (r) => (
            <Link to={`/app/quizzes/${r.id}`}>
              <Button size="sm" variant="outline">
                {t("quiz.open_builder")} <ArrowUpRight className="w-3.5 h-3.5 ms-1.5" />
              </Button>
            </Link>
          ),
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label={t("field.title")} required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label={t("field.description")}>
              <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </Field>
          </div>
          <Field label={t("field.course")}>
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.group")}>
            <Select value={form.group_id || ""} onValueChange={(v) => setForm({ ...form, group_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(groups?.items || []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
    />
  );
}

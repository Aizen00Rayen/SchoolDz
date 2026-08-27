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

const DEFAULT_FORM = { title: "", description: "", course_id: "", group_id: "", max_score: 20 };

export default function QuizzesPage() {
  const { t } = useI18n();
  const { canAdd, canModify, canDelete } = usePermission("quizzes");
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
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      columns={[
        { key: "title", label: t("field.quiz_title"), render: (r) => <span className="font-medium">{r.title}</span> },
        { key: "group", label: t("field.group"), render: (r) => r.group_name || <span className="text-muted-foreground">—</span> },
        { key: "exercise", label: t("quiz.exercise"), render: (r) => <span className="text-xs">{r.exercise_file_url ? "✓" : <span className="text-muted-foreground">—</span>}</span> },
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
            <Field label={t("field.quiz_title")} required>
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
          <Field label={t("quiz.max_score")}>
            <Input
              type="number" min="1" step="0.5"
              value={form.max_score ?? 20}
              onChange={(e) => setForm({ ...form, max_score: parseFloat(e.target.value) || 0 })}
            />
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

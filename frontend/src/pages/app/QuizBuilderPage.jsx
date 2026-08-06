import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, Loader2, Plus, Rocket, Save, Trash2,
} from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { PageHeader, StatusPill } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const genKey = () => Math.random().toString(36).slice(2);
const blankChoice = () => ({ key: genKey(), text: "", is_correct: false });
const blankQuestion = () => ({ key: genKey(), text: "", points: 1, choices: [blankChoice(), blankChoice()] });

export default function QuizBuilderPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { canEdit } = usePermission("quizzes");
  const qc = useQueryClient();
  const [questions, setQuestions] = useState([]);
  const [seeded, setSeeded] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  const { data: quiz, isLoading } = useQuery({
    queryKey: ["quiz", id],
    queryFn: async () => (await api.get(`/quizzes/${id}`)).data,
  });

  const { data: results } = useQuery({
    queryKey: ["quiz-results", id],
    queryFn: async () => (await api.get(`/quizzes/${id}/results`)).data,
  });

  useEffect(() => {
    if (quiz && !seeded) {
      setQuestions(
        (quiz.questions || []).length
          ? quiz.questions.map((q) => ({
              key: q.id,
              text: q.text,
              points: q.points,
              choices: (q.choices || []).map((c) => ({ key: c.id, text: c.text, is_correct: c.is_correct })),
            }))
          : [blankQuestion()],
      );
      setSeeded(true);
    }
  }, [quiz, seeded]);

  const saveMut = useMutation({
    mutationFn: () =>
      api.post(`/quizzes/${id}/save_questions`, {
        questions: questions.map((q, qi) => ({
          text: q.text,
          points: q.points || 1,
          order: qi,
          choices: q.choices.map((c, ci) => ({ text: c.text, is_correct: c.is_correct, order: ci })),
        })),
      }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(t("quiz.saved"));
      qc.setQueryData(["quiz", id], data);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const publishMut = useMutation({
    mutationFn: () => api.post(`/quizzes/${id}/publish`).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(t("quiz.published"));
      qc.invalidateQueries({ queryKey: ["quiz", id] });
      qc.invalidateQueries({ queryKey: ["quiz-results", id] });
      setPublishResult(data.take_url);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const updateQuestion = (qKey, patch) =>
    setQuestions((prev) => prev.map((q) => (q.key === qKey ? { ...q, ...patch } : q)));

  const updateChoice = (qKey, cKey, patch) =>
    setQuestions((prev) =>
      prev.map((q) => (q.key !== qKey ? q : { ...q, choices: q.choices.map((c) => (c.key === cKey ? { ...c, ...patch } : c)) })),
    );

  const setCorrectChoice = (qKey, cKey) =>
    setQuestions((prev) =>
      prev.map((q) => (q.key !== qKey ? q : { ...q, choices: q.choices.map((c) => ({ ...c, is_correct: c.key === cKey })) })),
    );

  const addChoice = (qKey) =>
    setQuestions((prev) => prev.map((q) => (q.key === qKey ? { ...q, choices: [...q.choices, blankChoice()] } : q)));

  const removeChoice = (qKey, cKey) =>
    setQuestions((prev) =>
      prev.map((q) => (q.key !== qKey ? q : { ...q, choices: q.choices.filter((c) => c.key !== cKey) })),
    );

  const addQuestion = () => setQuestions((prev) => [...prev, blankQuestion()]);
  const removeQuestion = (qKey) => setQuestions((prev) => prev.filter((q) => q.key !== qKey));

  if (isLoading || !quiz) {
    return <div className="text-sm text-muted-foreground py-12 text-center">{t("actions.loading")}</div>;
  }

  const canPublish = !!quiz.group_id && questions.length > 0 && questions.every((q) => q.text.trim() && q.choices.some((c) => c.is_correct));

  return (
    <div>
      <Link to="/app/quizzes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> {t("menu.quizzes")}
      </Link>

      <PageHeader
        title={quiz.title}
        subtitle={quiz.group_name ? `${t("field.group")}: ${quiz.group_name}` : t("quiz.no_group_warning")}
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Save className="w-4 h-4 me-2" />}
                {t("actions.save")}
              </Button>
              <Button
                onClick={() => publishMut.mutate()}
                disabled={!canPublish || publishMut.isPending}
                title={!canPublish ? t("quiz.publish_disabled_hint") : undefined}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {publishMut.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Rocket className="w-4 h-4 me-2" />}
                {t("quiz.publish")}
              </Button>
            </>
          )
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <StatusPill status={quiz.status} />
        <span className="text-xs text-muted-foreground font-mono">
          {t("quiz.submissions_count", { count: quiz.attempts_total })}
        </span>
      </div>

      <div className="space-y-4 mb-8">
        {questions.map((q, qi) => (
          <div key={q.key} className="surface-card p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-xs font-mono text-muted-foreground pt-2.5">#{qi + 1}</span>
              <Textarea
                value={q.text}
                onChange={(e) => updateQuestion(q.key, { text: e.target.value })}
                placeholder={t("quiz.question_placeholder")}
                rows={2}
                disabled={!canEdit}
                className="flex-1"
              />
              <div className="w-20">
                <Input
                  type="number" min={0} step="0.5"
                  value={q.points}
                  onChange={(e) => updateQuestion(q.key, { points: parseFloat(e.target.value) || 0 })}
                  disabled={!canEdit}
                  title={t("quiz.points")}
                />
              </div>
              {canEdit && (
                <Button size="icon" variant="ghost" onClick={() => removeQuestion(q.key)} className="text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            <RadioGroup
              value={q.choices.find((c) => c.is_correct)?.key || ""}
              onValueChange={(v) => setCorrectChoice(q.key, v)}
              className="space-y-2 ps-8"
            >
              {q.choices.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <RadioGroupItem value={c.key} disabled={!canEdit} />
                  <Input
                    value={c.text}
                    onChange={(e) => updateChoice(q.key, c.key, { text: e.target.value })}
                    placeholder={t("quiz.choice_placeholder")}
                    disabled={!canEdit}
                    className="h-8"
                  />
                  {canEdit && q.choices.length > 2 && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => removeChoice(q.key, c.key)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </RadioGroup>
            {canEdit && (
              <Button size="sm" variant="ghost" className="ms-8 mt-2" onClick={() => addChoice(q.key)}>
                <Plus className="w-3.5 h-3.5 me-1.5" /> {t("quiz.add_choice")}
              </Button>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <Button variant="outline" onClick={addQuestion} className="mb-8">
          <Plus className="w-4 h-4 me-2" /> {t("quiz.add_question")}
        </Button>
      )}

      <div className="surface-card p-5">
        <h3 className="font-display font-semibold text-lg mb-4">{t("quiz.results")}</h3>
        {(results?.items || []).length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">{t("quiz.no_attempts")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("quiz.solver_name")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("quiz.matched_student")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.score")}</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{a.solver_name}</td>
                    <td className="px-3 py-2 text-xs">
                      {a.student_name ? (
                        <span className="text-muted-foreground">{a.student_name}</span>
                      ) : (
                        <span className="text-warning" title={t("quiz.unmatched_hint")}>{t("quiz.unmatched")} ⚠</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {a.score != null ? `${a.score} / ${a.max_score}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!publishResult} onOpenChange={(open) => !open && setPublishResult(null)}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("quiz.link_ready")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{t("quiz.link_hint")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={publishResult || ""} className="font-mono text-xs" />
            <Button
              type="button" size="icon" variant="outline"
              onClick={() => { navigator.clipboard.writeText(publishResult); toast.success(t("toast.copied")); }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** Public, no-login quiz-taking page. The link is shared with the whole
 * class at once (posted to a group chat, etc.) — there's no student
 * pre-assigned to it, so the solver types their own full name before
 * answering, and the backend best-effort matches it against the group's
 * roster to auto-file the grade (see public_quiz_attempt_submit). */
export default function TakeQuizPage() {
  const { token } = useParams();
  const { t } = useI18n();
  const [answers, setAnswers] = useState({});
  const [solverName, setSolverName] = useState("");
  const [confirmedName, setConfirmedName] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-quiz-attempt", token],
    queryFn: async () => (await api.get(`/public/quiz-attempts/${token}`)).data,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: () =>
      api.post(`/public/quiz-attempts/${token}/submit`, {
        solver_name: confirmedName,
        answers: Object.entries(answers).map(([question_id, choice_id]) => ({ question_id, choice_id })),
      }).then((r) => r.data),
    onError: (e) => toast.error(extractError(e)),
  });

  if (isLoading) {
    return <PageShell><p className="text-muted-foreground text-sm">{t("actions.loading")}</p></PageShell>;
  }

  if (isError || !data) {
    return (
      <PageShell>
        <p className="text-destructive font-medium">{t("quiz.link_invalid")}</p>
      </PageShell>
    );
  }

  if (submitMut.data) {
    const { score, max_score, matched } = submitMut.data;
    return (
      <PageShell>
        <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-success" />
        <h1 className="text-xl font-display font-semibold mb-2">{t("quiz.thanks", { name: confirmedName })}</h1>
        <p className="text-3xl font-mono font-bold mb-2">{score} / {max_score}</p>
        <p className="text-sm text-muted-foreground mb-3">{data.quiz_title}</p>
        {!matched && (
          <p className="text-xs text-warning flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {t("quiz.unmatched_solver_hint")}
          </p>
        )}
      </PageShell>
    );
  }

  // Gate: the solver must type their full name before the questions show —
  // there's no login on this link, so this is the only identifying step.
  if (!confirmedName) {
    const trimmed = solverName.trim();
    return (
      <PageShell>
        <h1 className="text-xl font-display font-bold mb-1">{data.quiz_title}</h1>
        {data.description && <p className="text-xs text-muted-foreground mb-6">{data.description}</p>}
        <div className="text-start space-y-3">
          <label className="text-xs font-medium block">{t("quiz.enter_full_name")}</label>
          <Input
            value={solverName}
            onChange={(e) => setSolverName(e.target.value)}
            placeholder={t("quiz.full_name_placeholder")}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && trimmed) setConfirmedName(trimmed); }}
          />
          <Button
            className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground"
            disabled={!trimmed}
            onClick={() => setConfirmedName(trimmed)}
          >
            {t("quiz.continue")}
          </Button>
        </div>
      </PageShell>
    );
  }

  const allAnswered = (data.questions || []).every((q) => answers[q.id]);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-1">{data.quiz_title}</h1>
        {data.description && <p className="text-sm text-muted-foreground mb-2">{data.description}</p>}
        <p className="text-xs text-muted-foreground mb-6">{t("quiz.hi", { name: confirmedName })}</p>

        <div className="space-y-5">
          {(data.questions || []).map((q, qi) => (
            <div key={q.id} className="surface-card p-5">
              <p className="font-medium mb-3">
                <span className="text-muted-foreground me-1">{qi + 1}.</span>{q.text}
              </p>
              <RadioGroup
                value={answers[q.id] || ""}
                onValueChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                className="space-y-2"
              >
                {q.choices.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value={c.id} />
                    {c.text}
                  </label>
                ))}
              </RadioGroup>
            </div>
          ))}
        </div>

        <Button
          className="w-full mt-6 h-11 bg-accent hover:bg-accent/90 text-accent-foreground"
          disabled={!allAnswered || submitMut.isPending}
          onClick={() => submitMut.mutate()}
        >
          {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
          {t("quiz.submit")}
        </Button>
      </div>
    </div>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  );
}

import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, Trash2, Upload } from "lucide-react";

import { api, extractError, resolveFileUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
const MAX_FILES = 10;

/** Public, no-login quiz-taking page. The link is shared with the whole
 * class at once (posted to a group chat, etc.) — there's no student
 * pre-assigned to it, so the solver types their own full name, reads the
 * exercise the teacher uploaded, then uploads photos of their handwritten
 * answers. The backend best-effort matches the typed name against the
 * group's roster so the teacher's grade lands on the right student. */
export default function TakeQuizPage() {
  const { token } = useParams();
  const { t } = useI18n();
  const fileRef = useRef(null);
  const [solverName, setSolverName] = useState("");
  const [confirmedName, setConfirmedName] = useState(null);
  const [files, setFiles] = useState([]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public-quiz-attempt", token],
    queryFn: async () => (await api.get(`/public/quiz-attempts/${token}`)).data,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("solver_name", confirmedName);
      files.forEach((f) => body.append("files", f));
      return api.post(`/public/quiz-attempts/${token}/submit`, body).then((r) => r.data);
    },
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
    const { files: count, matched } = submitMut.data;
    return (
      <PageShell>
        <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-success" />
        <h1 className="text-xl font-display font-semibold mb-2">{t("quiz.thanks", { name: confirmedName })}</h1>
        <p className="text-sm text-muted-foreground mb-1">{count} {t("quiz.submitted_files")}</p>
        <p className="text-sm text-muted-foreground mb-3">{data.quiz_title}</p>
        {!matched && (
          <p className="text-xs text-warning flex items-center justify-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {t("quiz.unmatched_solver_hint")}
          </p>
        )}
      </PageShell>
    );
  }

  // Gate: the solver must type their full name before the exercise shows —
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

  const exerciseHref = data.exercise_file_url ? resolveFileUrl(data.exercise_file_url) : null;
  const exerciseIsPdf = (data.exercise_file_url || "").toLowerCase().endsWith(".pdf");

  const addFiles = (picked) => {
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-display font-bold mb-1">{data.quiz_title}</h1>
        {data.description && <p className="text-sm text-muted-foreground mb-2">{data.description}</p>}
        <p className="text-xs text-muted-foreground mb-6">{t("quiz.hi", { name: confirmedName })}</p>

        <div className="surface-card p-5 mb-5">
          <h2 className="font-display font-semibold mb-3">{t("quiz.exercise")}</h2>
          {!exerciseHref ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : exerciseIsPdf ? (
            <a
              href={exerciseHref} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted transition-colors"
            >
              <FileText className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{data.exercise_file_name || t("quiz.download_exercise")}</span>
              <ExternalLink className="w-3.5 h-3.5 ms-auto flex-shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <a href={exerciseHref} target="_blank" rel="noreferrer">
              <img
                src={exerciseHref}
                alt={data.exercise_file_name || t("quiz.exercise")}
                className="rounded-lg border border-border w-full object-contain bg-muted/30"
              />
            </a>
          )}
        </div>

        <div className="surface-card p-5">
          <h2 className="font-display font-semibold mb-1">{t("quiz.your_answer")}</h2>
          <p className="text-xs text-muted-foreground mb-4">{t("quiz.answer_hint")}</p>

          <input
            ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <Button
            type="button" variant="outline" className="w-full"
            disabled={files.length >= MAX_FILES}
            onClick={() => fileRef.current?.click()}
            data-testid="quiz-add-answer-file"
          >
            <Upload className="w-4 h-4 me-2" /> {t("quiz.upload_answer")}
          </Button>

          {files.length > 0 && (
            <ul className="mt-4 space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm rounded-lg border border-border px-3 py-2">
                  <FileText className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{f.name}</span>
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={t("actions.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button
          className="w-full mt-6 h-11 bg-accent hover:bg-accent/90 text-accent-foreground"
          disabled={files.length === 0 || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          data-testid="quiz-submit"
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

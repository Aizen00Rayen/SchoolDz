import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Copy, ExternalLink, FileText, Loader2, Rocket, Upload,
} from "lucide-react";

import { api, extractError, resolveFileUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { PageHeader, StatusPill, Field } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

function isPdf(url = "") {
  return url.toLowerCase().endsWith(".pdf");
}

/** Inline preview of an uploaded page — images render, PDFs get a link card
 * (browsers can't reliably inline a PDF inside a small box). */
function FilePreview({ url, name, className = "" }) {
  const { t } = useI18n();
  const href = resolveFileUrl(url);
  if (isPdf(url)) {
    return (
      <a
        href={href} target="_blank" rel="noreferrer"
        className={`flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted transition-colors ${className}`}
      >
        <FileText className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{name || t("quiz.download_exercise")}</span>
        <ExternalLink className="w-3.5 h-3.5 ms-auto flex-shrink-0 text-muted-foreground" />
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`block ${className}`}>
      <img src={href} alt={name || ""} className="rounded-lg border border-border max-h-72 w-auto object-contain bg-muted/30" />
    </a>
  );
}

function GradeDialog({ quizId, attempt, maxScore, onClose }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [score, setScore] = useState(attempt?.score ?? "");
  const [feedback, setFeedback] = useState(attempt?.feedback ?? "");

  const gradeMut = useMutation({
    mutationFn: () =>
      api.post(`/quizzes/${quizId}/grade`, {
        attempt_id: attempt.id,
        score: parseFloat(score),
        feedback,
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["quiz-results", quizId] });
      onClose();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <Dialog open={!!attempt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{t("quiz.grade_submission")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {attempt?.solver_name}
            {attempt?.student_name ? ` · ${attempt.student_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[45vh] overflow-y-auto">
          {(attempt?.files || []).map((f) => (
            <FilePreview key={f.id} url={f.file_url} name={f.file_name} />
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); gradeMut.mutate(); }}
          className="space-y-4 border-t border-border pt-4"
        >
          <Field label={`${t("quiz.score")} / ${maxScore}`} required>
            <Input
              type="number" step="0.25" min="0" max={maxScore}
              value={score} onChange={(e) => setScore(e.target.value)} required
              data-testid="quiz-grade-score"
            />
          </Field>
          <Field label={t("quiz.feedback")}>
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("actions.cancel")}</Button>
            <Button type="submit" disabled={gradeMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {t("actions.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function QuizBuilderPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { canEdit } = usePermission("quizzes");
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [publishResult, setPublishResult] = useState(null);
  const [grading, setGrading] = useState(null);

  const { data: quiz, isLoading } = useQuery({
    queryKey: ["quiz", id],
    queryFn: async () => (await api.get(`/quizzes/${id}`)).data,
  });

  const { data: results } = useQuery({
    queryKey: ["quiz-results", id],
    queryFn: async () => (await api.get(`/quizzes/${id}/results`)).data,
  });

  const uploadMut = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/quizzes/${id}/exercise`, body).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["quiz", id] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const publishMut = useMutation({
    mutationFn: () => api.post(`/quizzes/${id}/publish`).then((r) => r.data),
    onSuccess: (data) => {
      setPublishResult(data);
      qc.invalidateQueries({ queryKey: ["quiz", id] });
      qc.invalidateQueries({ queryKey: ["quizzes"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  if (isLoading || !quiz) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const attempts = results?.items || [];
  const maxScore = Number(quiz.max_score || 20);

  return (
    <div>
      <PageHeader
        title={quiz.title}
        subtitle={quiz.group_name || t("menu.quizzes")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/quizzes"><ArrowLeft className="w-4 h-4 me-2" /> {t("menu.quizzes")}</Link>
            </Button>
            {canEdit && (
              <Button
                onClick={() => publishMut.mutate()}
                disabled={publishMut.isPending}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
                data-testid="quiz-publish"
              >
                {publishMut.isPending ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Rocket className="w-4 h-4 me-2" />}
                {t("quiz.publish")}
              </Button>
            )}
          </>
        }
      />

      <div className="surface-card p-6 mb-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-semibold text-lg">{t("quiz.exercise")}</h3>
          <StatusPill status={quiz.status} />
        </div>
        <p className="text-sm text-muted-foreground mb-4">{t("quiz.exercise_hint")}</p>

        {quiz.exercise_file_url && (
          <div className="mb-4">
            <FilePreview url={quiz.exercise_file_url} name={quiz.exercise_file_name} />
          </div>
        )}

        {canEdit && (
          <>
            <input
              ref={fileRef} type="file" accept={ACCEPT} className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) uploadMut.mutate(file);
              }}
            />
            <Button
              type="button" variant="outline"
              disabled={uploadMut.isPending}
              onClick={() => fileRef.current?.click()}
              data-testid="quiz-upload-exercise"
            >
              {uploadMut.isPending ? <Loader2 className="w-3.5 h-3.5 me-2 animate-spin" /> : <Upload className="w-3.5 h-3.5 me-2" />}
              {quiz.exercise_file_url ? t("quiz.replace_exercise") : t("quiz.upload_exercise")}
            </Button>
          </>
        )}
      </div>

      <div className="surface-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-display font-semibold text-lg">{t("quiz.results")}</h3>
        </div>
        {attempts.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("quiz.no_attempts")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["quiz.solver_name", "quiz.matched_student", "quiz.submitted_at", "quiz.score"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-medium">{a.solver_name}</td>
                    <td className="px-4 py-3 text-xs">
                      {a.student_name || <span className="text-muted-foreground">{t("quiz.unmatched")}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono">
                      {a.score != null
                        ? `${a.score} / ${a.max_score ?? maxScore}`
                        : <span className="text-muted-foreground text-xs">{t("quiz.not_graded")}</span>}
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <span className="text-[11px] text-muted-foreground me-2">
                        {(a.files || []).length} {t("quiz.submitted_files")}
                      </span>
                      {canEdit && (
                        <Button variant="outline" size="sm" onClick={() => setGrading(a)} data-testid={`quiz-grade-${a.id}`}>
                          {t("quiz.grade")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {grading && (
        <GradeDialog quizId={id} attempt={grading} maxScore={maxScore} onClose={() => setGrading(null)} />
      )}

      <Dialog open={!!publishResult} onOpenChange={(o) => !o && setPublishResult(null)}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("quiz.link_ready")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("quiz.link_hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={publishResult?.take_url || ""} className="font-mono text-xs bg-muted/40" />
            <Button
              type="button" variant="outline" size="icon"
              onClick={() => {
                navigator.clipboard.writeText(publishResult?.take_url || "");
                toast.success(t("settings.link_copied"));
              }}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

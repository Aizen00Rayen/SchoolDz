import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { PageHeader, EmptyState, CalendarGrid, CalendarMonthNav, RecurringDialog } from "./_shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export default function CalendarPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const nav = useNavigate();
  const [month, setMonth] = useState(new Date());
  const [view, setView] = useState("month");
  const [dayDetail, setDayDetail] = useState(null);

  // The visible window drives the query, so switching to Week doesn't refetch
  // a whole month and the week strip isn't missing sessions at its edges.
  const rangeStart = view === "week" ? startOfWeek(month) : startOfMonth(month);
  const rangeEnd = view === "week" ? endOfWeek(month) : endOfMonth(month);

  const isPremium = tenant?.plan === "premium";

  const { data: sessions } = useQuery({
    queryKey: ["calendar-sessions", view, format(rangeStart, "yyyy-MM-dd"), format(rangeEnd, "yyyy-MM-dd")],
    queryFn: async () => (await api.get("/sessions", {
      params: { from_date: rangeStart.toISOString(), to_date: rangeEnd.toISOString() },
    })).data,
    enabled: isPremium,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
    enabled: isPremium,
  });

  if (!isPremium) {
    return (
      <div>
        <PageHeader title={t("menu.calendar")} subtitle={t("subtitle.calendar")} />
        <EmptyState
          icon={CalendarDays}
          title={t("calendar.premium_feature_title")}
          description={t("calendar.premium_feature_desc")}
          action={
            <Button onClick={() => nav("/app/settings")} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {t("calendar.upgrade_plan")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("menu.calendar")}
        subtitle={t("subtitle.calendar")}
        actions={
          <>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {["week", "month"].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === v ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  data-testid={`calendar-view-${v}`}
                >
                  {t(`planner.${v}`)}
                </button>
              ))}
            </div>
            <RecurringDialog groups={groups} />
          </>
        }
      />
      <CalendarMonthNav month={month} onChange={setMonth} view={view} />
      <CalendarGrid
        month={month}
        view={view}
        sessions={sessions?.items || []}
        onDayClick={(day, daySessions) => setDayDetail({ day, sessions: daySessions })}
      />

      <Dialog open={!!dayDetail} onOpenChange={(open) => !open && setDayDetail(null)}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {dayDetail && format(dayDetail.day, "EEEE, MMMM d")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {dayDetail?.sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("planner.no_sessions")}</p>
            )}
            {dayDetail?.sessions.map((s) => (
              <div key={s.id} className="surface-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm font-semibold">
                    {format(new Date(s.start_at), "HH:mm")} → {format(new Date(s.end_at), "HH:mm")}
                  </span>
                  <span className="text-[11px] capitalize text-muted-foreground">{t(`status.${s.status}`)}</span>
                </div>
                {s.topic && <div className="text-sm font-medium mb-2">{s.topic}</div>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {[
                    ["field.group", s.group_name],
                    ["field.course", s.course_title],
                    ["field.teacher", s.teacher_name],
                    ["field.room", s.room],
                  ].map(([labelKey, value]) => value ? (
                    <div key={labelKey} className="contents">
                      <dt className="text-muted-foreground">{t(labelKey)}</dt>
                      <dd className="font-medium truncate">{value}</dd>
                    </div>
                  ) : null)}
                </dl>
                {s.homework && (
                  <p className="text-xs mt-2 pt-2 border-t border-border">
                    <span className="text-muted-foreground">{t("field.homework")}: </span>{s.homework}
                  </p>
                )}
                {s.notes && (
                  <p className="text-xs mt-1 text-muted-foreground">{s.notes}</p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

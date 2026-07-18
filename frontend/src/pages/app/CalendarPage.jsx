import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
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
  const [dayDetail, setDayDetail] = useState(null);

  const isPremium = tenant?.plan === "premium";

  const { data: sessions } = useQuery({
    queryKey: ["calendar-sessions", format(month, "yyyy-MM")],
    queryFn: async () => (await api.get("/sessions", {
      params: {
        from_date: startOfMonth(month).toISOString(),
        to_date: endOfMonth(month).toISOString(),
      },
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
        <PageHeader title={t("menu.calendar")} subtitle="A full month view of your sessions." />
        <EmptyState
          icon={CalendarDays}
          title="Calendar is a Premium feature"
          description="Upgrade to Premium to see all your sessions in a month view and generate recurring schedules."
          action={
            <Button onClick={() => nav("/app/settings")} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              Upgrade plan
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
        subtitle="A full month view of your sessions."
        actions={<RecurringDialog groups={groups} />}
      />
      <CalendarMonthNav month={month} onChange={setMonth} />
      <CalendarGrid
        month={month}
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
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {dayDetail?.sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">No sessions this day.</p>
            )}
            {dayDetail?.sessions.map((s) => (
              <div key={s.id} className="surface-card p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">
                    {format(new Date(s.start_at), "HH:mm")} → {format(new Date(s.end_at), "HH:mm")}
                  </span>
                  <span className="text-[11px] capitalize text-muted-foreground">{s.status}</span>
                </div>
                {s.topic && <div className="text-sm font-medium mt-1">{s.topic}</div>}
                {s.room && <div className="text-xs text-muted-foreground">Room {s.room}</div>}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

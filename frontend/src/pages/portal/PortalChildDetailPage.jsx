import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { ArrowLeft, AlertTriangle, StickyNote, FileDown } from "lucide-react";
import { toast } from "sonner";
import { api, extractError, openInvoicePdf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, LoadingRows, StatusPill, CalendarGrid, CalendarMonthNav } from "@/pages/app/_shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const downloadInvoice = (paymentId) => openInvoicePdf(paymentId).catch((e) => toast.error(extractError(e)));

function Table({ rows, isLoading, empty, columns }) {
  if (isLoading) return <LoadingRows />;
  if (!rows.length) return <p className="text-sm text-muted-foreground py-8 text-center">{empty}</p>;
  return (
    <div className="surface-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 border-b border-border">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-3">{c.render ? c.render(r) : r[c.key] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function PortalChildDetailPage() {
  const { studentId } = useParams();
  const { tenant } = useAuth();
  const [month, setMonth] = useState(new Date());
  const [dayDetail, setDayDetail] = useState(null);

  const { data: childData } = useQuery({
    queryKey: ["portal-children"],
    queryFn: async () => (await api.get("/portal/children")).data,
  });
  const child = (childData?.items || []).find((s) => s.id === studentId);

  const attendanceQ = useQuery({
    queryKey: ["portal-child-attendance", studentId],
    queryFn: async () => (await api.get(`/portal/children/${studentId}/attendance`)).data,
  });
  const sessionsQ = useQuery({
    queryKey: ["portal-child-sessions", studentId, format(month, "yyyy-MM")],
    queryFn: async () => (await api.get(`/portal/children/${studentId}/sessions`, {
      params: { from_date: startOfMonth(month).toISOString(), to_date: endOfMonth(month).toISOString() },
    })).data,
  });
  const paymentsQ = useQuery({
    queryKey: ["portal-child-payments", studentId],
    queryFn: async () => (await api.get(`/portal/children/${studentId}/payments`)).data,
  });
  const gradesQ = useQuery({
    queryKey: ["portal-child-grades", studentId],
    queryFn: async () => (await api.get(`/portal/children/${studentId}/grades`)).data,
  });
  const teachersQ = useQuery({
    queryKey: ["portal-child-teachers", studentId],
    queryFn: async () => (await api.get(`/portal/children/${studentId}/teachers`)).data,
  });

  const overduePayments = (paymentsQ.data?.items || []).filter(
    (p) => ["pending", "partial"].includes(p.status) && p.due_date && p.due_date < todayIso()
  );
  const overdueTotal = overduePayments.reduce((sum, p) => sum + (Number(p.amount) - Number(p.discount || 0)), 0);

  const notesFeed = useMemo(() => {
    const fromSessions = (sessionsQ.data?.items || [])
      .filter((s) => s.status === "completed" && (s.notes || s.homework))
      .map((s) => ({
        id: `session-${s.id}`, date: s.start_at, kind: "session",
        title: s.topic || "Class session", text: s.notes, homework: s.homework,
      }));
    const fromAttendance = (attendanceQ.data?.items || [])
      .filter((a) => a.note)
      .map((a) => ({ id: `attendance-${a.id}`, date: a.marked_at, kind: "attendance", title: null, text: a.note, status: a.status }));
    return [...fromSessions, ...fromAttendance].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [sessionsQ.data, attendanceQ.data]);

  return (
    <div>
      <Link to="/portal" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to children
      </Link>
      <PageHeader
        title={child ? `${child.first_name} ${child.last_name}` : "…"}
        subtitle={child?.student_code}
      />

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Calendar</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="teachers">Teachers</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <CalendarMonthNav month={month} onChange={setMonth} />
          <CalendarGrid
            month={month}
            sessions={sessionsQ.data?.items || []}
            onDayClick={(day, daySessions) => setDayDetail({ day, sessions: daySessions })}
          />
        </TabsContent>

        <TabsContent value="attendance">
          <Table
            isLoading={attendanceQ.isLoading}
            rows={attendanceQ.data?.items || []}
            empty="No attendance records yet."
            columns={[
              { key: "marked_at", label: "Date", render: (r) => <span className="font-mono text-xs">{new Date(r.marked_at).toLocaleDateString()}</span> },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
              { key: "note", label: "Note", render: (r) => r.note || <span className="text-muted-foreground">—</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="teachers">
          <Table
            isLoading={teachersQ.isLoading}
            rows={teachersQ.data?.items || []}
            empty="No teachers assigned yet."
            columns={[
              { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.first_name} {r.last_name}</span> },
              { key: "phone", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
              { key: "email", label: "Email", render: (r) => r.email || <span className="text-muted-foreground">—</span> },
              {
                key: "subjects", label: "Subjects",
                render: (r) => (Array.isArray(r.subjects) && r.subjects.length ? r.subjects.join(", ") : <span className="text-muted-foreground">—</span>),
              },
            ]}
          />
        </TabsContent>

        <TabsContent value="payments">
          {overduePayments.length > 0 && (
            <div className="surface-card p-4 mb-4 flex items-center gap-3 border-warning/30 bg-warning/5">
              <div className="w-9 h-9 rounded-lg bg-warning/10 grid place-items-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-warning" />
              </div>
              <div>
                <div className="text-sm font-medium">
                  {overduePayments.length} overdue payment{overduePayments.length > 1 ? "s" : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {Math.round(overdueTotal).toLocaleString()} {tenant?.currency || "DZD"} past the due date
                </div>
              </div>
            </div>
          )}
          <Table
            isLoading={paymentsQ.isLoading}
            rows={paymentsQ.data?.items || []}
            empty="No payment records yet."
            columns={[
              {
                key: "invoice_number", label: "Invoice",
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{r.invoice_number}</span>
                    <Button
                      type="button" variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => downloadInvoice(r.id)} title="Download invoice PDF"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ),
              },
              {
                key: "amount", label: "Amount",
                render: (r) => <span className="font-mono font-semibold">{Math.round(r.amount).toLocaleString()} {tenant?.currency || "DZD"}</span>,
              },
              { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
            ]}
          />
        </TabsContent>

        <TabsContent value="grades">
          <Table
            isLoading={gradesQ.isLoading}
            rows={gradesQ.data?.items || []}
            empty="No grades recorded yet."
            columns={[
              { key: "title", label: "Title", render: (r) => <span className="font-medium">{r.title}</span> },
              { key: "score", label: "Score", render: (r) => <span className="font-mono">{r.score} / {r.max_score}</span> },
              { key: "date", label: "Date", render: (r) => <span className="font-mono text-xs">{(r.date || "").slice(0, 10)}</span> },
            ]}
          />
        </TabsContent>

        <TabsContent value="notes">
          {sessionsQ.isLoading || attendanceQ.isLoading ? (
            <LoadingRows />
          ) : notesFeed.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No notes from teachers yet.</p>
          ) : (
            <div className="space-y-3">
              {notesFeed.map((n) => (
                <div key={n.id} className="surface-card p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-mono text-muted-foreground">{new Date(n.date).toLocaleDateString()}</span>
                    {n.title && <span className="text-xs font-medium">· {n.title}</span>}
                    {n.status && <StatusPill status={n.status} />}
                  </div>
                  {n.text && <p className="text-sm">{n.text}</p>}
                  {n.homework && (
                    <p className="text-xs text-muted-foreground mt-1"><span className="font-medium">Homework:</span> {n.homework}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
                  <StatusPill status={s.status} />
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

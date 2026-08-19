import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GraduationCap, ChevronRight, AlertTriangle, Clock, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/pages/app/_shared";

/** Amber for pending / dimmed red for rejected — same tri-state coloring as
 * the secretary's Students and Parents pages, so a parent watching their own
 * self-enrolled child sees the same review status. */
function approvalRowClass(status) {
  if (status === "pending") return "border-warning/40 bg-warning/5";
  if (status === "rejected") return "border-destructive/40 bg-destructive/5 opacity-75";
  return "";
}

export default function PortalHomePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal-children"],
    queryFn: async () => (await api.get("/portal/children")).data,
  });
  const children = data?.items || [];

  return (
    <div>
      <PageHeader title="Your children" subtitle="Select a child to see their calendar, attendance, teachers, payments, grades and notes." />
      {isLoading ? (
        <LoadingRows />
      ) : children.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No children linked" description="Contact your school if this looks wrong." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {children.map((child) => (
            <Link
              key={child.id}
              to={`/portal/children/${child.id}`}
              className={`surface-card p-4 flex items-center gap-3 hover:bg-muted/40 transition-colors ${approvalRowClass(child.approval_status)}`}
            >
              <div className="w-10 h-10 rounded-lg bg-muted grid place-items-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{child.first_name} {child.last_name}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{child.student_code}</div>
                {child.approval_status === "pending" && (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-warning mt-0.5">
                    <Clock className="w-3 h-3" /> Awaiting school approval
                  </div>
                )}
                {child.approval_status === "rejected" && (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-destructive mt-0.5">
                    <XCircle className="w-3 h-3" /> Enrollment rejected
                  </div>
                )}
              </div>
              {child.has_overdue_payment && (
                <span title="Overdue payment" className="w-6 h-6 rounded-full bg-warning/10 grid place-items-center flex-shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

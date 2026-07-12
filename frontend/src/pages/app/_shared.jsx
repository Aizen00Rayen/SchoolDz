import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-16 px-6 border border-dashed border-border rounded-xl bg-card/40">
      {Icon && (
        <div className="w-12 h-12 rounded-lg bg-muted mx-auto mb-4 grid place-items-center">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="font-display font-semibold text-lg mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function StatusPill({ status, tone = "default" }) {
  const map = {
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    scheduled: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    inactive: "bg-muted text-muted-foreground",
    cancelled: "bg-red-500/10 text-red-700 dark:text-red-400",
    refunded: "bg-red-500/10 text-red-700 dark:text-red-400",
    absent: "bg-red-500/10 text-red-700 dark:text-red-400",
    present: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    late: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    excused: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    trial: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    draft: "bg-muted text-muted-foreground",
  };
  const cls = map[status] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

export function LoadingRows({ rows = 4, cols = 4 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-10 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function FadeIn({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      {children}
    </motion.div>
  );
}

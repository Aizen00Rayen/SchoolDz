import { Skeleton } from "@/components/ui/skeleton";

/** Shown while the session loads: the shape of the app (sidebar, header,
 * stat cards, content) instead of a blank page with a "Loading…" line. */
export function AppSkeleton({ withSidebar = true }) {
  return (
    <div className="min-h-screen flex bg-background" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {withSidebar && (
        <aside className="hidden lg:flex w-64 flex-col gap-3 border-e border-border p-4">
          <Skeleton className="h-9 w-40 mb-4" />
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}
        </aside>
      )}
      <main className="flex-1 min-w-0">
        <div className="h-16 border-b border-border px-4 flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="p-4 sm:p-6 lg:p-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    </div>
  );
}

export default AppSkeleton;

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Server-side feature flags (e.g. whether Google OAuth is configured on this
// deployment). Some hosts — like a free PythonAnywhere account — can't reach
// accounts.google.com at all, so the backend reports whether it's usable and
// the frontend hides the button rather than offering a dead flow.
export function useServerConfig() {
  return useQuery({
    queryKey: ["server-config"],
    queryFn: () => api.get("/config").then((r) => r.data),
    staleTime: Infinity,
    retry: false,
  });
}

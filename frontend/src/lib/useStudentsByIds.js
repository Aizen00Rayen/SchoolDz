import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

const CHUNK = 40;

/**
 * Students for the given ids, keyed by id.
 *
 * GET /students returns at most the newest 500 students, so a school with
 * more students silently loses its oldest ones from any page that builds a
 * map from that list. `baseItems` is that (possibly truncated) list; every id
 * it does not contain is fetched explicitly with ?ids= so a group's roster
 * is complete whatever the school's size.
 */
export function useStudentsByIds(ids, baseItems) {
  const known = useMemo(
    () => Object.fromEntries((baseItems || []).map((s) => [s.id, s])),
    [baseItems],
  );
  const missing = useMemo(
    () => [...new Set((ids || []).filter((id) => id && !known[id]))].sort(),
    [ids, known],
  );

  const { data: extra } = useQuery({
    queryKey: ["students-by-ids", missing.join(",")],
    enabled: missing.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const found = [];
      for (let i = 0; i < missing.length; i += CHUNK) {
        const { data } = await api.get("/students", {
          params: { ids: missing.slice(i, i + CHUNK).join(",") },
        });
        found.push(...(data?.items || []));
      }
      return found;
    },
  });

  return useMemo(() => {
    const map = { ...known };
    for (const s of extra || []) map[s.id] = s;
    return map;
  }, [known, extra]);
}

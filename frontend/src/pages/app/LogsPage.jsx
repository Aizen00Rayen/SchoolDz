import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";

import { api, downloadFrom } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, EmptyState, LoadingRows, Field } from "./_shared";

const CATEGORIES = ["auth", "data", "security", "billing"];

const CATEGORY_TONE = {
  security: "bg-destructive/10 text-destructive",
  auth: "bg-primary/10 text-primary",
  billing: "bg-accent/10 text-accent",
  data: "bg-muted text-muted-foreground",
};

export default function LogsPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ from: "", to: "", category: "", q: "" });

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["logs", filters],
    queryFn: () => api.get(`/logs${query ? `?${query}` : ""}`).then((r) => r.data),
  });

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title={t("menu.logs")}
        subtitle={t("subtitle.logs")}
        actions={
          <Button variant="outline" onClick={() => downloadFrom(`/logs?${query}`, "xlsx", "activity-logs")}>
            <Download className="w-4 h-4 me-2" /> {t("export.excel")}
          </Button>
        }
      />

      <div className="surface-card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label={t("reports.from")}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t("reports.to")}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
        <Field label={t("logs.category")}>
          <Select
            value={filters.category || "__all"}
            onValueChange={(v) => setFilters({ ...filters, category: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("logs.all_categories")}</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{t(`log_category.${c}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("actions.search")}>
          <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} data-testid="logs-search" />
        </Field>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={ScrollText} title={t("menu.logs")} description={t("subtitle.logs")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["logs.when", "logs.user", "logs.category", "logs.action", "logs.description", "logs.ip"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{l.user_label || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_TONE[l.category] || CATEGORY_TONE.data}`}>
                        {t(`log_category.${l.category}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px]">{l.action}</td>
                    <td className="px-4 py-3 text-xs">{l.description || "—"}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{l.ip_address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

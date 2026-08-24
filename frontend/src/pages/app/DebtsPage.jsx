import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, LoadingRows } from "./_shared";

export default function DebtsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const [q, setQ] = useState("");
  const currency = tenant?.currency || "DZD";

  const { data, isLoading } = useQuery({
    queryKey: ["payments-balances"],
    queryFn: async () => (await api.get("/payments/balances")).data,
  });

  const debtors = (data?.items || []).filter((r) => r.status === "owes");
  const filtered = q.trim()
    ? debtors.filter((r) => r.student_name.toLowerCase().includes(q.trim().toLowerCase()))
    : debtors;
  const totalOwed = debtors.reduce((sum, r) => sum + Math.abs(r.balance), 0);

  return (
    <div>
      <PageHeader title={t("menu.debts")} subtitle={t("subtitle.debts")} />

      <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("actions.search")}
          className="h-9"
          data-testid="debts-search-input"
        />
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-end sm:text-start">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("debts.students_count")}</div>
          <div className="font-mono font-bold text-lg">{debtors.length}</div>
        </div>
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-end sm:text-start">
          <div className="text-[10px] uppercase tracking-widest text-destructive/80">{t("debts.total_owed")}</div>
          <div className="font-mono font-bold text-lg text-destructive">
            {Math.round(totalOwed).toLocaleString()} {currency}
          </div>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            title={t(debtors.length === 0 ? "debts.none_title" : "debts.no_match_title")}
            description={t(debtors.length === 0 ? "debts.none_description" : "debts.no_match_description")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.student", "debts.contact", "field.amount_paid", "debts.owed"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const contactName = row.parent_name || row.student_name;
                  const contactPhone = row.parent_phone || row.student_phone;
                  return (
                    <tr key={row.student_id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium">{row.student_name}</td>
                      <td className="px-4 py-3 text-xs">
                        {contactPhone ? (
                          <div>
                            <div>{contactName}</div>
                            <div className="text-muted-foreground font-mono">{contactPhone}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {Math.round(row.paid).toLocaleString()} {currency}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-destructive">
                        {Math.round(Math.abs(row.balance)).toLocaleString()} {currency}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

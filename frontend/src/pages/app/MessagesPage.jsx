import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, Plus, Search } from "lucide-react";
import { PageHeader, ChatThread, EmptyState, LoadingRows } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

function NewConversationDialog({ onCreated }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const { data: parents } = useQuery({
    queryKey: ["parents-search", q],
    queryFn: async () => (await api.get("/parents", { params: q ? { q } : {} })).data,
    enabled: open,
  });

  const createMut = useMutation({
    mutationFn: (guardianId) => api.post("/conversations", { guardian_id: guardianId }).then((r) => r.data),
    onSuccess: (convo) => {
      setOpen(false);
      setQ("");
      onCreated(convo.id);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} className="bg-accent hover:bg-accent/90 text-accent-foreground">
        <Plus className="w-4 h-4 me-2" /> {t("messages.new_conversation")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("messages.start_conversation")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("messages.pick_parent")}
            </DialogDescription>
          </DialogHeader>
          <Input placeholder={t("messages.search_parents")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {(parents?.items || []).map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.email || createMut.isPending}
                onClick={() => createMut.mutate(p.id)}
                title={!p.email ? t("messages.no_email_on_file") : undefined}
                className="w-full text-start px-3 py-2 rounded-lg hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.email || t("messages.no_email")}</div>
              </button>
            ))}
            {parents && parents.items.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">{t("messages.no_parents_found")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function MessagesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState("");

  const convosQ = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => (await api.get("/conversations")).data,
    refetchInterval: 20000,
  });

  const messagesQ = useQuery({
    queryKey: ["conversation-messages", selectedId],
    queryFn: async () => (await api.get(`/conversations/${selectedId}/messages`)).data,
    enabled: !!selectedId,
    refetchInterval: 15000,
  });

  const sendMut = useMutation({
    mutationFn: (body) => api.post(`/conversations/${selectedId}/messages`, { body }).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(["conversation-messages", selectedId], data);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const conversations = useMemo(() => convosQ.data?.items || [], [convosQ.data]);
  const filteredConversations = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) =>
      (c.guardian_name || "").toLowerCase().includes(needle) ||
      (c.guardian_email || "").toLowerCase().includes(needle)
    );
  }, [conversations, q]);
  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title={t("menu.messages")}
        subtitle={t("subtitle.messages")}
        actions={<NewConversationDialog onCreated={setSelectedId} />}
      />
      <div className="surface-card flex-1 min-h-0 grid grid-cols-[280px_1fr] overflow-hidden">
        <div className="border-e border-border overflow-y-auto">
          <div className="p-2 border-b border-border sticky top-0 bg-card z-10">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("actions.search")}
                className="ps-9 h-9"
                data-testid="messages-search-input"
              />
            </div>
          </div>
          {convosQ.isLoading ? (
            <div className="p-4"><LoadingRows rows={3} cols={1} /></div>
          ) : conversations.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={MessageSquare} title={t("messages.no_conversations_title")} description={t("messages.no_conversations_desc")} />
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 px-4">{t("messages.no_match", { query: q })}</p>
          ) : (
            filteredConversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`w-full text-start px-4 py-3 border-b border-border hover:bg-muted/40 transition-colors ${
                  selectedId === c.id ? "bg-muted/60" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{c.guardian_name}</span>
                  {c.unread_by_staff && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground truncate">{c.guardian_email || "—"}</div>
              </button>
            ))
          )}
        </div>
        <div className="min-h-0">
          {!selectedId ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              {t("messages.select_conversation")}
            </div>
          ) : (
            <ChatThread
              messages={messagesQ.data?.items || []}
              onSend={(body) => sendMut.mutate(body)}
              currentRole="staff"
              sending={sendMut.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

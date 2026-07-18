import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, ChatThread } from "@/pages/app/_shared";
import { api, extractError } from "@/lib/api";

export default function PortalMessagesPage() {
  const qc = useQueryClient();

  const messagesQ = useQuery({
    queryKey: ["portal-conversation-messages"],
    queryFn: async () => (await api.get("/portal/conversation/messages")).data,
    refetchInterval: 15000,
  });

  const sendMut = useMutation({
    mutationFn: (body) => api.post("/portal/conversation/messages", { body }).then((r) => r.data),
    onSuccess: (data) => {
      qc.setQueryData(["portal-conversation-messages"], data);
      qc.invalidateQueries({ queryKey: ["portal-conversation"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader title="Messages" subtitle="Talk directly with the school administration." />
      <div className="surface-card flex-1 min-h-0 overflow-hidden">
        <ChatThread
          messages={messagesQ.data?.items || []}
          onSend={(body) => sendMut.mutate(body)}
          currentRole="parent"
          sending={sendMut.isPending}
        />
      </div>
    </div>
  );
}

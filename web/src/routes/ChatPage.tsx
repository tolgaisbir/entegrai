import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { ChatMessage, ChatSession } from "../api/types";
import { ChatSidebar } from "./ChatSidebar";

function ToolCallSummary({ toolCallData }: { toolCallData: unknown }) {
  if (!Array.isArray(toolCallData) || toolCallData.length === 0) return null;
  const names = toolCallData
    .map((c) => (typeof c === "object" && c !== null && "name" in c ? String((c as { name: unknown }).name) : "?"))
    .join(", ");
  return <div className="muted">🔧 Araç çağrılıyor: {names}</div>;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    let pretty = message.content;
    try {
      pretty = JSON.stringify(JSON.parse(message.content), null, 2);
    } catch {
      // düz metinse olduğu gibi göster
    }
    return (
      <div className="chat-bubble tool">
        <div className="muted" style={{ marginBottom: 4 }}>
          araç sonucu
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty}</pre>
      </div>
    );
  }
  return (
    <div className={`chat-bubble ${message.role}`}>
      {message.content}
      <ToolCallSummary toolCallData={message.toolCallData} />
    </div>
  );
}

export function ChatPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sessionQuery = useQuery({
    queryKey: ["chat", "session", sessionId],
    queryFn: () => api.get<ChatSession>(`/chat/sessions/${sessionId}`),
    enabled: !!sessionId,
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      api.post<{ userMessage: ChatMessage; messages: ChatMessage[] }>(`/chat/sessions/${sessionId}/messages`, {
        content,
      }),
    onSuccess: () => {
      setDraft("");
      setSendError(null);
      queryClient.invalidateQueries({ queryKey: ["chat", "session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403 && err.body && typeof err.body === "object" && "error" in err.body && (err.body as { error: string }).error === "budget_exceeded") {
        setSendError("Bu skill/sağlayıcı için bütçeniz doldu. Farklı bir sağlayıcı deneyin veya yöneticinizle görüşün.");
      } else if (err instanceof ApiError && err.status === 502) {
        setSendError("AI sağlayıcısına ulaşılamadı: " + err.message);
      } else {
        setSendError(err instanceof Error ? err.message : "Mesaj gönderilemedi.");
      }
      queryClient.invalidateQueries({ queryKey: ["chat", "session", sessionId] });
    },
  });

  const deleteSession = useMutation({
    mutationFn: () => api.delete(`/chat/sessions/${sessionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
      navigate("/chat");
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sessionQuery.data?.messages?.length]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sendMessage.isPending) return;
    sendMessage.mutate(draft.trim());
  }

  if (!sessionId) {
    return (
      <>
        <ChatSidebar />
        <main className="chat-main">
          <div className="centered-page" style={{ height: "100%" }}>
            <p className="muted">Sol taraftan bir sohbet seçin veya yeni bir sohbet başlatın.</p>
          </div>
        </main>
      </>
    );
  }

  const session = sessionQuery.data;

  return (
    <>
      <ChatSidebar activeSessionId={sessionId} />
      <main className="chat-main">
        {session && (
          <div className="chat-header">
            <strong>{session.title || "(başlıksız sohbet)"}</strong>
            <span className="muted">{session.aiProvider?.name}</span>
            <div className="spacer" style={{ flex: 1 }} />
            {session.budget && session.budget.length > 0 && (
              <div className="budget-bar">
                {session.budget.map((b) => (
                  <span key={b.period} className={b.exceeded ? "exceeded" : ""}>
                    {b.period === "monthly" ? "Aylık" : "Günlük"}: {b.usedUsd.toFixed(2)} / {b.limitUsd.toFixed(2)} USD
                  </span>
                ))}
              </div>
            )}
            <button className="danger" onClick={() => deleteSession.mutate()}>
              Sil
            </button>
          </div>
        )}
        <div className="chat-messages">
          {sessionQuery.isLoading && <p className="muted">Yükleniyor…</p>}
          {(session?.messages ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {sendMessage.isPending && <div className="chat-bubble assistant muted">yazıyor…</div>}
          <div ref={messagesEndRef} />
        </div>
        {sendError && (
          <div className="error-text" style={{ padding: "0 16px" }}>
            {sendError}
          </div>
        )}
        <form className="chat-compose" onSubmit={handleSubmit}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Mesajınızı yazın… (Enter ile gönder, Shift+Enter yeni satır)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button type="submit" className="primary" disabled={sendMessage.isPending || !draft.trim()}>
            Gönder
          </button>
        </form>
      </main>
    </>
  );
}

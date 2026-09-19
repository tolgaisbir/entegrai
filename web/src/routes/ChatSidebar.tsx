import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { AiProvider, ChatSessionGroup, Skill } from "../api/types";

export function ChatSidebar({ activeSessionId }: { activeSessionId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");

  const skillsQuery = useQuery({
    queryKey: ["chat", "skills"],
    queryFn: () => api.get<Skill[]>("/chat/skills"),
  });
  const groupsQuery = useQuery({
    queryKey: ["chat", "sessions"],
    queryFn: () => api.get<ChatSessionGroup[]>("/chat/sessions"),
  });
  const providersQuery = useQuery({
    queryKey: ["chat", "ai-providers", selectedSkillId],
    queryFn: () => api.get<AiProvider[]>(`/chat/ai-providers?skillId=${selectedSkillId}`),
    enabled: creating && !!selectedSkillId,
  });

  const createSession = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/chat/sessions", {
        skillId: selectedSkillId,
        ...(selectedProviderId ? { aiProviderId: selectedProviderId } : {}),
      }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
      setCreating(false);
      setSelectedSkillId("");
      setSelectedProviderId("");
      navigate(`/chat/${session.id}`);
    },
  });

  const skills = skillsQuery.data ?? [];
  const groups = groupsQuery.data ?? [];

  return (
    <aside className="chat-sidebar">
      <div className="new-session">
        {!creating ? (
          <button className="primary" style={{ width: "100%" }} onClick={() => setCreating(true)} disabled={skills.length === 0}>
            + Yeni sohbet
          </button>
        ) : (
          <div className="form-stack">
            <label>
              Skill
              <select value={selectedSkillId} onChange={(e) => setSelectedSkillId(e.target.value)}>
                <option value="">Seçiniz…</option>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedSkillId && (
              <label>
                AI Sağlayıcı (opsiyonel)
                <select value={selectedProviderId} onChange={(e) => setSelectedProviderId(e.target.value)}>
                  <option value="">Otomatik</option>
                  {(providersQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="primary"
                disabled={!selectedSkillId || createSession.isPending}
                onClick={() => createSession.mutate()}
              >
                Başlat
              </button>
              <button onClick={() => setCreating(false)}>Vazgeç</button>
            </div>
            {createSession.isError && <div className="error-text">Oturum oluşturulamadı.</div>}
          </div>
        )}
        {skills.length === 0 && !skillsQuery.isLoading && (
          <p className="muted" style={{ marginTop: 8 }}>
            Size atanmış bir skill yok. Yöneticinizle iletişime geçin.
          </p>
        )}
      </div>

      {groups.map((group) => (
        <div className="skill-group" key={group.skill.id}>
          <h4>{group.skill.name}</h4>
          {group.sessions.map((session) => (
            <NavLink
              key={session.id}
              to={`/chat/${session.id}`}
              className={"session-item" + (session.id === activeSessionId ? " active" : "")}
            >
              {session.title || "(başlıksız sohbet)"}
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}

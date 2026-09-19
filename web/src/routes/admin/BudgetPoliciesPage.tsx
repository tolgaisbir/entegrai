import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { AiProvider, BudgetPolicy, BudgetStatus, Skill, User } from "../../api/types";
import { Modal } from "../../components/Modal";

interface UsageOverviewRow {
  userId: string;
  userFullName: string;
  userEmail: string;
  skills: { skillId: string; skillName: string; statuses: BudgetStatus[] }[];
}

export function BudgetPoliciesPage() {
  const [aiProviderId, setAiProviderId] = useState("");
  const providersQuery = useQuery({
    queryKey: ["admin", "ai-providers"],
    queryFn: () => api.get<AiProvider[]>("/admin/ai-providers"),
  });

  return (
    <div>
      <h2>Bütçe Yönetimi</h2>
      <label style={{ maxWidth: 320 }}>
        AI Sağlayıcı
        <select value={aiProviderId} onChange={(e) => setAiProviderId(e.target.value)}>
          <option value="">Seçiniz…</option>
          {(providersQuery.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {aiProviderId && <BudgetPoliciesForProvider aiProviderId={aiProviderId} />}
    </div>
  );
}

function BudgetPoliciesForProvider({ aiProviderId }: { aiProviderId: string }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingLimit, setEditingLimit] = useState<BudgetPolicy | null>(null);

  const skillsQuery = useQuery({ queryKey: ["admin", "skills"], queryFn: () => api.get<Skill[]>("/admin/skills") });
  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<User[]>("/admin/users") });
  const policiesQuery = useQuery({
    queryKey: ["admin", "budget-policies", aiProviderId],
    queryFn: () => api.get<BudgetPolicy[]>(`/admin/budget-policies?aiProviderId=${aiProviderId}`),
  });
  const overviewQuery = useQuery({
    queryKey: ["admin", "budget-usage-overview", aiProviderId],
    queryFn: () => api.get<UsageOverviewRow[]>(`/admin/budget-policies/usage-overview?aiProviderId=${aiProviderId}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/budget-policies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "budget-policies", aiProviderId] }),
  });

  function scopeLabel(policy: BudgetPolicy): string {
    if (policy.scopeType === "global") return "Genel (tüm kullanıcılar)";
    if (policy.scopeType === "skill") {
      return "Skill: " + (skillsQuery.data?.find((s) => s.id === policy.scopeId)?.name ?? policy.scopeId);
    }
    return "Kullanıcı: " + (usersQuery.data?.find((u) => u.id === policy.scopeId)?.fullName ?? policy.scopeId);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div className="admin-toolbar">
        <h3>Bütçe Politikaları</h3>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Politika
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Kapsam</th>
            <th>Periyot</th>
            <th>Limit (USD)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(policiesQuery.data ?? []).map((policy) => (
            <tr key={policy.id}>
              <td>{scopeLabel(policy)}</td>
              <td>{policy.period === "monthly" ? "Aylık" : "Günlük"}</td>
              <td>{policy.limitUsd}</td>
              <td className="actions">
                <button onClick={() => setEditingLimit(policy)}>Limiti düzenle</button>
                <button className="danger" onClick={() => remove.mutate(policy.id)}>
                  Sil
                </button>
              </td>
            </tr>
          ))}
          {policiesQuery.data?.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Henüz bütçe politikası tanımlanmamış.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3 style={{ marginTop: 32 }}>Kullanım Özeti</h3>
      <table>
        <thead>
          <tr>
            <th>Kullanıcı</th>
            <th>Skill</th>
            <th>Periyot</th>
            <th>Kaynak</th>
            <th>Kullanım</th>
            <th>Limit</th>
            <th>Kalan</th>
          </tr>
        </thead>
        <tbody>
          {(overviewQuery.data ?? []).flatMap((row) =>
            row.skills.flatMap((skill) =>
              skill.statuses.map((status) => (
                <tr key={`${row.userId}-${skill.skillId}-${status.period}`}>
                  <td>{row.userFullName}</td>
                  <td>{skill.skillName}</td>
                  <td>{status.period === "monthly" ? "Aylık" : "Günlük"}</td>
                  <td>{status.source}</td>
                  <td className={status.exceeded ? "error-text" : ""}>{status.usedUsd.toFixed(2)}</td>
                  <td>{status.limitUsd.toFixed(2)}</td>
                  <td>{status.remainingUsd.toFixed(2)}</td>
                </tr>
              )),
            ),
          )}
        </tbody>
      </table>

      {creating && (
        <BudgetPolicyFormModal
          aiProviderId={aiProviderId}
          skills={skillsQuery.data ?? []}
          users={usersQuery.data ?? []}
          onClose={() => setCreating(false)}
        />
      )}
      {editingLimit && (
        <EditLimitModal policy={editingLimit} onClose={() => setEditingLimit(null)} aiProviderId={aiProviderId} />
      )}
    </div>
  );
}

function BudgetPolicyFormModal({
  aiProviderId,
  skills,
  users,
  onClose,
}: {
  aiProviderId: string;
  skills: Skill[];
  users: User[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [scopeType, setScopeType] = useState<"global" | "skill" | "user">("global");
  const [scopeId, setScopeId] = useState("");
  const [period, setPeriod] = useState<"daily" | "monthly">("monthly");
  const [limitUsd, setLimitUsd] = useState("10");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post("/admin/budget-policies", {
        aiProviderId,
        scopeType,
        period,
        limitUsd: Number(limitUsd),
        ...(scopeType !== "global" ? { scopeId } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "budget-policies", aiProviderId] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setError("Bu kapsam/periyot için zaten bir politika var.");
      } else {
        setError(err instanceof Error ? err.message : "Kaydedilemedi");
      }
    },
  });

  return (
    <Modal title="Yeni Bütçe Politikası" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Kapsam
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)}>
            <option value="global">Genel (tüm kullanıcılar)</option>
            <option value="skill">Skill bazlı</option>
            <option value="user">Kullanıcı override</option>
          </select>
        </label>
        {scopeType === "skill" && (
          <label>
            Skill
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} required>
              <option value="">Seçiniz…</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {scopeType === "user" && (
          <label>
            Kullanıcı
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} required>
              <option value="">Seçiniz…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Periyot
          <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="monthly">Aylık</option>
            <option value="daily">Günlük</option>
          </select>
        </label>
        <label>
          Limit (USD)
          <input type="number" min="0.01" step="0.01" value={limitUsd} onChange={(e) => setLimitUsd(e.target.value)} required />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={save.isPending}>
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditLimitModal({
  policy,
  aiProviderId,
  onClose,
}: {
  policy: BudgetPolicy;
  aiProviderId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [limitUsd, setLimitUsd] = useState(policy.limitUsd);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/budget-policies/${policy.id}`, { limitUsd: Number(limitUsd) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "budget-policies", aiProviderId] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title="Limiti düzenle" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Limit (USD)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={limitUsd}
            onChange={(e) => setLimitUsd(e.target.value)}
            required
            autoFocus
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" className="primary" disabled={save.isPending}>
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  );
}

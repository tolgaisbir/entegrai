import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { AiProvider } from "../../api/types";
import { Modal } from "../../components/Modal";

const PROVIDER_TYPES = ["anthropic", "openai", "azure_openai", "google", "other"] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];

export function AiProvidersPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "ai-providers"], queryFn: () => api.get<AiProvider[]>("/admin/ai-providers") });
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/ai-providers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "ai-providers"] }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        alert("Bu sağlayıcıya ait kullanım geçmişi/atamalar var, silinemez. Önce pasife alın.");
      } else {
        alert("Silinemedi: " + (err instanceof Error ? err.message : "bilinmeyen hata"));
      }
    },
  });

  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/admin/ai-providers/${id}/test`),
    onSuccess: (result, id) => setTestResult((prev) => ({ ...prev, [id]: result.message })),
  });

  return (
    <div>
      <div className="admin-toolbar">
        <h2>AI Sağlayıcılar</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Sağlayıcı
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ad</th>
            <th>Tip</th>
            <th>Model</th>
            <th>API Key</th>
            <th>Aktif</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.providerType}</td>
              <td>{p.model}</td>
              <td className="muted">{p.apiKeyPreview}</td>
              <td>
                <span className={`badge ${p.isActive ? "on" : "off"}`}>{p.isActive ? "aktif" : "pasif"}</span>
              </td>
              <td className="actions">
                <button onClick={() => test.mutate(p.id)} disabled={test.isPending}>
                  Test
                </button>
                <button onClick={() => setEditing(p)}>Düzenle</button>
                <button
                  className="danger"
                  onClick={() => window.confirm(`"${p.name}" silinsin mi?`) && remove.mutate(p.id)}
                >
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.entries(testResult).map(([id, message]) => (
        <p key={id} className="muted">
          {query.data?.find((p) => p.id === id)?.name}: {message}
        </p>
      ))}

      {(creating || editing) && (
        <AiProviderFormModal
          provider={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AiProviderFormModal({ provider, onClose }: { provider: AiProvider | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(provider?.name ?? "");
  const [providerType, setProviderType] = useState<ProviderType>(provider?.providerType ?? "anthropic");
  const [apiBaseUrl, setApiBaseUrl] = useState(provider?.apiBaseUrl ?? "");
  const [model, setModel] = useState(provider?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [isActive, setIsActive] = useState(provider?.isActive ?? false);
  const [defaultParamsText, setDefaultParamsText] = useState(
    JSON.stringify(provider?.defaultParams ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      let defaultParams: Record<string, unknown>;
      try {
        defaultParams = JSON.parse(defaultParamsText);
      } catch {
        throw new Error("defaultParams geçerli bir JSON olmalı");
      }
      const payload = {
        name,
        providerType,
        apiBaseUrl: apiBaseUrl || undefined,
        model,
        isActive,
        defaultParams,
        ...(apiKey ? { apiKey } : {}),
      };
      return provider ? api.patch(`/admin/ai-providers/${provider.id}`, payload) : api.post("/admin/ai-providers", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title={provider ? "Sağlayıcı düzenle" : "Yeni AI Sağlayıcı"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Ad
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Tip
          <select value={providerType} onChange={(e) => setProviderType(e.target.value as ProviderType)}>
            {PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="ör. claude-sonnet-5" required />
        </label>
        <label>
          API Base URL (opsiyonel)
          <input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://..." />
        </label>
        <label>
          API Key {provider && <span className="muted">(mevcut: {provider.apiKeyPreview}, boş bırakılırsa değişmez)</span>}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required={!provider} />
        </label>
        <label>
          Ayarlar (JSON — temperature, max_tokens, system_prompt, price_per_1k_input_usd, price_per_1k_output_usd)
          <textarea
            value={defaultParamsText}
            onChange={(e) => setDefaultParamsText(e.target.value)}
            rows={5}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: "auto" }} />
          Aktif sağlayıcı (yeni sohbetlerde varsayılan seçilir)
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

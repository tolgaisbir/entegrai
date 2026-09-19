import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { McpIntegration } from "../../api/types";
import { Modal } from "../../components/Modal";

const TYPES = ["http_api", "database", "internal_tool", "file_share", "smtp_mail"] as const;
type IntegrationType = (typeof TYPES)[number];

export function McpIntegrationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "mcp-integrations"],
    queryFn: () => api.get<McpIntegration[]>("/admin/mcp-integrations"),
  });
  const [editing, setEditing] = useState<McpIntegration | null>(null);
  const [creating, setCreating] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/mcp-integrations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "mcp-integrations"] }),
    onError: (err) => alert("Silinemedi: " + (err instanceof Error ? err.message : "bilinmeyen hata")),
  });

  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/admin/mcp-integrations/${id}/test`),
    onSuccess: (result, id) => setTestResult((prev) => ({ ...prev, [id]: result.message })),
  });

  return (
    <div>
      <div className="admin-toolbar">
        <h2>MCP Entegrasyonları</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Entegrasyon
        </button>
      </div>
      <p className="muted">
        Şu an sadece <code>http_api</code> tipi, chat bot'taki tool çağrısı akışında kullanılabiliyor (bkz. PROGRESS.md).
      </p>
      <table>
        <thead>
          <tr>
            <th>Ad</th>
            <th>Tip</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.type}</td>
              <td>
                <span className={`badge ${m.isEnabled ? "on" : "off"}`}>{m.isEnabled ? "etkin" : "kapalı"}</span>
              </td>
              <td className="actions">
                <button onClick={() => test.mutate(m.id)} disabled={test.isPending}>
                  Test
                </button>
                <button onClick={() => setEditing(m)}>Düzenle</button>
                <button
                  className="danger"
                  onClick={() => window.confirm(`"${m.name}" silinsin mi?`) && remove.mutate(m.id)}
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
          {query.data?.find((m) => m.id === id)?.name}: {message}
        </p>
      ))}

      {(creating || editing) && (
        <McpIntegrationFormModal
          integration={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function McpIntegrationFormModal({
  integration,
  onClose,
}: {
  integration: McpIntegration | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(integration?.name ?? "");
  const [type, setType] = useState<IntegrationType>(integration?.type ?? "http_api");
  const [isEnabled, setIsEnabled] = useState(integration?.isEnabled ?? true);
  const [connectionConfigText, setConnectionConfigText] = useState(
    JSON.stringify(integration?.connectionConfig ?? { baseUrl: "" }, null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      let connectionConfig: Record<string, unknown>;
      try {
        connectionConfig = JSON.parse(connectionConfigText);
      } catch {
        throw new Error("connectionConfig geçerli bir JSON olmalı");
      }
      const payload = { name, type, isEnabled, connectionConfig };
      return integration
        ? api.patch(`/admin/mcp-integrations/${integration.id}`, payload)
        : api.post("/admin/mcp-integrations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "mcp-integrations"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title={integration ? "Entegrasyon düzenle" : "Yeni MCP Entegrasyonu"} onClose={onClose}>
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
          <select value={type} onChange={(e) => setType(e.target.value as IntegrationType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bağlantı bilgisi (JSON — http_api için ör. baseUrl, apiKey; "key"/"password"/"secret"/"token" içeren alanlar
          şifreli saklanır)
          <textarea
            value={connectionConfigText}
            onChange={(e) => setConnectionConfigText(e.target.value)}
            rows={6}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} style={{ width: "auto" }} />
          Etkin
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

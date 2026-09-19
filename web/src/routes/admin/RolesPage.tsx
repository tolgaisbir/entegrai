import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { AiProvider, McpIntegration, Role } from "../../api/types";
import { Modal } from "../../components/Modal";

export function RolesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "roles"], queryFn: () => api.get<Role[]>("/admin/roles") });
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [managingPermissions, setManagingPermissions] = useState<Role | null>(null);
  const [managingProviders, setManagingProviders] = useState<Role | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "roles"] }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400) {
        alert("Sistem role'ü silinemez.");
      } else {
        alert("Silinemedi: " + (err instanceof Error ? err.message : "bilinmeyen hata"));
      }
    },
  });

  return (
    <div>
      <div className="admin-toolbar">
        <h2>Role'ler</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Role
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ad</th>
            <th>Açıklama</th>
            <th>MCP İzinleri</th>
            <th>AI Sağlayıcılar</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((role) => (
            <tr key={role.id}>
              <td>
                {role.name} {role.isSystem && <span className="badge">sistem</span>}
              </td>
              <td className="muted">{role.description || "—"}</td>
              <td>{role.mcpPermissions.length}</td>
              <td>{role.aiProviders.length}</td>
              <td className="actions">
                <button onClick={() => setManagingPermissions(role)}>MCP İzinleri</button>
                <button onClick={() => setManagingProviders(role)}>AI Sağlayıcılar</button>
                <button onClick={() => setEditing(role)}>Düzenle</button>
                <button
                  className="danger"
                  disabled={role.isSystem}
                  onClick={() => window.confirm(`"${role.name}" silinsin mi?`) && remove.mutate(role.id)}
                >
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(creating || editing) && (
        <RoleFormModal
          role={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {managingPermissions && (
        <McpPermissionsModal role={managingPermissions} onClose={() => setManagingPermissions(null)} />
      )}
      {managingProviders && (
        <AiProvidersModal role={managingProviders} onClose={() => setManagingProviders(null)} />
      )}
    </div>
  );
}

function RoleFormModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      role
        ? api.patch(`/admin/roles/${role.id}`, { name, description })
        : api.post("/admin/roles", { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title={role ? "Role düzenle" : "Yeni role"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Ad
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={role?.isSystem} />
        </label>
        <label>
          Açıklama
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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

interface PermissionRow {
  mcpIntegrationId: string;
  checked: boolean;
  allowedOperations: string;
  getFilters: string;
}

function McpPermissionsModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const queryClient = useQueryClient();
  const integrationsQuery = useQuery({
    queryKey: ["admin", "mcp-integrations"],
    queryFn: () => api.get<McpIntegration[]>("/admin/mcp-integrations"),
  });
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const integrations = integrationsQuery.data ?? [];
  if (rows === null && integrationsQuery.data) {
    setRows(
      integrations.map((integration) => {
        const existing = role.mcpPermissions.find((p) => p.mcpIntegrationId === integration.id);
        return {
          mcpIntegrationId: integration.id,
          checked: !!existing,
          allowedOperations: existing ? existing.allowedOperations.join(", ") : "get",
          getFilters: JSON.stringify(existing?.getFilters ?? {}),
        };
      }),
    );
  }

  const save = useMutation({
    mutationFn: () => {
      const permissions = (rows ?? [])
        .filter((r) => r.checked)
        .map((r) => {
          let getFilters: Record<string, unknown>;
          try {
            getFilters = JSON.parse(r.getFilters || "{}");
          } catch {
            throw new Error("getFilters geçerli bir JSON olmalı");
          }
          return {
            mcpIntegrationId: r.mcpIntegrationId,
            allowedOperations: r.allowedOperations
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            getFilters,
          };
        });
      return api.put(`/admin/roles/${role.id}/mcp-permissions`, { permissions });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  function updateRow(id: string, patch: Partial<PermissionRow>) {
    setRows((prev) => prev!.map((r) => (r.mcpIntegrationId === id ? { ...r, ...patch } : r)));
  }

  return (
    <Modal title={`"${role.name}" — MCP İzinleri`} onClose={onClose}>
      <div className="form-stack">
        {integrations.length === 0 && <p className="muted">Henüz MCP entegrasyonu yok.</p>}
        {rows?.map((row) => {
          const integration = integrations.find((i) => i.id === row.mcpIntegrationId)!;
          return (
            <div key={row.mcpIntegrationId} className="card" style={{ padding: 12 }}>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => updateRow(row.mcpIntegrationId, { checked: e.target.checked })}
                  style={{ width: "auto" }}
                />
                {integration.name} <span className="muted">({integration.type})</span>
              </label>
              {row.checked && (
                <div className="form-stack" style={{ marginTop: 8 }}>
                  <label>
                    İzinli metodlar (virgülle ayrılmış, ör. get, post)
                    <input
                      value={row.allowedOperations}
                      onChange={(e) => updateRow(row.mcpIntegrationId, { allowedOperations: e.target.value })}
                    />
                  </label>
                  <label>
                    Zorunlu filtreler (JSON)
                    <input
                      value={row.getFilters}
                      onChange={(e) => updateRow(row.mcpIntegrationId, { getFilters: e.target.value })}
                      style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
          <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !rows}>
            Kaydet
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AiProvidersModal({ role, onClose }: { role: Role; onClose: () => void }) {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: ["admin", "ai-providers"],
    queryFn: () => api.get<AiProvider[]>("/admin/ai-providers"),
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (selected === null && providersQuery.data) {
    setSelected(new Set(role.aiProviders.map((g) => g.aiProviderId)));
  }

  const save = useMutation({
    mutationFn: () => api.put(`/admin/roles/${role.id}/ai-providers`, { aiProviderIds: [...(selected ?? [])] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal title={`"${role.name}" — Erişebildiği AI Sağlayıcılar`} onClose={onClose}>
      <div className="checkbox-list">
        {(providersQuery.data ?? []).map((p) => (
          <label key={p.id}>
            <input type="checkbox" checked={selected?.has(p.id) ?? false} onChange={() => toggle(p.id)} />
            {p.name} <span className="muted">({p.providerType})</span>
          </label>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Vazgeç
        </button>
        <button className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Kaydet
        </button>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { Role, Skill, User } from "../../api/types";
import { Modal } from "../../components/Modal";

export function UsersPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<User[]>("/admin/users") });
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<User | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400) {
        alert("Son admin kullanıcısı silinemez.");
      } else {
        alert("Silinemedi: " + (err instanceof Error ? err.message : "bilinmeyen hata"));
      }
    },
  });

  return (
    <div>
      <div className="admin-toolbar">
        <h2>Kullanıcılar</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Kullanıcı
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>E-posta</th>
            <th>Kaynak</th>
            <th>Durum</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(query.data ?? []).map((user) => (
            <tr key={user.id}>
              <td>{user.fullName}</td>
              <td>{user.email}</td>
              <td>{user.authSource}</td>
              <td>
                <span className={`badge ${user.isActive ? "on" : "off"}`}>{user.isActive ? "aktif" : "pasif"}</span>
                {user.mustChangePassword && <span className="badge" style={{ marginLeft: 4 }}>şifre bekliyor</span>}
              </td>
              <td className="actions">
                <button onClick={() => setAssigning(user)}>Skill/Role</button>
                <button onClick={() => setEditing(user)}>Düzenle</button>
                <button
                  className="danger"
                  onClick={() => window.confirm(`"${user.fullName}" silinsin mi?`) && remove.mutate(user.id)}
                >
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(creating || editing) && (
        <UserFormModal
          user={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
      {assigning && <AssignmentsModal user={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function UserFormModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [authSource, setAuthSource] = useState(user?.authSource ?? "local");
  const [password, setPassword] = useState("");
  const [ldapDn, setLdapDn] = useState(user?.ldapDn ?? "");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (user) {
        return api.patch(`/admin/users/${user.id}`, {
          fullName,
          email,
          isActive,
          ldapDn: authSource === "ldap" ? ldapDn : undefined,
          ...(password ? { password } : {}),
        });
      }
      return api.post("/admin/users", {
        fullName,
        email,
        authSource,
        isActive,
        ...(authSource === "local" ? { password } : { ldapDn }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title={user ? "Kullanıcı düzenle" : "Yeni kullanıcı"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Ad Soyad
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
        </label>
        <label>
          E-posta
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        {!user && (
          <label>
            Kimlik kaynağı
            <select value={authSource} onChange={(e) => setAuthSource(e.target.value as "local" | "ldap")}>
              <option value="local">local</option>
              <option value="ldap">ldap</option>
            </select>
          </label>
        )}
        {authSource === "local" ? (
          <label>
            {user ? "Yeni şifre (opsiyonel)" : "Şifre"}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required={!user} />
          </label>
        ) : (
          <label>
            LDAP DN
            <input value={ldapDn} onChange={(e) => setLdapDn(e.target.value)} required />
          </label>
        )}
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: "auto" }} />
          Aktif
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

function AssignmentsModal({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["admin", "users", user.id],
    queryFn: () => api.get<User>(`/admin/users/${user.id}`),
  });
  const skillsQuery = useQuery({ queryKey: ["admin", "skills"], queryFn: () => api.get<Skill[]>("/admin/skills") });
  const rolesQuery = useQuery({ queryKey: ["admin", "roles"], queryFn: () => api.get<Role[]>("/admin/roles") });

  const [selectedSkills, setSelectedSkills] = useState<Set<string> | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (selectedSkills === null && detailQuery.data) {
    setSelectedSkills(new Set((detailQuery.data.skills ?? []).map((s) => s.id)));
  }
  if (selectedRoles === null && detailQuery.data) {
    setSelectedRoles(new Set((detailQuery.data.roles ?? []).map((r) => r.id)));
  }

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/users/${user.id}/skills`, { skillIds: [...(selectedSkills ?? [])] });
      await api.put(`/admin/users/${user.id}/roles`, { roleIds: [...(selectedRoles ?? [])] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 400) {
        setError("Son admin kullanıcısının is_admin rolü kaldırılamaz.");
      } else {
        setError(err instanceof Error ? err.message : "Kaydedilemedi");
      }
    },
  });

  function toggle(set: Set<string> | null, setter: (s: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <Modal title={`"${user.fullName}" — Skill / Role Atamaları`} onClose={onClose}>
      <div className="form-stack">
        <div>
          <h4 style={{ marginBottom: 4 }}>Skill'ler</h4>
          <div className="checkbox-list">
            {(skillsQuery.data ?? []).map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={selectedSkills?.has(s.id) ?? false}
                  onChange={() => toggle(selectedSkills, setSelectedSkills, s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <h4 style={{ marginBottom: 4 }}>Role'ler</h4>
          <div className="checkbox-list">
            {(rolesQuery.data ?? []).map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  checked={selectedRoles?.has(r.id) ?? false}
                  onChange={() => toggle(selectedRoles, setSelectedRoles, r.id)}
                />
                {r.name} {r.isSystem && <span className="muted">(sistem)</span>}
              </label>
            ))}
          </div>
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
      </div>
    </Modal>
  );
}

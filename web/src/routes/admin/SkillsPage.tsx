import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { Skill } from "../../api/types";
import { Modal } from "../../components/Modal";

export function SkillsPage() {
  const queryClient = useQueryClient();
  const skillsQuery = useQuery({ queryKey: ["admin", "skills"], queryFn: () => api.get<Skill[]>("/admin/skills") });
  const [editing, setEditing] = useState<Skill | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/skills/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "skills"] }),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        alert("Bu skill'e ait sohbet/kullanım geçmişi var, silinemez.");
      } else {
        alert("Silinemedi: " + (err instanceof Error ? err.message : "bilinmeyen hata"));
      }
    },
  });

  return (
    <div>
      <div className="admin-toolbar">
        <h2>Skill'ler</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + Yeni Skill
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Ad</th>
            <th>Açıklama</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(skillsQuery.data ?? []).map((skill) => (
            <tr key={skill.id}>
              <td>{skill.name}</td>
              <td className="muted">{skill.description || "—"}</td>
              <td className="actions">
                <button onClick={() => setEditing(skill)}>Düzenle</button>
                <button
                  className="danger"
                  onClick={() => window.confirm(`"${skill.name}" silinsin mi?`) && remove.mutate(skill.id)}
                >
                  Sil
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(creating || editing) && (
        <SkillFormModal
          skill={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SkillFormModal({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      skill
        ? api.patch(`/admin/skills/${skill.id}`, { name, description })
        : api.post("/admin/skills", { name, description }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "skills"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Kaydedilemedi"),
  });

  return (
    <Modal title={skill ? "Skill düzenle" : "Yeni skill"} onClose={onClose}>
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

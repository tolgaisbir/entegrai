import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function ChangePasswordPage() {
  const { refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      await refreshUser();
      navigate("/chat", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Mevcut şifre yanlış.");
      } else if (err instanceof ApiError && err.status === 400) {
        setError("Yeni şifre en az 8 karakter olmalı.");
      } else {
        setError(err instanceof Error ? err.message : "Beklenmeyen bir hata oluştu.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="centered-page">
      <form className="card form-stack" onSubmit={handleSubmit} style={{ minWidth: 320 }}>
        <h2 style={{ margin: 0 }}>Şifre değişikliği zorunlu</h2>
        <p className="muted">İlk girişte güvenlik nedeniyle şifrenizi değiştirmeniz gerekiyor.</p>
        <label>
          Mevcut (geçici) şifre
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Yeni şifre
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Kaydediliyor…" : "Şifreyi değiştir"}
        </button>
        <button type="button" onClick={logout}>
          Çıkış yap
        </button>
      </form>
    </div>
  );
}

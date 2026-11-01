"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.loginAdmin(username, password);
      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login admin gagal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page-container admin-login-container">
      <section className="glass-card admin-login-card">
        <span className="badge badge-primary">Area terbatas</span>
        <h1 style={{ marginTop: "12px" }}>Login Admin</h1>
        <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>
          Masuk untuk membuka dashboard laporan dan scanner panitia.
        </p>
        <form onSubmit={handleSubmit} className="admin-login-form">
          <label>
            Username
            <input
              autoComplete="username"
              name="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p className="admin-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn-primary" disabled={submitting} type="submit">
            {submitting ? "Memeriksa..." : "Masuk"}
          </button>
        </form>
      </section>
    </main>
  );
}

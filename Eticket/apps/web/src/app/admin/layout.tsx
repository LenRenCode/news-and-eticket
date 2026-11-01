"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/admin/login";
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }

    let active = true;
    api
      .getAdminSession()
      .then(() => {
        if (active) setAuthorized(true);
      })
      .catch((err: Error) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/admin/login");
        } else {
          setError(err.message);
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [isLoginPage, pathname, router]);

  if (isLoginPage) return children;

  const logout = async () => {
    setError("");
    try {
      await api.logoutAdmin();
      router.replace("/admin/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal keluar dari admin");
    }
  };

  if (checking) {
    return <main className="page-container">Memeriksa sesi admin...</main>;
  }

  if (!authorized) {
    return (
      <main className="page-container">
        {error ? (
          <div className="glass-card" role="alert">
            Gagal memeriksa sesi admin: {error}. Pastikan API dan konfigurasi
            admin sudah aktif, lalu muat ulang halaman.
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <>
      <nav className="admin-nav no-print" aria-label="Navigasi admin">
        <Link href="/admin" className="nav-link-btn">
          Dashboard & Laporan
        </Link>
        <Link href="/admin/scanner" className="nav-link-btn">
          Scanner Gate
        </Link>
        <button type="button" className="nav-link-btn admin-logout" onClick={logout}>
          Keluar
        </button>
      </nav>
      {error ? (
        <p className="admin-error page-container" role="alert">
          {error}
        </p>
      ) : null}
      {children}
    </>
  );
}

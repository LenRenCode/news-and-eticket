/**
 * Mode Aplikasi: demo vs production
 * - demo: database in-memory & QRIS simulasi diizinkan, cookie tidak Secure, endpoint simulasi aktif.
 * - production: PostgreSQL & Midtrans asli wajib, cookie Secure (saat HTTPS), simulasi mati (404), fail-closed.
 */
export function isProductionMode(): boolean {
  const mode = process.env.APP_MODE?.toLowerCase();
  if (process.env.NODE_ENV === "production" || mode === "production") {
    return true;
  }
  if (mode === "demo") return false;
  return process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test";
}

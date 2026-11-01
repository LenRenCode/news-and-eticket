import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const cookieName = "eticket_admin_session";

/**
 * Verifikasi signature token sesi HMAC-SHA256 menggunakan Web Crypto API.
 * Token berformat: ${expiresAt}.${nonce}.${signature}
 */
async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expiresText, nonce, signature] = parts;
  const expiresAt = Number(expiresText);

  // Periksa kedaluwarsa waktu
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  // Format validasi hex 64-karakter (256-bit)
  if (!/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
    return false;
  }

  const payload = `${expiresText}.${nonce}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const sigBytes = new Uint8Array(
    signature.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  return await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    enc.encode(payload)
  );
}

function getLoginRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(
    new URL("/tiket/admin/login", request.nextUrl.origin)
  );
}

function getProtectedAdminPath(pathname: string): string | null {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    decodedPath = pathname;
  }

  let normalizedPath = decodedPath.replace(/\/{2,}/g, "/").toLowerCase();
  const dataRoute = normalizedPath.match(/^\/_next\/data\/[^/]+\/(.+)\.json$/);
  if (dataRoute) normalizedPath = `/${dataRoute[1]}`;

  return normalizedPath === "/admin" || normalizedPath.startsWith("/admin/")
    ? normalizedPath
    : null;
}

export async function middleware(request: NextRequest) {
  const adminPath = getProtectedAdminPath(request.nextUrl.pathname);

  // Lindungi seluruh halaman /admin/* di sisi server kecuali halaman login
  if (
    adminPath &&
    adminPath !== "/admin/login" &&
    adminPath !== "/admin/login/"
  ) {
    const sessionCookie = request.cookies.get(cookieName)?.value;
    const secret = process.env.ADMIN_SESSION_SECRET;

    if (!sessionCookie || !secret || secret.length < 32) {
      return getLoginRedirect(request);
    }

    try {
      const valid = await verifySessionToken(sessionCookie, secret);
      if (!valid) {
        return getLoginRedirect(request);
      }
    } catch {
      return getLoginRedirect(request);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};

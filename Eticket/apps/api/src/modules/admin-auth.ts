import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProductionMode } from "./app-mode";

const cookieName = "eticket_admin_session";
const sessionDurationMs = 8 * 60 * 60 * 1000;

function secret(): string | undefined {
  const value = process.env.ADMIN_SESSION_SECRET;
  return value && value.length >= 32 ? value : undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionSignature(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

function cookieOptions(req?: Request): string {
  const isProd = isProductionMode();
  const isHttps = req
    ? req.secure || req.get("x-forwarded-proto") === "https"
    : false;
  const secure = isProd && isHttps ? "; Secure" : "";
  return `; HttpOnly; Path=/; SameSite=Lax${secure}`;
}

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    const configuredOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    const allowed = [
      new URL(configuredOrigin).origin,
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
    if (!allowed.includes(origin)) {
      res.status(403).json({ success: false, error: "Origin tidak diizinkan" });
      return;
    }
    next();
  } catch {
    res.status(503).json({
      success: false,
      error: "Konfigurasi WEB_ORIGIN tidak valid",
    });
  }
}

export function issueAdminSession(req: Request, res: Response): void {
  const key = secret();
  if (!key) {
    res.status(503).json({
      success: false,
      error: "ADMIN_SESSION_SECRET wajib diisi minimal 32 karakter",
    });
    return;
  }

  const expiresAt = Date.now() + sessionDurationMs;
  const payload = `${expiresAt}.${randomBytes(32).toString("hex")}`;
  const value = `${payload}.${sessionSignature(payload, key)}`;
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${value}; Max-Age=${sessionDurationMs / 1000}${cookieOptions(req)}`
  );
  res.json({ success: true });
}

export function clearAdminSession(req: Request, res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; Max-Age=0${cookieOptions(req)}`
  );
  res.json({ success: true });
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = secret();
  if (!key) {
    res.status(503).json({
      success: false,
      error: "ADMIN_SESSION_SECRET wajib diisi minimal 32 karakter",
    });
    return;
  }

  const cookie = req
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  const parts = token?.split(".");

  if (parts?.length === 3) {
    const [expiresText, nonce, signature] = parts;
    const expiresAt = Number(expiresText);
    const payload = `${expiresText}.${nonce}`;
    const expected = sessionSignature(payload, key);
    if (
      Number.isSafeInteger(expiresAt) &&
      expiresAt > Date.now() &&
      /^[a-f0-9]{64}$/.test(nonce) &&
      /^[a-f0-9]{64}$/.test(signature) &&
      safeEqual(signature, expected)
    ) {
      next();
      return;
    }
  }

  res.status(401).json({ success: false, error: "Silakan login sebagai admin" });
}

export function verifyAdminCredentials(
  username: unknown,
  password: unknown
): boolean | null {
  const configuredUsername = process.env.ADMIN_USERNAME;
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredUsername || !configuredPassword || !secret()) return null;
  if (typeof username !== "string" || typeof password !== "string") {
    return false;
  }
  const usernameMatches = safeEqual(username, configuredUsername);
  const passwordMatches = safeEqual(password, configuredPassword);
  return usernameMatches && passwordMatches;
}

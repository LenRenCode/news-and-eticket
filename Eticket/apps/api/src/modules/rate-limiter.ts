import type { Request, Response, NextFunction } from "express";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const clients = new Map<string, ClientRecord>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of clients.entries()) {
      if (now > record.resetTime) {
        clients.delete(ip);
      }
    }
  }, options.windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let record = clients.get(ip);
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      clients.set(ip, record);
      next();
      return;
    }

    record.count++;
    if (record.count > options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: options.message,
      });
      return;
    }

    next();
  };
}

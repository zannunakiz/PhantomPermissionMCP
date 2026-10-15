import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId } from '../errors/request-id';

export type SecurityConfig = {
  nodeEnv: string;
  corsOrigins: readonly string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
};

export function securityHeaders(nodeEnv: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    if (nodeEnv === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  };
}

export function strictCors(allowed: readonly string[]) {
  const set = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && set.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Idempotency-Key, If-Match, x-request-id',
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

export function fixedWindowRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown';
    const now = Date.now();
    const window = hits.get(key) ?? [];
    const fresh = window.filter((t) => now - t < windowMs);
    if (fresh.length >= max) {
      const retryAfter = Math.ceil((fresh[0] + windowMs - now) / 1000);
      const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many requests.',
          status: 429,
          details: [],
          requestId,
        },
      });
      return;
    }
    fresh.push(now);
    hits.set(key, fresh);
    next();
  };
}

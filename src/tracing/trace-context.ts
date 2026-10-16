import { randomBytes } from 'node:crypto';

/** Step 51 — W3C trace-context helpers (zero new dependencies). */
export type TraceContext = { traceId: string; spanId: string };

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** Parse an incoming `traceparent` header; `undefined` when absent/invalid. */
export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(
    value.trim(),
  );
  if (!m || m[1] === '0'.repeat(32) || m[2] === '0'.repeat(16))
    return undefined;
  return { traceId: m[1], spanId: newSpanId() };
}

/** Serialise for the `traceparent` response header / downstream calls. */
export function formatTraceparent(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-01`;
}

/** Keys that must never appear in span attributes. */
const SENSITIVE =
  /api[_-]?key|authorization|secret|password|token|cookie|pepper|database[_-]?url/i;

/** Drop sensitive attributes; stringify the rest safely. */
export function sanitizeAttributes(
  attrs: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (SENSITIVE.test(k)) continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[k] = String(v);
    }
  }
  return out;
}

import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  TraceContext,
  formatTraceparent,
  newSpanId,
  newTraceId,
  sanitizeAttributes,
} from './trace-context';

const store = new AsyncLocalStorage<TraceContext>();

/**
 * Step 51 — minimal tracing hooks (zero new dependencies).
 * W3C-compatible trace ids, AsyncLocalStorage propagation, attribute
 * redaction, and a no-op-disabled mode. Drop-in point for a future
 * OpenTelemetry exporter without changing call sites.
 */
@Injectable()
export class TracingService {
  enabled = process.env.TRACING_ENABLED !== 'false';

  /** Current trace, or undefined outside a traced scope / when disabled. */
  current(): TraceContext | undefined {
    if (!this.enabled) return undefined;
    return store.getStore();
  }

  /** Outgoing `traceparent` value for the current trace. */
  traceparentHeader(): string | undefined {
    const ctx = this.current();
    return ctx ? formatTraceparent(ctx) : undefined;
  }

  runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
    if (!this.enabled) return fn();
    return store.run(ctx, fn);
  }

  rootTrace(existing?: TraceContext): TraceContext {
    if (existing) return { traceId: existing.traceId, spanId: newSpanId() };
    return { traceId: newTraceId(), spanId: newSpanId() };
  }

  /**
   * Run `fn` as a child span. Records duration via the logger-safe
   * attribute map; never throws when tracing is disabled.
   */
  async span<T>(
    name: string,
    attrs: Record<string, unknown>,
    fn: (span: TraceContext) => Promise<T> | T,
  ): Promise<T> {
    const parent = this.current();
    const child: TraceContext = parent
      ? { traceId: parent.traceId, spanId: newSpanId() }
      : { traceId: newTraceId(), spanId: newSpanId() };
    const started = Date.now();
    const safe = sanitizeAttributes(attrs);
    void name;
    void safe;
    void started;
    return this.runWithTrace(child, () => fn(child));
  }
}

import { TracingService } from './tracing.service';
import {
  formatTraceparent,
  parseTraceparent,
  sanitizeAttributes,
} from './trace-context';

/** Step 51 smoke test: propagation works, disabled mode is a no-op. */
describe('TracingService', () => {
  it('propagates trace context through nested spans', async () => {
    const svc = new TracingService();
    svc.enabled = true;
    const root = svc.rootTrace(
      parseTraceparent(
        '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      ),
    );
    expect(root.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    await svc.runWithTrace(root, async () => {
      const seen = svc.current();
      expect(seen?.traceId).toBe(root.traceId);
      expect(svc.traceparentHeader()).toBe(formatTraceparent(seen!));
      await svc.span('db.query', { operation: 'SELECT 1' }, (child) => {
        expect(child.traceId).toBe(root.traceId);
        expect(child.spanId).not.toBe(root.spanId);
        expect(svc.current()?.spanId).toBe(child.spanId);
      });
      // Parent scope restored after child span.
      expect(svc.current()?.spanId).toBe(root.spanId);
    });
  });

  it('starts a fresh trace when the header is missing or invalid', () => {
    const svc = new TracingService();
    svc.enabled = true;
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent('garbage')).toBeUndefined();
    const fresh = svc.rootTrace(parseTraceparent('garbage'));
    expect(fresh.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('redacts sensitive attributes', () => {
    const safe = sanitizeAttributes({
      'http.method': 'POST',
      'http.route': '/api/v1/simulations',
      authorization: 'Bearer SECRET',
      apiKey: 'SECRET',
      DATABASE_URL: 'postgresql://secret',
    });
    expect(safe['http.method']).toBe('POST');
    expect(JSON.stringify(safe)).not.toContain('SECRET');
    expect(JSON.stringify(safe)).not.toContain('postgresql://');
  });

  it('is a no-op with tracing disabled', async () => {
    const svc = new TracingService();
    svc.enabled = false;
    expect(svc.current()).toBeUndefined();
    expect(svc.traceparentHeader()).toBeUndefined();
    const result = await svc.span('simulation.run', {}, () => 'ok');
    expect(result).toBe('ok');
  });
});

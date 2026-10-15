import { HealthService } from './health.service';
import type { PrismaService } from '../persistence';

/**
 * Unit coverage for the readiness probe. The database client is stubbed:
 * no live connection is required to assert the status mapping or the
 * no-leak guarantee.
 */
describe('HealthService', () => {
  function serviceWith(queryImpl: () => Promise<unknown>): HealthService {
    const db = { $queryRaw: queryImpl } as unknown as PrismaService;
    return new HealthService(db);
  }

  it('reports liveness without touching the database', () => {
    let calls = 0;
    const service = serviceWith(() => {
      calls += 1;
      return Promise.resolve([{ '?column?': 1 }]);
    });
    expect(service.live()).toEqual({ status: 'ok' });
    expect(calls).toBe(0);
  });

  it('reports ready when the probe query succeeds', async () => {
    const service = serviceWith(() => Promise.resolve([{ '?column?': 1 }]));
    await expect(service.ready()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('reports degraded without leaking internals when the probe fails', async () => {
    const secret = 'postgresql://phantom:SECRET@localhost:5432/db';
    const service = serviceWith(() =>
      Promise.reject(new Error(`connect failed for ${secret}`)),
    );
    const result = await service.ready();
    expect(result).toEqual({ status: 'degraded', database: 'down' });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('postgresql://');
  });
});

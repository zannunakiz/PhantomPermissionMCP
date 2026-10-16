import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../app.module';
import { setupSwagger } from './swagger';

/**
 * Step 38 validation gate: OpenAPI generates; every public route is
 * represented; docs carry auth/scopes/errors/pagination/idempotency/
 * concurrency/examples and no secrets.
 */
describe('openapi (step 38)', () => {
  it('generates a complete, secret-free document from controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('APP_CONFIG')
      .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const outFile = join(__dirname, '..', '..', 'docs', 'openapi.json');
    setupSwagger(app, outFile);
    await app.close();

    const doc = JSON.parse(readFileSync(outFile, 'utf8')) as {
      openapi: string;
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.openapi.startsWith('3.')).toBe(true);

    // All public endpoints from the v1 contract + health probes.
    const routes = Object.entries(doc.paths).flatMap(([p, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
    );
    for (const expected of [
      'POST /api/v1/models',
      'GET /api/v1/models',
      'GET /api/v1/models/{id}',
      'POST /api/v1/models/{id}/versions',
      'POST /api/v1/simulations',
      'GET /api/v1/simulations/{id}',
      'GET /api/v1/simulations/{id}/report',
      'GET /api/v1/simulations/{id}/export',
      'GET /api/v1/audit-events',
      'GET /health/live',
      'GET /health/ready',
    ]) {
      expect(routes).toContain(expected);
    }

    // Doc header covers auth, scopes, errors, pagination, idempotency,
    // concurrency, and examples; error paths use the standard envelope.
    const desc = doc.info.description;
    for (const needle of [
      'Authorization: Bearer',
      'models:read',
      'simulations:run',
      'audit:read',
      'validation_failed',
      'conflict_version',
      'idempotency_conflict',
      'page',
      'Idempotency-Key',
      'If-Match',
      'POST /api/v1/models',
    ]) {
      expect(desc).toContain(needle);
    }
    expect(JSON.stringify(doc)).not.toMatch(/ppk_[A-Za-z0-9]/);
  });
});

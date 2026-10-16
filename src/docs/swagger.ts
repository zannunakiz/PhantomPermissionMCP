import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { ERROR_CODES } from '../common/errors/error-codes';
import { SCOPES } from '../auth/scopes';

/**
 * Step 38 — Swagger/OpenAPI generated from actual controllers/DTOs.
 * Global doc header carries auth, scopes, error envelope, pagination,
 * idempotency + concurrency preconditions, and examples. Controllers add
 * lightweight Api* tags; no secrets are documented.
 */
export function setupSwagger(app: INestApplication, outFile?: string): void {
  const config = new DocumentBuilder()
    .setTitle('PhantomPermissionMCP')
    .setDescription(
      [
        'Read-only RBAC change-impact analysis backend. Base path: `/api/v1` (health: `/health`).',
        '',
        'Auth: `Authorization: Bearer ppk_<secret>` — API keys are shown once at issuance; only digests are persisted. Never send real keys to docs tooling.',
        `Scopes: ${SCOPES.join(', ')}. Missing auth → 401 \`unauthorized\`; wrong scope → 403 \`forbidden_scope\`; cross-tenant access → 403 \`tenant_forbidden\`.`,
        '',
        `Error envelope: \`{ error: { code, message, requestId } }\`. Stable codes: ${ERROR_CODES.join(', ')}.`,
        '',
        'Pagination: `?page>=1&limit=1..100` (+ resource `orderBy`/`order` where offered); stable ordering, bounded limits; invalid params → 400 `validation_failed`.',
        '',
        'Idempotency: `POST /api/v1/simulations` accepts optional `Idempotency-Key`; replays return the original result; mismatched payload → 409 `idempotency_conflict`.',
        '',
        'Concurrency: `POST /api/v1/models/:id/versions` accepts optional `If-Match: <version>`; stale writes → 409 `conflict_version`; snapshots are never updated in place.',
        '',
        'Examples: create model → `POST /api/v1/models {"name":"acme-prod","content":{...}}` → 201 with model id + version 1. Simulate → `POST /api/v1/simulations {"modelId":"...","operations":[...]}` → 201 with simulation id + impact summary.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'API key (`ppk_…`).' },
      'api-key',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'PhantomPermissionMCP API',
  });
  if (outFile) {
    writeFileSync(outFile, JSON.stringify(document, null, 2));
  }
}

import type { IdempotencyRecordData, JsonValue } from './records';

/**
 * Retry-safety port. `create` surfaces a conflict error carrying the
 * unique-constraint cause when the same (tenant, endpoint, key) already
 * exists — the use case then compares `requestHash` to decide replay
 * vs `idempotency_conflict`.
 */
export interface IdempotencyRepository {
  findByKey(
    tenantId: string,
    endpoint: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecordData | null>;
  create(input: {
    id: string;
    tenantId: string;
    endpoint: string;
    idempotencyKey: string;
    requestHash: string;
    statusCode: number;
    responseBody: JsonValue;
    expiresAt: Date;
  }): Promise<IdempotencyRecordData>;
  deleteExpired(now?: Date): Promise<number>;
}

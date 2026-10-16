import { AppError } from '../common/errors/app-error';
import { DomainError } from '../domain/errors';
import { assertAcyclicInheritance } from '../domain/inheritance-cycles';
import { parseAccessModelDocument } from '../domain/schemas';
import { assertValidStructure } from '../domain/validate-structure';
import type { AccessModelSnapshot } from '../domain/access-model';

/**
 * Step 41 — shared access-model validator (same as REST).
 * Parses, structurally validates, and cycle-checks a raw snapshot.
 * Throws `AppError('validation_failed', …)` with `{ path, reason }`
 * findings — never echoed input values.
 */
export function validateSnapshot(raw: unknown): AccessModelSnapshot {
  try {
    const doc = parseAccessModelDocument({ schemaVersion: 1, snapshot: raw });
    const snapshot = doc.snapshot as unknown as AccessModelSnapshot;
    assertValidStructure(snapshot);
    assertAcyclicInheritance(snapshot);
    return snapshot;
  } catch (err) {
    if (err instanceof DomainError) {
      throw new AppError('validation_failed', 'Access model is invalid.', {
        details: err.details.map((d) => ({ ...d })),
      });
    }
    throw err;
  }
}

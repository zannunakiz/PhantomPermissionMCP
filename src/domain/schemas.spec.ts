/**
 * Step 09 runtime-schema coverage.
 *
 * Gate matrix: valid examples, malformed fields, missing fields,
 * duplicate ids, oversized fields/collections, unknown keys, operation
 * names, and explicit schema-version checks. Asserts failures throw
 * DomainError with safe details (no echoed values).
 */
import { DomainError } from './errors';
import {
  parseAccessModelDocument,
  parseProposedChangeDocument,
} from './schemas';

function modelDoc(overrides: unknown = {}) {
  const base = {
    schemaVersion: 1,
    snapshot: {
      roles: [{ id: 'role_admin', name: 'admin' }],
      permissions: [{ id: 'perm_read', value: 'invoice:read' }],
      bindings: [{ roleId: 'role_admin', permissionId: 'perm_read' }],
      inheritance: [],
      assignments: [{ subjectId: 'subj_ana', roleId: 'role_admin' }],
      subjects: [{ id: 'subj_ana', displayName: 'Ana' }],
    },
  };
  return { ...base, ...(overrides as Record<string, unknown>) };
}

function changeDoc(overrides: unknown = {}) {
  const base = {
    schemaVersion: 1,
    modelId: 'mdl_01JABC',
    operations: [
      {
        type: 'grant_permission',
        roleId: 'role_admin',
        permissionId: 'perm_read',
      },
    ],
  };
  return { ...base, ...(overrides as Record<string, unknown>) };
}

function domainErrorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainError);
    return error as DomainError;
  }
  throw new Error('Expected DomainError');
}

describe('runtime schemas (Step 09)', () => {
  it('accepts a valid model and change document', () => {
    expect(parseAccessModelDocument(modelDoc()).schemaVersion).toBe(1);
    const change = parseProposedChangeDocument(changeDoc());
    expect(change.operations).toHaveLength(1);
  });

  it('rejects malformed primitive types', () => {
    const err = domainErrorOf(() =>
      parseProposedChangeDocument(changeDoc({ version: '3' })),
    );
    expect(err.details[0]?.path).toBe('version');
  });

  it('rejects missing required fields', () => {
    const doc = modelDoc() as Record<string, unknown>;
    const snap = doc.snapshot as Record<string, unknown>;
    snap.roles = [{ id: 'role_admin' }];
    const err = domainErrorOf(() => parseAccessModelDocument(doc));
    expect(
      err.details.some((detail) => detail.path === 'snapshot.roles[0].name'),
    ).toBe(true);
  });

  it('rejects duplicate ids within one array', () => {
    const doc = modelDoc() as Record<string, unknown>;
    const snap = doc.snapshot as Record<string, unknown>;
    snap.roles = [
      { id: 'role_admin', name: 'admin' },
      { id: 'role_admin', name: 'admin2' },
    ];
    const err = domainErrorOf(() => parseAccessModelDocument(doc));
    expect(err.code).toBe('duplicate_entity');
  });

  it('rejects oversized collections and strings', () => {
    const bigRoles = Array.from({ length: 501 }, (_, i) => ({
      id: `role_${i}`,
      name: `role-${i}`,
    }));
    const doc = modelDoc() as Record<string, unknown>;
    const snap = doc.snapshot as Record<string, unknown>;
    snap.roles = bigRoles;
    const limitErr = domainErrorOf(() => parseAccessModelDocument(doc));
    expect(limitErr.code).toBe('limit_exceeded');

    const longName = modelDoc() as Record<string, unknown>;
    const longSnap = longName.snapshot as Record<string, unknown>;
    longSnap.roles = [{ id: 'role_admin', name: 'x'.repeat(101) }];
    const lenErr = domainErrorOf(() => parseAccessModelDocument(longName));
    expect(lenErr.details[0]?.reason).toBe('too_large');
  });

  it('rejects unknown keys and bad operation names', () => {
    const withExtra = modelDoc({ extra: true });
    const unknownErr = domainErrorOf(() => parseAccessModelDocument(withExtra));
    expect(
      unknownErr.details.some((detail) => detail.reason === 'unknown_property'),
    ).toBe(true);

    const badOp = changeDoc({
      operations: [{ type: 'explode_everything' }],
    });
    const opErr = domainErrorOf(() => parseProposedChangeDocument(badOp));
    expect(opErr.code).toBe('unsupported_operation');
  });

  it('checks schema version explicitly', () => {
    const missing = modelDoc() as Record<string, unknown>;
    delete missing.schemaVersion;
    expect(domainErrorOf(() => parseAccessModelDocument(missing)).code).toBe(
      'invalid_identifier',
    );
    const wrong = modelDoc({ schemaVersion: 2 });
    expect(domainErrorOf(() => parseAccessModelDocument(wrong)).code).toBe(
      'invalid_identifier',
    );
    const wrongChange = changeDoc({ schemaVersion: 0 });
    const err = domainErrorOf(() => parseProposedChangeDocument(wrongChange));
    expect(err.details[0]?.path).toBe('schemaVersion');
  });

  it('never echoes input values in details', () => {
    const secret = 'ppk_live-should-not-appear';
    const err = domainErrorOf(() =>
      parseProposedChangeDocument(changeDoc({ modelId: secret })),
    );
    expect(JSON.stringify(err.details)).not.toContain(secret);
  });
});

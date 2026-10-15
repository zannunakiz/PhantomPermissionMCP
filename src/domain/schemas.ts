/**
 * Runtime schemas for imported models and simulations (Step 09).
 *
 * Syntactic validation only: required fields, primitive types, unknown
 * keys, string lengths, collection limits, operation names, and schema
 * version. Uses the repository's validation library (Zod) consistently.
 *
 * Step 09 / Step 10 boundary: this file checks shapes, lengths, limits,
 * duplicate `id` strings within one array, and `type` discriminators.
 * Cross-array semantics (dangling role/permission/subject references,
 * duplicate names/values/bindings/edges, inheritance cycles) belong to
 * Step 10+ and are intentionally not checked here.
 *
 * Failures throw {@link DomainError} with safe field-level `details[]`
 * (`{ path, reason }` only — never echoed input values) so adapters can
 * map them to the shared REST/MCP contract codes at the boundary.
 */
import { z } from 'zod';
import { DOMAIN_LIMITS } from './limits';
import { DomainError } from './errors';
import type { DomainErrorDetail } from './errors';

/** Current document envelope version. Checked explicitly on every parse. */
export const SCHEMA_VERSION = 1 as const;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;
const MODEL_ID_PATTERN = /^mdl_[A-Za-z0-9_-]{1,120}$/;
const PERMISSION_VALUE_PATTERN = /^[A-Za-z0-9:._/*-]{1,200}$/;

const opaqueId = (path: string) =>
  z
    .string({ error: `${path}: expected a string` })
    .min(1, `${path}: required`)
    .max(128, `${path}: too long`)
    .regex(OPAQUE_ID_PATTERN, `${path}: invalid identifier`);

const modelIdSchema = z
  .string({ error: 'modelId: expected a string' })
  .regex(MODEL_ID_PATTERN, 'modelId: invalid model id');

const roleSchema = z
  .object({
    id: opaqueId('roles[].id'),
    name: z
      .string({ error: 'roles[].name: expected a string' })
      .min(1, 'roles[].name: required')
      .max(100, 'roles[].name: too long'),
    description: z
      .string({ error: 'roles[].description: expected a string' })
      .max(500, 'roles[].description: too long')
      .optional(),
  })
  .strict();

const permissionSchema = z
  .object({
    id: opaqueId('permissions[].id'),
    value: z
      .string({ error: 'permissions[].value: expected a string' })
      .min(1, 'permissions[].value: required')
      .max(200, 'permissions[].value: too long')
      .regex(PERMISSION_VALUE_PATTERN, 'permissions[].value: invalid value'),
  })
  .strict();

const bindingSchema = z
  .object({
    roleId: opaqueId('bindings[].roleId'),
    permissionId: opaqueId('bindings[].permissionId'),
  })
  .strict();

const inheritanceEdgeSchema = z
  .object({
    childRoleId: opaqueId('inheritance[].childRoleId'),
    parentRoleId: opaqueId('inheritance[].parentRoleId'),
  })
  .strict();

const assignmentSchema = z
  .object({
    subjectId: opaqueId('assignments[].subjectId'),
    roleId: opaqueId('assignments[].roleId'),
  })
  .strict();

const subjectSchema = z
  .object({
    id: opaqueId('subjects[].id'),
    displayName: z
      .string({ error: 'subjects[].displayName: expected a string' })
      .min(1, 'subjects[].displayName: required')
      .max(100, 'subjects[].displayName: too long')
      .optional(),
  })
  .strict();

/** Reject duplicate `id` strings within one entity array (syntactic). */
function uniqueIds<T extends { id: string }>(collection: string) {
  return (items: readonly T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [collection, index, 'id'],
          message: `${collection}[${index}].id: duplicate`,
        });
      } else {
        seen.add(item.id);
      }
    });
  };
}

const accessModelSnapshotSchema = z
  .object({
    roles: z
      .array(roleSchema)
      .max(DOMAIN_LIMITS.maxRoles, 'roles: too many')
      .superRefine(uniqueIds('roles')),
    permissions: z
      .array(permissionSchema)
      .max(DOMAIN_LIMITS.maxPermissions, 'permissions: too many')
      .superRefine(uniqueIds('permissions')),
    bindings: z
      .array(bindingSchema)
      .max(DOMAIN_LIMITS.maxBindings, 'bindings: too many'),
    inheritance: z
      .array(inheritanceEdgeSchema)
      .max(DOMAIN_LIMITS.maxInheritanceEdges, 'inheritance: too many'),
    assignments: z
      .array(assignmentSchema)
      .max(DOMAIN_LIMITS.maxAssignments, 'assignments: too many'),
    subjects: z
      .array(subjectSchema)
      .max(DOMAIN_LIMITS.maxSubjects, 'subjects: too many')
      .superRefine(uniqueIds('subjects')),
  })
  .strict();

export const accessModelDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION, 'schemaVersion: bad version'),
    snapshot: accessModelSnapshotSchema,
  })
  .strict();

const grantPermissionSchema = z
  .object({
    type: z.literal('grant_permission'),
    roleId: opaqueId('operations[].roleId'),
    permissionId: opaqueId('operations[].permissionId'),
  })
  .strict();

const revokePermissionSchema = z
  .object({
    type: z.literal('revoke_permission'),
    roleId: opaqueId('operations[].roleId'),
    permissionId: opaqueId('operations[].permissionId'),
  })
  .strict();

const assignRoleSchema = z
  .object({
    type: z.literal('assign_role'),
    subjectId: opaqueId('operations[].subjectId'),
    roleId: opaqueId('operations[].roleId'),
  })
  .strict();

const unassignRoleSchema = z
  .object({
    type: z.literal('unassign_role'),
    subjectId: opaqueId('operations[].subjectId'),
    roleId: opaqueId('operations[].roleId'),
  })
  .strict();

const addInheritanceSchema = z
  .object({
    type: z.literal('add_inheritance'),
    childRoleId: opaqueId('operations[].childRoleId'),
    parentRoleId: opaqueId('operations[].parentRoleId'),
  })
  .strict();

const removeInheritanceSchema = z
  .object({
    type: z.literal('remove_inheritance'),
    childRoleId: opaqueId('operations[].childRoleId'),
    parentRoleId: opaqueId('operations[].parentRoleId'),
  })
  .strict();

const changeOperationSchema = z.discriminatedUnion('type', [
  grantPermissionSchema,
  revokePermissionSchema,
  assignRoleSchema,
  unassignRoleSchema,
  addInheritanceSchema,
  removeInheritanceSchema,
]);

export const proposedChangeDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION, 'schemaVersion: bad version'),
    modelId: modelIdSchema,
    version: z
      .number({ error: 'version: expected a number' })
      .int('version: expected an integer')
      .min(1, 'version: out of range')
      .optional(),
    operations: z
      .array(changeOperationSchema)
      .min(1, 'operations: required')
      .max(DOMAIN_LIMITS.maxOperationsPerSimulation, 'operations: too many'),
    idempotencyKey: z
      .string({ error: 'idempotencyKey: expected a string' })
      .min(1, 'idempotencyKey: required')
      .max(128, 'idempotencyKey: too long')
      .optional(),
  })
  .strict();

export type AccessModelDocument = z.infer<typeof accessModelDocumentSchema>;
export type ProposedChangeDocument = z.infer<
  typeof proposedChangeDocumentSchema
>;

type ZodIssueLike = {
  code: string;
  path: Array<string | number>;
  expected?: unknown;
  keys?: unknown;
};

function formatSchemaPath(path: Array<string | number>): string {
  if (path.length === 0) {
    return '(body)';
  }
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (out.length === 0) {
      out += segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out.length === 0 ? '(body)' : out;
}

function reasonForIssue(issue: ZodIssueLike): string {
  if (issue.code === 'unrecognized_keys') {
    return 'unknown_property';
  }
  if (issue.code === 'invalid_type') {
    return typeof issue.expected === 'string' && issue.expected.length > 0
      ? `expected_${issue.expected}`
      : 'invalid_type';
  }
  if (issue.code === 'too_big') {
    return 'too_large';
  }
  if (issue.code === 'too_small') {
    return 'too_short';
  }
  if (issue.code === 'invalid_format') {
    return 'invalid_format';
  }
  if (issue.code === 'custom') {
    return 'duplicate';
  }
  if (issue.code === 'invalid_literal') {
    return 'invalid_value';
  }
  if (issue.code === 'invalid_union') {
    return 'unsupported_operation';
  }
  return issue.code;
}

function toDomainDetails(issues: ZodIssueLike[]): DomainErrorDetail[] {
  const details: DomainErrorDetail[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      const base = formatSchemaPath(issue.path);
      for (const key of issue.keys) {
        if (typeof key !== 'string' || key.length === 0) {
          continue;
        }
        details.push({
          path: base === '(body)' ? key : `${base}.${key}`,
          reason: 'unknown_property',
        });
      }
      continue;
    }
    if (issue.code === 'invalid_union') {
      details.push({
        path: formatSchemaPath([...issue.path, 'type']),
        reason: 'unsupported_operation',
      });
      continue;
    }
    details.push({
      path: formatSchemaPath(issue.path),
      reason: reasonForIssue(issue),
    });
  }
  return details;
}

function errorCodeFor(details: DomainErrorDetail[]): DomainError['code'] {
  if (details.some((detail) => detail.path.startsWith('schemaVersion'))) {
    return 'invalid_identifier';
  }
  if (details.some((detail) => detail.reason === 'too_large')) {
    return 'limit_exceeded';
  }
  if (details.some((detail) => detail.reason === 'duplicate')) {
    return 'duplicate_entity';
  }
  if (details.some((detail) => detail.reason === 'unsupported_operation')) {
    return 'unsupported_operation';
  }
  return 'invalid_identifier';
}

function toDomainError(issues: ZodIssueLike[], message: string): DomainError {
  const details = toDomainDetails(issues);
  return new DomainError(errorCodeFor(details), message, { details });
}

export function parseAccessModelDocument(value: unknown): AccessModelDocument {
  const parsed = accessModelDocumentSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw toDomainError(
    (parsed.error.issues ?? []) as unknown as ZodIssueLike[],
    'Access model document is invalid',
  );
}

export function parseProposedChangeDocument(
  value: unknown,
): ProposedChangeDocument {
  const parsed = proposedChangeDocumentSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw toDomainError(
    (parsed.error.issues ?? []) as unknown as ZodIssueLike[],
    'Proposed change request is invalid',
  );
}

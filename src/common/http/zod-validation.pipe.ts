/**
 * Strict transport-input validation pipe (Step 07).
 *
 * Transport boundary only: validates HTTP body/query/params shapes
 * (presence, primitive types, unknown keys) and never encodes domain
 * rules (role graphs, operation preconditions, …). Domain validation
 * lives in later steps against already-parsed DTOs.
 *
 * Rules:
 * - Schemas must be strict (`.strict()`) so unknown properties are
 *   rejected instead of silently stripped.
 * - No implicit coercion: `z.string()` never accepts numbers, `z.number()`
 *   never accepts numeric strings. Use explicit `z.preprocess` only where
 *   a coercion is documented and intentional.
 * - Failures throw `AppError('validation_failed')` so the global Step 05
 *   filter renders the stable v1 envelope with safe field details.
 * - Details carry `path` + machine-stable `reason` only — never echoed
 *   input values — so secrets in the payload cannot leak into responses.
 */
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error';
import type { ErrorDetail } from '../errors/error-envelope';

/** Format a Zod issue path using DTO notation (`roles[3].name`). */
export function formatZodPath(path: Array<string | number>): string {
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

type ZodIssueLike = {
  code: string;
  path: Array<string | number>;
  expected?: unknown;
  keys?: unknown;
  message?: string;
};

function reasonForIssue(issue: ZodIssueLike): string {
  if (issue.code === 'unrecognized_keys') {
    return 'unknown_property';
  }
  if (issue.code === 'invalid_type') {
    return typeof issue.expected === 'string' && issue.expected.length > 0
      ? `expected_${issue.expected}`
      : 'invalid_type';
  }
  return issue.code;
}

/**
 * Convert Zod issues to safe v1 `details[]`.
 * `unrecognized_keys` expands to one entry per offending key so callers
 * can see exactly which property was rejected.
 */
export function toErrorDetails(issues: ZodIssueLike[]): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      const base = formatZodPath(issue.path);
      for (const key of issue.keys) {
        if (typeof key !== 'string' || key.length === 0) {
          continue;
        }
        const path = base === '(body)' ? key : `${base}.${key}`;
        details.push({ path, reason: 'unknown_property' });
      }
      continue;
    }
    details.push({
      path: formatZodPath(issue.path),
      reason: reasonForIssue(issue),
    });
  }
  return details;
}

/**
 * Nest pipe validating one transport value against a Zod schema.
 * Usable as `@Body(new ZodValidationPipe(schema))`,
 * `@Query(...)`, or `@Param(...)`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, metadata?: ArgumentMetadata): T {
    void metadata;
    const parsed = this.schema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
    const issues = (parsed.error.issues ?? []) as unknown as ZodIssueLike[];
    throw new AppError('validation_failed', 'Request validation failed', {
      details: toErrorDetails(issues),
    });
  }
}

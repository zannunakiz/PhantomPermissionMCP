export const SCOPES = [
  'models:read',
  'models:write',
  'simulations:run',
  'simulations:read',
  'exports:read',
  'audit:read',
] as const;
export type Scope = (typeof SCOPES)[number];
const SCOPE_SET = new Set<string>(SCOPES);
export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}
export function assertScopes(
  values: readonly unknown[],
): asserts values is readonly Scope[] {
  for (const v of values) {
    if (!isScope(v)) throw new Error(`unknown scope: ${String(v)}`);
  }
}

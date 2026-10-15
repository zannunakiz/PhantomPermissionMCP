/**
 * Change-operation precondition outcome contract.
 *
 * `apply`: preconditions met, will change state. `noop`: benign
 * conflict → no-op entry, never an error. `error`: precondition
 * violated → caller throws/rejects with the carried `DomainError`.
 */
import type { DomainError } from './errors';

export type OperationOutcome =
  | { readonly kind: 'apply' }
  | { readonly kind: 'noop'; readonly reason: string }
  | { readonly kind: 'error'; readonly error: DomainError };

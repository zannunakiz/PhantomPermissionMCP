/**
 * Impact result types (Step 08).
 *
 * Mirrors the simulation pipeline in docs/architecture/overview.md §6
 * and the report shapes in docs/api/v1-contract.md §4. Deterministic
 * by construction: sorted permission lists, sorted subject rows, and
 * count summaries with no clock or randomness.
 */
import type { SubjectId } from './ids';

/** Per-subject added/removed effective permissions. */
export type SubjectImpact = {
  readonly subjectId: SubjectId;
  readonly added: readonly string[];
  readonly removed: readonly string[];
};

/** Count summary returned with every simulation result. */
export type FindingCounts = {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
};

export type SimulationSummary = {
  readonly addedCount: number;
  readonly removedCount: number;
  readonly affectedSubjectCount: number;
  readonly findingCounts: FindingCounts;
};

/** Full deterministic before/after analysis of one operation list. */
export type SimulationResult = {
  readonly impacts: readonly SubjectImpact[];
  readonly affectedSubjects: readonly SubjectId[];
  readonly summary: SimulationSummary;
};

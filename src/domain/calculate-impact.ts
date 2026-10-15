/**
 * Permission impact simulation.
 *
 * Before/after analysis of an ordered operation list: resolve every
 * subject pre-change, apply immutably, resolve post-change,
 * then diff per subject into sorted `added[]`/`removed[]` facts.
 * Only changed subjects appear in `impacts`/`affectedSubjects`.
 * Counts always reconcile with the detail records. Findings are facts,
 * never vulnerability claims — risk rules live in the findings module, so
 * `findingCounts` are zeroed here.
 *
 * Pure, deterministic, non-mutating. Only domain imports.
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import type { SimulationResult, SubjectImpact } from './impact';
import { assertAcyclicInheritance } from './inheritance-cycles';
import { assertApplyOperations } from './apply-operations';
import { assertValidStructure } from './validate-structure';
import { resolveAllSubjects } from './resolve-permissions';

function diffSets(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = [...afterSet].filter((p) => !beforeSet.has(p)).sort();
  const removed = [...beforeSet].filter((p) => !afterSet.has(p)).sort();
  return { added, removed };
}

/**
 * Simulate an operation list against a snapshot.
 * Throws `DomainError` when the base model or any operation is invalid.
 */
export function simulateChange(
  snapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
): SimulationResult {
  assertValidStructure(snapshot);
  assertAcyclicInheritance(snapshot);
  const before = resolveAllSubjects(snapshot);
  const afterSnapshot = assertApplyOperations(snapshot, operations);
  const after = resolveAllSubjects(afterSnapshot);
  const impacts: SubjectImpact[] = [];
  const subjectIds = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const subjectId of subjectIds) {
    const { added, removed } = diffSets(
      before.get(subjectId) ?? [],
      after.get(subjectId) ?? [],
    );
    if (added.length > 0 || removed.length > 0) {
      impacts.push({ subjectId: subjectId as never, added, removed });
    }
  }
  const addedCount = impacts.reduce((n, i) => n + i.added.length, 0);
  const removedCount = impacts.reduce((n, i) => n + i.removed.length, 0);
  return {
    impacts,
    affectedSubjects: impacts.map((i) => i.subjectId),
    summary: {
      addedCount,
      removedCount,
      affectedSubjectCount: impacts.length,
      findingCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    },
  };
}

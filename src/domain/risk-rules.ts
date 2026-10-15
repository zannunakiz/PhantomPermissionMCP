/**
 * Explainable risk rules, part 1: config + helpers.
 *
 * Deterministic advisory rules over a simulated impact. Thresholds and
 * sensitive lists are explicit in `RiskRuleConfig`; findings are worded
 * as candidates for review, never proven vulnerability claims.
 */
import type { AccessModelSnapshot } from './access-model';
import type { ChangeOperation } from './operations';
import type { RiskFinding, Severity } from './findings';
import type { SimulationResult } from './impact';
import { assertApplyOperations } from './apply-operations';
import { simulateChange } from './calculate-impact';
import { resolveAllSubjects } from './resolve-permissions';
import { subjectRuleFindings } from './risk-subject-rules';

export type EscalationPattern = {
  readonly roleId: string;
  readonly permissionValue: string;
  readonly severity: Severity;
};

export type RiskRuleConfig = {
  readonly sensitivePermissions: readonly string[];
  readonly broadAccessThreshold: number;
  readonly escalationPatterns: readonly EscalationPattern[];
};

export const DEFAULT_RISK_RULE_CONFIG: RiskRuleConfig = {
  sensitivePermissions: ['invoice:refund', 'user:delete', 'role:assign'],
  broadAccessThreshold: 5,
  escalationPatterns: [],
};

export type SimulationWithFindings = SimulationResult & {
  readonly findings: readonly RiskFinding[];
};

export function sortFindings(findings: RiskFinding[]): readonly RiskFinding[] {
  return [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) {
      return a.ruleId < b.ruleId ? -1 : 1;
    }
    if (a.severity !== b.severity) {
      return a.severity < b.severity ? -1 : 1;
    }
    const aFirst = (a.subjects[0] ?? '') as string;
    const bFirst = (b.subjects[0] ?? '') as string;
    return aFirst < bFirst ? -1 : aFirst > bFirst ? 1 : 0;
  });
}

export function blastRadius(operations: readonly ChangeOperation[]): {
  subjects: Set<string>;
  roles: Set<string>;
} {
  const subjects = new Set<string>();
  const roles = new Set<string>();
  for (const op of operations) {
    const anyOp = op as unknown as Record<string, string>;
    if (typeof anyOp.subjectId === 'string') {
      subjects.add(anyOp.subjectId);
    }
    if (typeof anyOp.roleId === 'string') {
      roles.add(anyOp.roleId);
    }
    if (typeof anyOp.childRoleId === 'string') {
      roles.add(anyOp.childRoleId);
    }
    if (typeof anyOp.parentRoleId === 'string') {
      roles.add(anyOp.parentRoleId);
    }
  }
  return { subjects, roles };
}

export function assignedRoleMap(
  afterSnapshot: AccessModelSnapshot,
): Map<string, Set<string>> {
  const assignedRoles = new Map<string, Set<string>>();
  for (const a of afterSnapshot.assignments) {
    const sid = a.subjectId;
    const set = assignedRoles.get(sid) ?? new Set<string>();
    set.add(a.roleId);
    assignedRoles.set(sid, set);
  }
  return assignedRoles;
}

function reachableVia(
  afterSnapshot: AccessModelSnapshot,
  startRole: string,
): Set<string> {
  const parentOf = new Map<string, string[]>();
  for (const e of afterSnapshot.inheritance) {
    const list = parentOf.get(e.childRoleId) ?? [];
    list.push(e.parentRoleId);
    parentOf.set(e.childRoleId, list);
  }
  const values = new Set<string>();
  const seen = new Set<string>();
  const visit = (roleId: string): void => {
    if (seen.has(roleId)) {
      return;
    }
    seen.add(roleId);
    for (const b of afterSnapshot.bindings) {
      if (b.roleId === roleId) {
        const perm = afterSnapshot.permissions.find(
          (p) => p.id === b.permissionId,
        );
        if (perm) {
          values.add(perm.value);
        }
      }
    }
    for (const next of parentOf.get(roleId) ?? []) {
      visit(next);
    }
  };
  visit(startRole);
  return values;
}

function resolveRolePermissions(
  snapshot: AccessModelSnapshot,
  roleId: string,
): Set<string> {
  const parentOf = new Map<string, string[]>();
  for (const e of snapshot.inheritance) {
    const list = parentOf.get(e.childRoleId) ?? [];
    list.push(e.parentRoleId);
    parentOf.set(e.childRoleId, list);
  }
  const values = new Set<string>();
  const seen = new Set<string>();
  const visit = (current: string): void => {
    if (seen.has(current)) {
      return;
    }
    seen.add(current);
    for (const b of snapshot.bindings) {
      if (b.roleId === current) {
        const perm = snapshot.permissions.find((p) => p.id === b.permissionId);
        if (perm) {
          values.add(perm.value);
        }
      }
    }
    for (const next of parentOf.get(current) ?? []) {
      visit(next);
    }
  };
  visit(roleId);
  return values;
}

function inheritanceFindings(
  snapshot: AccessModelSnapshot,
  afterSnapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  for (const op of operations) {
    if ((op as { type: string }).type !== 'add_inheritance') {
      continue;
    }
    const edge = op as unknown as { childRoleId: string; parentRoleId: string };
    const parentReachable = reachableVia(afterSnapshot, edge.parentRoleId);
    const beforeChild = resolveRolePermissions(snapshot, edge.childRoleId);
    const afterChild = resolveRolePermissions(afterSnapshot, edge.childRoleId);
    const newlyReachable = [...parentReachable]
      .filter((p) => !beforeChild.has(p) && afterChild.has(p))
      .sort();
    if (newlyReachable.length > 0) {
      findings.push({
        ruleId: 'RISKY_INHERITANCE',
        severity: newlyReachable.length >= 3 ? 'high' : 'medium',
        subjects: [],
        evidence: {
          childRoleId: edge.childRoleId,
          parentRoleId: edge.parentRoleId,
          newlyReachable,
        },
        explanation: `Candidate review: new edge may widen reach by ${newlyReachable.length}.`,
      });
    }
  }
  return findings;
}

/** Evaluate all five rules over a completed impact diff. */
export function evaluateRiskRules(
  snapshot: AccessModelSnapshot,
  afterSnapshot: AccessModelSnapshot,
  impact: SimulationResult,
  operations: readonly ChangeOperation[],
  config: RiskRuleConfig = DEFAULT_RISK_RULE_CONFIG,
): readonly RiskFinding[] {
  const assignedRoles = assignedRoleMap(afterSnapshot);
  const before = resolveAllSubjects(snapshot);
  const after = resolveAllSubjects(afterSnapshot);
  const findings: RiskFinding[] = [
    ...subjectRuleFindings(impact, operations, config, assignedRoles),
    ...inheritanceFindings(snapshot, afterSnapshot, operations),
  ];
  for (const pattern of config.escalationPatterns) {
    for (const [sid, perms] of after.entries()) {
      const hadBefore = (before.get(sid) ?? []).includes(
        pattern.permissionValue,
      );
      const hasAfter = perms.includes(pattern.permissionValue);
      const holdsRole = assignedRoles.get(sid)?.has(pattern.roleId) ?? false;
      if (!hadBefore && hasAfter && holdsRole) {
        findings.push({
          ruleId: 'PRIVILEGE_ESCALATION_PATTERN',
          severity: pattern.severity,
          subjects: [sid as never],
          evidence: {
            subjectId: sid,
            roleId: pattern.roleId,
            permission: pattern.permissionValue,
          },
          explanation: `Candidate review: matches pattern (${pattern.roleId} + ${pattern.permissionValue}).`,
        });
      }
    }
  }
  return sortFindings(findings);
}

/** Simulate and attach advisory findings with reconciled counts. */
export function simulateWithFindings(
  snapshot: AccessModelSnapshot,
  operations: readonly ChangeOperation[],
  config: RiskRuleConfig = DEFAULT_RISK_RULE_CONFIG,
): SimulationWithFindings {
  const impact = simulateChange(snapshot, operations);
  const afterSnapshot = assertApplyOperations(snapshot, operations);
  const findings = evaluateRiskRules(
    snapshot,
    afterSnapshot,
    impact,
    operations,
    config,
  );
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return {
    ...impact,
    summary: { ...impact.summary, findingCounts: counts },
    findings,
  };
}

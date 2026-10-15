/**
 * Explainable risk rules, part 2a: subject rules.
 */
import type { ChangeOperation } from './operations';
import type { RiskFinding, Severity } from './findings';
import type { SimulationResult } from './impact';
import type { RiskRuleConfig } from './risk-rules';
import { blastRadius } from './risk-rules';

export function subjectRuleFindings(
  impact: SimulationResult,
  operations: readonly ChangeOperation[],
  config: RiskRuleConfig,
  assignedRoles: Map<string, Set<string>>,
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const radius = blastRadius(operations);
  for (const row of impact.impacts) {
    const sid = row.subjectId as string;
    for (const permission of row.added) {
      if (config.sensitivePermissions.includes(permission)) {
        findings.push({
          ruleId: 'SENSITIVE_PERMISSION',
          severity: 'high',
          subjects: [row.subjectId],
          evidence: { permission, subjectId: sid },
          explanation: `Candidate review: gained sensitive permission '${permission}'.`,
        });
      }
    }
    const netGain = row.added.length - row.removed.length;
    if (netGain >= config.broadAccessThreshold) {
      const severity: Severity =
        netGain >= config.broadAccessThreshold * 2 ? 'high' : 'medium';
      findings.push({
        ruleId: 'BROAD_ACCESS_INCREASE',
        severity,
        subjects: [row.subjectId],
        evidence: {
          subjectId: sid,
          gained: netGain,
          threshold: config.broadAccessThreshold,
        },
        explanation: `Candidate review: net gain ${netGain} meets threshold ${config.broadAccessThreshold}.`,
      });
    }
    const subjectTouched = radius.subjects.has(sid);
    const roleTouched = [...(assignedRoles.get(sid) ?? [])].some((r) =>
      radius.roles.has(r),
    );
    if (!subjectTouched && !roleTouched) {
      findings.push({
        ruleId: 'UNEXPECTED_SUBJECT_IMPACT',
        severity: 'medium',
        subjects: [row.subjectId],
        evidence: {
          subjectId: sid,
          added: [...row.added],
          removed: [...row.removed],
        },
        explanation: 'Candidate review: changed outside blast radius.',
      });
    }
  }
  return findings;
}

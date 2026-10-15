/**
 * Risk finding types (Step 08).
 *
 * Mirrors the risk rule catalogue in docs/architecture/overview.md §6.
 * Findings are advisory only — the product never claims a score proves
 * security. Thresholds are configurable and explicit in output; rule
 * evaluation belongs to later steps.
 */
import type { SubjectId } from './ids';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type Severity = (typeof SEVERITIES)[number];

export const RISK_RULE_IDS = [
  'SENSITIVE_PERMISSION',
  'BROAD_ACCESS_INCREASE',
  'UNEXPECTED_SUBJECT_IMPACT',
  'RISKY_INHERITANCE',
  'PRIVILEGE_ESCALATION_PATTERN',
] as const;

export type RiskRuleId = (typeof RISK_RULE_IDS)[number];

/** One explainable rule hit. */
export type RiskFinding = {
  readonly ruleId: RiskRuleId;
  readonly severity: Severity;
  readonly subjects: readonly SubjectId[];
  readonly evidence: Record<string, unknown>;
  readonly explanation: string;
};

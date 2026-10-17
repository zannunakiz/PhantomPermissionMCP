/**
 * Step 56 — fixture validation.
 *
 * Proves the shared factories are deterministic and synthetic, and that
 * adversarial fixtures actually exercise the expected safeguards
 * (schema limits, cycle detection, strict schemas, prototype-pollution
 * resistance) instead of being decorative.
 */
import { validateSnapshot } from '../src/models/validate-snapshot';
import { createModelBodySchema } from '../src/models/models.dto';
import { AppError } from '../src/common/errors/app-error';
import {
  MALICIOUS_STRINGS,
  broadBlastSimulationBody,
  grantOp,
  highRiskGrantOps,
  makeApiKey,
  makeAuditEvent,
  makeCyclicInheritanceSnapshot,
  makeDeepInheritanceSnapshot,
  makeExpiredKey,
  makeHighRiskSnapshot,
  makeLargeImpactSnapshot,
  makeModelRecord,
  makeOverlappingRolesSnapshot,
  makeSimulationRecord,
  makeSnapshot,
  makeTenant,
  makeVersionRecord,
  oversizedRolesSnapshot,
  protoPollutionBody,
  unknownKeyBody,
} from './fixtures/factories';

describe('Step 56 fixtures: deterministic and synthetic', () => {
  it('record factories return deep-equal results for identical inputs', () => {
    expect(makeTenant('7')).toEqual(makeTenant('7'));
    expect(makeApiKey({ raw: `ppk_${'b'.repeat(40)}` }).record).toEqual(
      makeApiKey({ raw: `ppk_${'b'.repeat(40)}` }).record,
    );
    expect(makeModelRecord()).toEqual(makeModelRecord());
    expect(makeVersionRecord()).toEqual(makeVersionRecord());
    expect(makeSimulationRecord()).toEqual(makeSimulationRecord());
    expect(makeAuditEvent()).toEqual(makeAuditEvent());
  });

  it('key fixtures never embed the raw key in the stored record', () => {
    const { raw, record } = makeApiKey();
    expect(record.keyDigest).not.toContain(raw);
    expect(record.keyPrefix).toBe(raw.slice(0, 12));
  });

  it('expired keys are expired relative to the supplied clock only', () => {
    const now = 1_000_000;
    const key = makeExpiredKey(now);
    expect(key.record.expiresAt!.getTime()).toBeLessThan(now);
  });

  it('snapshot builders are deterministic', () => {
    expect(makeSnapshot()).toEqual(makeSnapshot());
    expect(makeDeepInheritanceSnapshot(5)).toEqual(
      makeDeepInheritanceSnapshot(5),
    );
    expect(makeLargeImpactSnapshot(10)).toEqual(makeLargeImpactSnapshot(10));
  });
});

describe('Step 56 fixtures: valid adversarial shapes pass validation', () => {
  it('accepts basic, deep (within limit), overlapping, large, and high-risk snapshots', () => {
    expect(() => validateSnapshot(makeSnapshot())).not.toThrow();
    expect(() =>
      validateSnapshot(makeDeepInheritanceSnapshot(25)),
    ).not.toThrow();
    expect(() =>
      validateSnapshot(makeOverlappingRolesSnapshot()),
    ).not.toThrow();
    expect(() => validateSnapshot(makeHighRiskSnapshot())).not.toThrow();
    const large = makeLargeImpactSnapshot(500);
    expect(large.subjects).toHaveLength(500);
    expect(large.assignments).toHaveLength(500);
    expect(() => validateSnapshot(large)).not.toThrow();
  });

  it('operation builders produce schema-valid change sets', () => {
    expect(highRiskGrantOps()).toEqual([
      grantOp('ops', 'invoice:refund'),
      grantOp('ops', 'user:delete'),
      grantOp('ops', 'role:assign'),
    ]);
    const body = broadBlastSimulationBody('mdl_1', 50);
    expect(body.operations.length).toBe(53);
  });
});

describe('Step 56 fixtures: adversarial shapes trigger safeguards', () => {
  const expectValidationFailure = (snapshot: unknown) => {
    let err: unknown;
    try {
      validateSnapshot(snapshot);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('validation_failed');
  };

  it('cyclic inheritance always fails cycle detection', () => {
    expectValidationFailure(makeCyclicInheritanceSnapshot());
  });

  it('inheritance deeper than the domain limit fails fast', () => {
    expectValidationFailure(makeDeepInheritanceSnapshot(26));
  });

  it('oversized role collections fail the schema limit', () => {
    expectValidationFailure(oversizedRolesSnapshot(501));
  });

  it('unknown keys are rejected by strict DTO schemas', () => {
    const parsed = createModelBodySchema.safeParse(unknownKeyBody());
    expect(parsed.success).toBe(false);
    // The inner snapshot itself remains valid.
    expect(() => validateSnapshot(unknownKeyBody().snapshot)).not.toThrow();
  });

  it('prototype pollution via JSON keys never reaches Object.prototype', () => {
    const body = protoPollutionBody();
    expectValidationFailure(body.snapshot);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('malicious strings are inert constants', () => {
    for (const value of Object.values(MALICIOUS_STRINGS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
    expect(MALICIOUS_STRINGS.protoPollution).toBe('__proto__');
  });
});

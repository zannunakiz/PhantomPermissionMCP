/**
 * Step 17 engine gap-fill coverage (part 2 of 2).
 */
import { assertApplyOperations } from './apply-operations';
import { evaluateRiskRules } from './risk-rules';
import { simulateChange } from './calculate-impact';
import { expectNoMutation, smallShopSnapshot } from './fixtures';

describe('engine coverage (Step 17) — rules and pipelines', () => {
  it('evaluates rules directly with reproducible evidence', () => {
    const snapshot = {
      ...smallShopSnapshot(),
      permissions: [
        { id: 'perm_read' as never, value: 'invoice:read' },
        { id: 'perm_refund' as never, value: 'invoice:refund' },
        { id: 'perm_delete' as never, value: 'user:delete' },
      ],
      bindings: [
        { roleId: 'role_admin' as never, permissionId: 'perm_refund' as never },
        { roleId: 'role_viewer' as never, permissionId: 'perm_read' as never },
      ],
    };
    const operations = [
      {
        type: 'grant_permission' as const,
        roleId: 'role_viewer' as never,
        permissionId: 'perm_delete' as never,
      },
    ];
    const impact = simulateChange(snapshot, operations);
    const after = assertApplyOperations(snapshot, operations);
    const first = evaluateRiskRules(snapshot, after, impact, operations);
    const second = evaluateRiskRules(snapshot, after, impact, operations);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.some((f) => f.ruleId === 'SENSITIVE_PERMISSION')).toBe(true);
    const finding = first.find((f) => f.ruleId === 'SENSITIVE_PERMISSION');
    expect(finding?.evidence).toMatchObject({
      permission: 'user:delete',
      subjectId: 'subj_ana',
    });
  });

  it('keeps the full pipeline immutable end to end', () => {
    const snapshot = smallShopSnapshot();
    expectNoMutation(snapshot, () => {
      simulateChange(snapshot, [
        {
          type: 'revoke_permission' as const,
          roleId: 'role_admin' as never,
          permissionId: 'perm_refund' as never,
        },
      ]);
    });
  });
});

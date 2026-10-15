import { parseProvisionArgs, resolvePepper } from './provision.cli';

describe('provision cli args', () => {
  it('parses tenant:create and key lifecycle commands', () => {
    expect(
      parseProvisionArgs(['tenant:create', '--name', 'Acme']),
    ).toMatchObject({ kind: 'tenant:create', name: 'Acme' });
    expect(
      parseProvisionArgs([
        'key:issue',
        '--tenant',
        'tnt_a',
        '--scopes',
        'models:read,audit:read',
      ]),
    ).toMatchObject({ kind: 'key:issue', tenant: 'tnt_a' });
    expect(
      parseProvisionArgs([
        'key:revoke',
        '--tenant',
        'tnt_a',
        '--key-id',
        'key_1',
      ]),
    ).toMatchObject({ kind: 'key:revoke' });
    expect(
      parseProvisionArgs([
        'key:rotate',
        '--tenant',
        'tnt_a',
        '--key-id',
        'key_1',
      ]),
    ).toMatchObject({ kind: 'key:rotate', scopes: ['models:read'] });
  });

  it('rejects unknown scopes and missing args', () => {
    expect(() =>
      parseProvisionArgs([
        'key:issue',
        '--tenant',
        'tnt_a',
        '--scopes',
        'admin:all',
      ]),
    ).toThrow('unknown scope');
    expect(() =>
      parseProvisionArgs(['key:issue', '--tenant', 'tnt_a']),
    ).toThrow('missing --scopes');
    expect(() => parseProvisionArgs(['nope'])).toThrow('usage:');
  });

  it('requires a real pepper', () => {
    expect(() => resolvePepper({})).toThrow('API_KEY_PEPPER is required');
    expect(() => resolvePepper({ API_KEY_PEPPER: 'change-me-x' })).toThrow(
      'placeholder',
    );
    expect(resolvePepper({ API_KEY_PEPPER: 'real-pepper-123' })).toBe(
      'real-pepper-123',
    );
  });
});

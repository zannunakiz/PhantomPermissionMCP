import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { digestKey, generateRawKey, keyPrefixOf } from './api-key';
import { assertScopes, type Scope } from './scopes';

export type ProvisionCommand =
  | { kind: 'tenant:create'; name: string; id?: string }
  | { kind: 'key:issue'; tenant: string; scopes: Scope[]; expires?: string }
  | { kind: 'key:revoke'; tenant: string; keyId: string }
  | {
      kind: 'key:rotate';
      tenant: string;
      keyId: string;
      scopes: Scope[];
      expires?: string;
    };

const USAGE = `usage:
  provision tenant:create --name <name> [--id tnt_...]
  provision key:issue --tenant <id> --scopes <csv> [--expires <iso>]
  provision key:revoke --tenant <id> --key-id <id>
  provision key:rotate --tenant <id> --key-id <id> [--scopes <csv>] [--expires <iso>]`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function parseScopes(csv: string | undefined, fallback?: Scope[]): Scope[] {
  const list = (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    if (fallback) return fallback;
    throw new Error(
      'missing --scopes (csv of: models:read, models:write, simulations:run, simulations:read, exports:read, audit:read)',
    );
  }
  assertScopes(list);
  return list as Scope[];
}

export function parseProvisionArgs(argv: string[]): ProvisionCommand {
  const [cmd, ...rest] = argv;
  if (cmd === 'tenant:create') {
    const name = flag(rest, '--name');
    if (!name) throw new Error(`missing --name\n${USAGE}`);
    return { kind: 'tenant:create', name, id: flag(rest, '--id') };
  }
  if (cmd === 'key:issue') {
    const tenant = flag(rest, '--tenant');
    if (!tenant) throw new Error(`missing --tenant\n${USAGE}`);
    return {
      kind: 'key:issue',
      tenant,
      scopes: parseScopes(flag(rest, '--scopes')),
      expires: flag(rest, '--expires'),
    };
  }
  if (cmd === 'key:revoke') {
    const tenant = flag(rest, '--tenant');
    const keyId = flag(rest, '--key-id');
    if (!tenant || !keyId)
      throw new Error(`missing --tenant/--key-id\n${USAGE}`);
    return { kind: 'key:revoke', tenant, keyId };
  }
  if (cmd === 'key:rotate') {
    const tenant = flag(rest, '--tenant');
    const keyId = flag(rest, '--key-id');
    if (!tenant || !keyId)
      throw new Error(`missing --tenant/--key-id\n${USAGE}`);
    return {
      kind: 'key:rotate',
      tenant,
      keyId,
      scopes: parseScopes(flag(rest, '--scopes'), ['models:read']),
      expires: flag(rest, '--expires'),
    };
  }
  throw new Error(USAGE);
}

export function resolvePepper(env: NodeJS.ProcessEnv = process.env): string {
  const pepper = env.API_KEY_PEPPER;
  if (!pepper) throw new Error('API_KEY_PEPPER is required to provision keys');
  if (/change-me|example|placeholder/i.test(pepper)) {
    throw new Error('API_KEY_PEPPER must not be a placeholder value');
  }
  return pepper;
}

function db(): { client: PrismaClient; pool: Pool } {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://phantom:phantom@localhost:5432/phantom_permission_dev';
  const pool = new Pool({ connectionString: url });
  return { client: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

async function main(): Promise<void> {
  const cmd = parseProvisionArgs(process.argv.slice(2));
  const { client, pool } = db();
  try {
    if (cmd.kind === 'tenant:create') {
      const id = cmd.id ?? `tnt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const row = await client.tenant.create({ data: { id, name: cmd.name } });
      process.stderr.write(`tenant ok id=${row.id} name=${row.name}\n`);
      return;
    }
    const pepper = resolvePepper();
    if (cmd.kind === 'key:revoke') {
      const row = await client.apiKey.updateMany({
        where: { id: cmd.keyId, tenantId: cmd.tenant },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      if (row.count === 0) throw new Error('key not found for tenant');
      process.stderr.write(`revoked ${cmd.keyId}\n`);
      return;
    }
    const rawKey = generateRawKey();
    const scopes = cmd.kind === 'key:rotate' ? cmd.scopes : cmd.scopes;
    const expires = cmd.kind === 'key:rotate' ? cmd.expires : cmd.expires;
    if (cmd.kind === 'key:rotate') {
      await client.apiKey.updateMany({
        where: { id: cmd.keyId, tenantId: cmd.tenant },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
    }
    const record = await client.apiKey.create({
      data: {
        id: `key_${randomUUID().replace(/-/g, '')}`,
        tenantId: cmd.tenant,
        keyPrefix: keyPrefixOf(rawKey),
        keyDigest: digestKey(rawKey, pepper),
        scopes: [...scopes],
        expiresAt: expires ? new Date(expires) : null,
      },
    });
    process.stderr.write(
      `key ok id=${record.id} tenant=${record.tenantId} prefix=${record.keyPrefix}\n`,
    );
    process.stdout.write(`${rawKey}\n`);
  } finally {
    await client.$disconnect();
    await pool.end();
  }
}

export { USAGE };

if (require.main === module) {
  main().catch((err: Error) => {
    process.stderr.write(`provision: failed (${err.message})\n`);
    process.exit(1);
  });
}

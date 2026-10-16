/**
 * Step 48 — stdio smoke test (real child process, no mocks/paid services).
 * Spawns `scripts/mcp-serve.ts` over stdio via StdioClientTransport, then
 * checks: initialize, tools/list exposes the 5 tools, a valid
 * `validate_access_model` call succeeds (stdout stays clean JSON-RPC —
 * any stdout corruption would break framing here), malformed args are
 * rejected, unknown tool is rejected, then clean shutdown.
 * Run: `npm run mcp:stdio-smoke`
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['-r', 'ts-node/register/transpile-only', 'scripts/mcp-serve.ts'],
    stderr: 'inherit', // diagnostics go to stderr; stdout stays protocol-only
  });
  const client = new Client({ name: 'mcp-stdio-smoke', version: '0.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    console.log('stdio tools:', names.join(', '));
    for (const expected of [
      'validate_access_model',
      'simulate_permission_change',
      'explain_access_change',
      'find_privilege_escalation',
      'compare_access_models',
    ]) {
      if (!names.includes(expected))
        throw new Error(`missing tool ${expected}`);
    }
    const ok = await client.callTool({
      name: 'validate_access_model',
      arguments: {
        snapshot: {
          roles: [{ id: 'viewer', name: 'viewer' }],
          permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
          bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
          inheritance: [],
          assignments: [],
          subjects: [],
        },
      },
    });
    console.log('stdio valid call ok:', JSON.stringify(ok).slice(0, 160));
    // Malformed snapshot returns { valid:false, findings } (not isError) —
    // either way the server stays up and reports findings deterministically.
    const bad = (await client.callTool({
      name: 'validate_access_model',
      arguments: { snapshot: { nope: true } },
    })) as { structuredContent?: { valid?: boolean }; isError?: boolean };
    if (!(bad.isError || bad.structuredContent?.valid === false))
      throw new Error('expected malformed-snapshot findings');
    console.log('stdio malformed args rejected ok');
    try {
      await client.callTool({ name: 'no_such_tool', arguments: {} });
      throw new Error('expected unknown-tool rejection');
    } catch (e) {
      if ((e as Error).message === 'expected unknown-tool rejection') throw e;
      console.log('stdio unknown tool rejected ok');
    }
    console.log('STDIO SMOKE PASS');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('STDIO SMOKE FAIL', err);
  process.exit(1);
});

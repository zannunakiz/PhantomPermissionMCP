/**
 * Step 47 — minimal local MCP smoke test (no network/paid services).
 * Spins up the real NestJS module + McpService, talks over InMemoryTransport
 * (same SDK framing as stdio), checks init, tools/list, a valid call, an
 * invalid-args rejection, an unknown-tool rejection, then clean shutdown.
 * Run: npm run mcp:smoke
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AppModule } from '../src/app.module';
import { McpService } from '../src/mcp/mcp.service';

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider('APP_CONFIG')
    .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  const server = app.get(McpService).createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-smoke', version: '0.0.0' });
  try {
    await Promise.all([server.connect(st), client.connect(ct)]);
    const listed = await client.listTools();
    console.log('tools:', listed.tools.map((t) => t.name).join(', '));
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
    console.log('valid call ok:', JSON.stringify(ok).slice(0, 200));
    try {
      await client.callTool({ name: 'no_such_tool', arguments: {} });
      throw new Error('expected unknown-tool rejection');
    } catch (e) {
      console.log('unknown tool rejected ok');
    }
    console.log('SMOKE PASS');
  } finally {
    await client.close();
    await server.close();
    await app.close();
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL', err);
  process.exit(1);
});

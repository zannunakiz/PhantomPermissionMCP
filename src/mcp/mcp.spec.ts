import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AppModule } from '../app.module';
import { McpService } from './mcp.service';

/**
 * Step 40 validation gate: MCP initialize + tools/list smoke test works
 * against the real NestJS module; no domain logic in transport handlers.
 *
 * Step 41 gate: `validate_access_model` covers valid models, structural
 * failures, malformed arguments, and stable output.
 */
describe('mcp transport (step 40)', () => {
  it('initializes and lists tools over an in-memory transport', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('APP_CONFIG')
      .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const mcp = app.get(McpService);
    const server = mcp.createServer();

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    const tools = await client.listTools();
    expect(Array.isArray(tools.tools)).toBe(true);
    await client.close();
    await app.close();
  });
});

const VALID_SNAPSHOT = {
  roles: [{ id: 'viewer', name: 'viewer' }],
  permissions: [{ id: 'invoice:read', value: 'invoice:read' }],
  bindings: [{ roleId: 'viewer', permissionId: 'invoice:read' }],
  inheritance: [],
  assignments: [],
  subjects: [],
};

describe('validate_access_model (step 41)', () => {
  let client: Client;
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('APP_CONFIG')
      .useValue({ databaseUrl: 'postgresql://localhost:5432/test' })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const server = app.get(McpService).createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'step41', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  const callTool = async (args: unknown) =>
    (await client.callTool({
      name: 'validate_access_model',
      arguments: args as Record<string, unknown>,
    })) as {
      structuredContent: { valid: boolean; findings: unknown[] };
      content: { type: string; text: string }[];
    };

  it('lists validate_access_model in tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('validate_access_model');
  });

  it('accepts a valid model', async () => {
    const res = await callTool({ snapshot: VALID_SNAPSHOT });
    expect(res.structuredContent).toEqual({ valid: true, findings: [] });
  });

  it('reports structural failures as findings', async () => {
    const res = await callTool({
      snapshot: {
        ...VALID_SNAPSHOT,
        bindings: [{ roleId: 'ghost', permissionId: 'invoice:read' }],
      },
    });
    expect(res.structuredContent.valid).toBe(false);
    expect(res.structuredContent.findings.length).toBeGreaterThan(0);
    // Safe: findings carry path+reason only, never input values.
    expect(JSON.stringify(res.structuredContent)).not.toContain('ghost');
  });

  it('rejects malformed arguments (strict schema)', async () => {
    // SDK v2 surfaces schema violations as isError results, not throws.
    for (const bad of [{ nope: 1 }, { snapshot: 'not-an-object' }]) {
      const res = await callTool(bad);
      expect((res as unknown as { isError?: boolean }).isError).toBe(true);
    }
  });

  it('returns stable output for the same input', async () => {
    const a = await callTool({ snapshot: VALID_SNAPSHOT });
    const b = await callTool({ snapshot: VALID_SNAPSHOT });
    expect(a.structuredContent).toEqual(b.structuredContent);
    expect(a.content[0].text).toBe(b.content[0].text);
  });
});

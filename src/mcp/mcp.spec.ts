import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AppModule } from '../app.module';
import { McpService } from './mcp.service';

/**
 * Step 40 validation gate: MCP initialize + tools/list smoke test works
 * against the real NestJS module; no domain logic in transport handlers.
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

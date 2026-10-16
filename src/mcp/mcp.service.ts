/**
 * Step 40 — thin MCP adapter (NestJS module + stdio server factory).
 *
 * SDK: `@modelcontextprotocol/server` v2 (official TypeScript SDK,
 * implements MCP spec 2026-07-28). Transport: stdio (`StdioServerTransport`
 * from `@modelcontextprotocol/server/stdio`) — the standard choice for a
 * local, self-hostable server process; no SSE/HTTP session handling needed.
 * Lifecycle: `NestFactory` boots `AppModule` (existing use cases);
 * `McpService.createServer()` builds an `McpServer` with no domain logic
 * inside transport handlers — tools registered in Steps 41+ call the same
 * application services as REST. Run: `npm run mcp:serve` (stdio).
 */
import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

@Injectable()
export class McpService {
  createServer(): McpServer {
    const server = new McpServer({
      name: 'phantom-permission-mcp',
      version: '1.0.0',
    });
    // Tools are registered in Steps 41+; each tool handler delegates to
    // the existing application use cases (same as REST controllers).
    return server;
  }

  async serveStdio(): Promise<void> {
    const server = this.createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

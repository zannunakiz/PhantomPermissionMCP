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
import { z } from 'zod';
import { AppError } from '../common/errors/app-error';
import { validateSnapshot } from '../models/validate-snapshot';

/** Strict input: a raw access-model snapshot object (same shape REST takes). */
const validateInputSchema = z
  .object({ snapshot: z.record(z.string(), z.unknown()) })
  .strict();

type Finding = { path: string; reason: string };

/**
 * Step 41 — `validate_access_model` MCP tool.
 * Thin handler: delegates to the same `validateSnapshot` validator REST
 * uses. Structured output: `{ valid, findings: [{ path, reason }] }`.
 * Errors stay safe and deterministic: domain failures map to
 * `validation_failed` findings; nothing echoes input values.
 */
export function toValidationResult(raw: unknown): {
  valid: boolean;
  findings: Finding[];
} {
  try {
    validateSnapshot(raw);
    return { valid: true, findings: [] };
  } catch (err) {
    if (err instanceof AppError && err.code === 'validation_failed') {
      return {
        valid: false,
        findings: err.details.map((d) => ({ path: d.path, reason: d.reason })),
      };
    }
    throw err;
  }
}

@Injectable()
export class McpService {
  createServer(): McpServer {
    const server = new McpServer({
      name: 'phantom-permission-mcp',
      version: '1.0.0',
    });
    server.registerTool(
      'validate_access_model',
      {
        description:
          'Validate an access-model snapshot. Returns { valid, findings }.',
        inputSchema: validateInputSchema,
      },
      async ({ snapshot }) => {
        const result = await Promise.resolve(toValidationResult(snapshot));
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );
    return server;
  }

  async serveStdio(): Promise<void> {
    const server = this.createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

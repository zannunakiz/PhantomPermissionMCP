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
import { AuthService } from '../auth/auth.service';
import { validateSnapshot } from '../models/validate-snapshot';
import { createSimulationBodySchema } from '../simulations/simulations.dto';
import { SimulationsService } from '../simulations/simulations.service';

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

/** Strict input: same fields REST takes, plus bearer auth for identity. */
const simulateInputSchema = createSimulationBodySchema
  .extend({ apiKey: z.string().min(1).max(256) })
  .strict();

/**
 * Step 42 — `simulate_permission_change` MCP tool.
 * Thin handler: verifies the API key (`AuthService.verify`, requiring
 * `simulations:run`), then delegates to the same
 * `SimulationsService.createSimulation` REST uses — same scope, limits,
 * persistence, and tenant rules. AppErrors surface as `isError` results
 * with `{ code, message }` (safe contract codes, no secrets).
 */
export function toMcpError(err: unknown): {
  code: string;
  message: string;
} {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  throw err;
}

@Injectable()
export class McpService {
  constructor(
    private readonly auth: AuthService,
    private readonly simulations: SimulationsService,
  ) {}

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
    server.registerTool(
      'simulate_permission_change',
      {
        description:
          'Simulate proposed permission changes on an authorised model/version. Returns { id, status, summary }.',
        inputSchema: simulateInputSchema,
      },
      async ({ apiKey, ...body }) => {
        try {
          const ctx = await this.auth.verify(`Bearer ${apiKey}`);
          this.auth.requireScope(ctx, 'simulations:run');
          const result = await this.simulations.createSimulation(ctx, body);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (err) {
          const e = toMcpError(err);
          return {
            content: [{ type: 'text', text: JSON.stringify(e) }],
            structuredContent: e,
            isError: true,
          };
        }
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

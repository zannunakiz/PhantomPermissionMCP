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
import type { ChangeOperation } from '../domain/operations';
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

/** Strict input: saved simulation + optional subject/permission focus. */
const explainInputSchema = z
  .object({
    apiKey: z.string().min(1).max(256),
    simulationId: z.string().regex(/^sim_[A-Za-z0-9_-]{1,120}$/),
    subjectId: z.string().min(1).max(128).optional(),
    permissionId: z.string().min(1).max(128).optional(),
  })
  .strict();

type ImpactRow = {
  subjectId?: unknown;
  added?: unknown;
  removed?: unknown;
};

function strList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').sort()
    : [];
}

/**
 * Step 43 — `explain_access_change` MCP tool.
 * Thin handler: verifies the API key (`simulations:read`), loads the saved
 * report via the same `SimulationsService.getReport` REST uses (same tenant
 * rules + persistence), then explains the recorded diff.
 * Output separates `facts` (recorded impacts, operations, provenance) from
 * `inference` (best-effort responsible-operation guess, flagged
 * `confidence: 'low'` with `evidence: 'missing'` when not derivable —
 * never invents causal evidence).
 */
export function explainDiff(
  impacts: ImpactRow[],
  operations: ChangeOperation[],
  focus?: { subjectId?: string; permissionId?: string },
): {
  change: 'added' | 'removed' | 'unchanged';
  facts: Record<string, unknown>;
  inference: Record<string, unknown>;
} {
  const rows = impacts
    .map((r) => ({
      subjectId: typeof r.subjectId === 'string' ? r.subjectId : '',
      added: strList(r.added),
      removed: strList(r.removed),
    }))
    .filter(
      (r) =>
        (!focus?.subjectId || r.subjectId === focus.subjectId) &&
        (!focus?.permissionId ||
          r.added.includes(focus.permissionId) ||
          r.removed.includes(focus.permissionId)),
    );
  const added = rows.flatMap((r) =>
    r.added
      .filter((p) => !focus?.permissionId || p === focus.permissionId)
      .map((p) => ({ subjectId: r.subjectId, permission: p })),
  );
  const removed = rows.flatMap((r) =>
    r.removed
      .filter((p) => !focus?.permissionId || p === focus.permissionId)
      .map((p) => ({ subjectId: r.subjectId, permission: p })),
  );
  const facts = { added, removed, operations };
  if (added.length === 0 && removed.length === 0) {
    return {
      change: 'unchanged',
      facts,
      inference: {
        confidence: 'high',
        explanation: 'No recorded permission difference for this focus.',
      },
    };
  }
  // Best-effort causal guess from recorded operations only.
  const target = added[0] ?? removed[0];
  const match = operations.find((op) => {
    if (target && 'permissionId' in op && 'roleId' in op)
      return op.permissionId === target.permission;
    if (target && 'roleId' in op && 'subjectId' in op)
      return (
        (op as { subjectId: string }).subjectId === target.subjectId ||
        (op as { roleId: string }).roleId !== undefined
      );
    return false;
  });
  if (!match) {
    return {
      change: added.length > 0 ? 'added' : 'removed',
      facts,
      inference: {
        confidence: 'low',
        evidence: 'missing',
        explanation:
          'Change is recorded, but no responsible operation is derivable from the saved operations.',
      },
    };
  }
  return {
    change: added.length > 0 ? 'added' : 'removed',
    facts,
    inference: {
      confidence: 'medium',
      responsibleOperation: match,
      explanation:
        'Best-effort match against recorded operations; verify before acting.',
    },
  };
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
    server.registerTool(
      'explain_access_change',
      {
        description:
          'Explain a recorded permission diff from a saved simulation. Returns { change, facts, inference }.',
        inputSchema: explainInputSchema,
      },
      async ({ apiKey, simulationId, subjectId, permissionId }) => {
        try {
          const ctx = await this.auth.verify(`Bearer ${apiKey}`);
          this.auth.requireScope(ctx, 'simulations:read');
          const report = await this.simulations.getReport(ctx, simulationId, {
            page: 1,
            pageSize: 100,
          });
          const impacts = (
            Array.isArray(report.impacts) ? report.impacts : []
          ) as ImpactRow[];
          const operations = ((report.provenance as { operations?: unknown })
            ?.operations ?? []) as ChangeOperation[];
          const result = {
            simulationId,
            ...explainDiff(impacts, operations, { subjectId, permissionId }),
            provenance: report.provenance,
          };
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

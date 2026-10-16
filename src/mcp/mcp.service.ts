/**
 * Step 40 — thin MCP adapter (NestJS module + stdio server factory).
 * Step 46 — transport security + identity mapping.
 *
 * SDK: `@modelcontextprotocol/server` v2 (official TypeScript SDK,
 * implements MCP spec 2026-07-28). Transport: stdio (`StdioServerTransport`
 * from `@modelcontextprotocol/server/stdio`) — the standard choice for a
 * local, self-hostable server process; no SSE/HTTP session handling needed.
 * Lifecycle: `NestFactory` boots `AppModule` (existing use cases);
 * `McpService.createServer()` builds an `McpServer` with no domain logic
 * inside transport handlers — tools registered in Steps 41+ call the same
 * application services as REST. Run: `npm run mcp:serve` (stdio).
 *
 * Auth model (same tenant/permissions model as REST): every protected tool
 * takes an `apiKey` argument, verified via `AuthService.verify` and mapped
 * to `{ tenantId, scopes }` — tenant IDs are NEVER accepted from tool
 * arguments. Each tool enforces its scope (`simulations:run`,
 * `simulations:read`, `models:read`); `validate_access_model` is
 * intentionally public (validates a caller-supplied snapshot, touches no
 * tenant data). Errors surface as safe `{ code, message }` results —
 * raw keys/digests never appear in outputs or logs.
 *
 * Timeouts/input limits: tool handlers race use-case work against
 * `MCP_TOOL_TIMEOUT_MS` (default 30s); zod strict schemas bound argument
 * shapes (operations ≤ 200, escalation limit ≤ 50, compare sections ≤ 100
 * entries) so oversized payloads are rejected before any domain work.
 *
 * Local stdio trust assumption: stdio has no transport-level auth — the
 * OS user launching `npm run mcp:serve` can speak to the pipe. The API key
 * argument is therefore still required: it provides tenant identity +
 * scope checks identical to REST. Do not run the stdio server as a
 * multi-user shared process; one invocation per tenant operator.
 */
import { Inject, Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { AppError } from '../common/errors/app-error';
import { AuthService } from '../auth/auth.service';
import { validateSnapshot } from '../models/validate-snapshot';
import { createSimulationBodySchema } from '../simulations/simulations.dto';
import { assertModelInTenant } from '../tenancy/tenant-scope';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  ACCESS_MODEL_REPOSITORY as AMR,
  MODEL_VERSION_REPOSITORY as MVR,
} from '../repositories/tokens';
import type { AccessModelRepository } from '../repositories/access-model.repository';
import type { ModelVersionRepository } from '../repositories/model-version.repository';
import type { AccessModelSnapshot } from '../domain/access-model';
import type { ChangeOperation } from '../domain/operations';
import type { RiskFinding } from '../domain/findings';
import { resolveAllSubjects } from '../domain/resolve-permissions';
import { simulateWithFindings } from '../domain/risk-rules';
import { SimulationsService } from '../simulations/simulations.service';

/** Tool-handler timeout (ms); prevents a hung use case from wedging stdio. */
export const MCP_TOOL_TIMEOUT_MS = Number(
  process.env.MCP_TOOL_TIMEOUT_MS ?? 30000,
);

export class McpTimeoutError extends Error {
  constructor() {
    super('Tool execution timed out.');
    this.name = 'McpTimeoutError';
  }
}

/** Race use-case work against the tool timeout; AppError-safe on expiry. */
export async function withToolTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new McpTimeoutError()),
      MCP_TOOL_TIMEOUT_MS,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  if (err instanceof McpTimeoutError)
    return { code: 'internal_error', message: 'Tool execution timed out.' };
  throw err;
}

/** Strip key material from any value before it reaches logs/outputs. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(/ppk_[A-Za-z0-9_-]+/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        /api[_-]?key|digest|secret|token/i.test(k) && typeof v === 'string'
          ? '[REDACTED]'
          : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/** Authenticate a tool call: apiKey → tenant context (never from args). */
export async function authenticateTool(
  auth: AuthService,
  apiKey: string,
  scope: 'simulations:run' | 'simulations:read' | 'models:read',
): Promise<TenantContext> {
  const ctx = await withToolTimeout(auth.verify(`Bearer ${apiKey}`));
  auth.requireScope(ctx, scope);
  return ctx;
}

/** Max findings returned per call (bounded output). */
export const MAX_ESCALATION_FINDINGS = 50;

/** Strict input: saved simulation OR inline snapshot+operations. */
const escalationBaseSchema = z
  .object({
    apiKey: z.string().min(1).max(256),
    simulationId: z
      .string()
      .regex(/^sim_[A-Za-z0-9_-]{1,120}$/)
      .optional(),
    snapshot: z.record(z.string(), z.unknown()).optional(),
    operations: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(200)
      .optional(),
    limit: z.number().int().min(1).max(MAX_ESCALATION_FINDINGS).default(20),
  })
  .strict();

/** Refined variant (either simulationId or snapshot+operations required). */
export const escalationInputSchema = escalationBaseSchema.refine(
  (v) => v.simulationId ?? (v.snapshot && v.operations),
  { message: 'Provide simulationId or snapshot+operations.' },
);

export type EscalationHit = {
  ruleId: string;
  severity: string;
  subjects: unknown;
  evidence: unknown;
};

/**
 * Step 44 — `find_privilege_escalation` MCP tool.
 * Thin handler: `simulations:read` scope; saved-simulation path reuses the
 * persisted REST findings (parity); inline path re-runs the same
 * deterministic `simulateWithFindings` domain rules REST uses. Output is
 * bounded (`limit`, max 50) and only flags configured risky patterns —
 * plain grants are not labelled vulnerabilities.
 */
export function toEscalationHits(
  findings: RiskFinding[],
  limit: number,
): EscalationHit[] {
  return findings
    .filter((f) => f.ruleId !== 'UNEXPECTED_SUBJECT_IMPACT')
    .slice(0, Math.min(limit, MAX_ESCALATION_FINDINGS))
    .map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      subjects: f.subjects,
      evidence: f.evidence,
    }));
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

/** Max diff entries per section (bounded output). */
export const MAX_COMPARE_ENTRIES = 100;

/** Strict input: two authorised model versions + options. */
const compareInputSchema = z
  .object({
    apiKey: z.string().min(1).max(256),
    modelId: z.string().regex(/^mdl_[A-Za-z0-9_-]{1,120}$/),
    fromVersion: z.number().int().min(1),
    toVersion: z.number().int().min(1),
    includeEffectiveAccess: z.boolean().default(false),
  })
  .strict();

function idSet(ids: readonly { id: string }[]): Set<string> {
  return new Set(ids.map((e) => e.id));
}

function pairSet(rows: readonly { [key: string]: string }[]): Set<string> {
  return new Set(rows.map((r) => `${r.a}|${r.b}`));
}

function bindPairs(
  rows: readonly { roleId: string; permissionId: string }[],
): { a: string; b: string }[] {
  return rows.map((r) => ({ a: r.roleId, b: r.permissionId }));
}

function assignPairs(
  rows: readonly { subjectId: string; roleId: string }[],
): { a: string; b: string }[] {
  return rows.map((r) => ({ a: r.subjectId, b: r.roleId }));
}

/**
 * Step 45 — `compare_access_models` MCP tool.
 * Thin handler: `models:read` scope; loads both snapshots through the same
 * tenant-scoped version repository REST reads (cross-tenant → not_found),
 * validates both with the shared validator, diffs roles/permissions/
 * bindings/assignments, and optionally resolves subject-level effective
 * access via the existing `resolveAllSubjects` domain service. Bounded
 * output (100 entries/section); identical snapshots → empty diffs.
 */
export function diffSnapshots(
  a: AccessModelSnapshot,
  b: AccessModelSnapshot,
): Record<string, string[]> {
  const diff = (x: Set<string>, y: Set<string>): string[] =>
    [...y]
      .filter((v) => !x.has(v))
      .sort()
      .slice(0, MAX_COMPARE_ENTRIES);
  const aRoles = idSet(a.roles);
  const bRoles = idSet(b.roles);
  const aPerms = idSet(a.permissions);
  const bPerms = idSet(b.permissions);
  const aBind = pairSet(bindPairs(a.bindings));
  const bBind = pairSet(bindPairs(b.bindings));
  const aAssign = pairSet(assignPairs(a.assignments));
  const bAssign = pairSet(assignPairs(b.assignments));
  return {
    addedRoles: diff(aRoles, bRoles),
    removedRoles: diff(bRoles, aRoles),
    addedPermissions: diff(aPerms, bPerms),
    removedPermissions: diff(bPerms, aPerms),
    addedBindings: diff(aBind, bBind),
    removedBindings: diff(bBind, aBind),
    addedAssignments: diff(aAssign, bAssign),
    removedAssignments: diff(bAssign, aAssign),
  };
}

export function effectiveAccessDiff(
  a: AccessModelSnapshot,
  b: AccessModelSnapshot,
): { subjectId: string; added: string[]; removed: string[] }[] {
  const ra = resolveAllSubjects(a);
  const rb = resolveAllSubjects(b);
  const ids = new Set([...ra.keys(), ...rb.keys()]);
  const out: { subjectId: string; added: string[]; removed: string[] }[] = [];
  for (const id of [...ids].sort()) {
    const before = new Set(ra.get(id) ?? []);
    const after = new Set(rb.get(id) ?? []);
    const added = [...after].filter((p) => !before.has(p)).sort();
    const removed = [...before].filter((p) => !after.has(p)).sort();
    if (added.length > 0 || removed.length > 0)
      out.push({ subjectId: id, added, removed });
    if (out.length >= MAX_COMPARE_ENTRIES) break;
  }
  return out;
}

async function loadSnapshot(
  models: AccessModelRepository,
  versions: ModelVersionRepository,
  ctx: TenantContext,
  modelId: string,
  version: number,
): Promise<AccessModelSnapshot> {
  const model = await models.findById(ctx.tenantId, modelId);
  assertModelInTenant(model, ctx.tenantId);
  const ver = await versions.findByModelVersion(
    ctx.tenantId,
    model.id,
    version,
  );
  if (!ver || ver.modelId !== model.id)
    throw new AppError('not_found', 'Model version not found.');
  return validateSnapshot(ver.snapshot);
}

@Injectable()
export class McpService {
  constructor(
    private readonly auth: AuthService,
    @Inject(AMR) private readonly models: AccessModelRepository,
    @Inject(MVR) private readonly versions: ModelVersionRepository,
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
          const ctx = await authenticateTool(
            this.auth,
            apiKey,
            'simulations:run',
          );
          const result = await withToolTimeout(
            this.simulations.createSimulation(ctx, body),
          );
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
          const ctx = await authenticateTool(
            this.auth,
            apiKey,
            'simulations:read',
          );
          const report = await withToolTimeout(
            this.simulations.getReport(ctx, simulationId, {
              page: 1,
              pageSize: 100,
            }),
          );
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
    server.registerTool(
      'find_privilege_escalation',
      {
        description:
          'Find risky privilege-escalation patterns from a saved simulation or inline snapshot+operations. Returns { findings }.',
        inputSchema: escalationBaseSchema,
      },
      async ({ apiKey, simulationId, snapshot, operations, limit }) => {
        const text = (result: unknown) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        });
        const fail = (err: unknown) => ({
          ...text(toMcpError(err)),
          isError: true as const,
        });
        try {
          const ctx = await authenticateTool(
            this.auth,
            apiKey,
            'simulations:read',
          );
          if (!simulationId && !(snapshot && operations)) {
            return fail(
              new AppError(
                'validation_failed',
                'Provide simulationId or snapshot+operations.',
              ),
            );
          }
          if (simulationId) {
            // Parity path: same persisted findings REST reports.
            const report = await withToolTimeout(
              this.simulations.getReport(ctx, simulationId, {
                page: 1,
                pageSize: 100,
              }),
            );
            const stored = (
              Array.isArray(report.findings) ? report.findings : []
            ) as RiskFinding[];
            return text({
              simulationId,
              findings: toEscalationHits(stored, limit ?? 20),
            });
          }
          // Inline path: same deterministic domain rules REST simulates with.
          let snap;
          try {
            snap = validateSnapshot(snapshot);
          } catch (err) {
            return fail(err);
          }
          try {
            const sim = simulateWithFindings(
              snap,
              (operations ?? []) as ChangeOperation[],
            );
            return text({
              findings: toEscalationHits([...sim.findings], limit ?? 20),
            });
          } catch (err) {
            return fail(err);
          }
        } catch (err) {
          return fail(err);
        }
      },
    );
    server.registerTool(
      'compare_access_models',
      {
        description:
          'Compare two authorised model versions. Returns { differences, effectiveAccess? }.',
        inputSchema: compareInputSchema,
      },
      async ({
        apiKey,
        modelId,
        fromVersion,
        toVersion,
        includeEffectiveAccess,
      }) => {
        const text = (result: unknown) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        });
        const fail = (err: unknown) => ({
          ...text(toMcpError(err)),
          isError: true as const,
        });
        try {
          const ctx = await authenticateTool(this.auth, apiKey, 'models:read');
          const [from, to] = await withToolTimeout(
            Promise.all([
              loadSnapshot(
                this.models,
                this.versions,
                ctx,
                modelId,
                fromVersion,
              ),
              loadSnapshot(this.models, this.versions, ctx, modelId, toVersion),
            ]),
          );
          const result: Record<string, unknown> = {
            modelId,
            fromVersion,
            toVersion,
            differences: diffSnapshots(from, to),
          };
          if (includeEffectiveAccess)
            result.effectiveAccess = effectiveAccessDiff(from, to);
          return text(result);
        } catch (err) {
          return fail(err);
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

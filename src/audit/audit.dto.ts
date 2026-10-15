import { z } from 'zod';

export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    type: z
      .enum([
        'MODEL_CREATED',
        'MODEL_VERSION_CREATED',
        'SIMULATION_CREATED',
        'SIMULATION_FAILED',
        'API_KEY_ISSUED',
        'API_KEY_REVOKED',
        'API_KEY_EXPIRED',
        'REPORT_EXPORTED',
      ])
      .optional(),
  })
  .strict();

export type AuditQuery = z.infer<typeof auditQuerySchema>;

import { z } from 'zod';

const snapshotSchema = z
  .object({
    roles: z.array(z.record(z.string(), z.unknown())).default([]),
    permissions: z.array(z.record(z.string(), z.unknown())).default([]),
    bindings: z.array(z.record(z.string(), z.unknown())).default([]),
    inheritance: z.array(z.record(z.string(), z.unknown())).default([]),
    assignments: z.array(z.record(z.string(), z.unknown())).default([]),
    subjects: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .strict()
  .catchall(z.unknown());

export const createModelBodySchema = z
  .object({ name: z.string().min(1).max(100), snapshot: snapshotSchema })
  .strict();

export type CreateModelBody = z.infer<typeof createModelBodySchema>;

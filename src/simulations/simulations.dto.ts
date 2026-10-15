import { z } from 'zod';

const idString = z.string().min(1).max(128);

const grantSchema = z
  .object({
    type: z.literal('grant_permission'),
    roleId: idString,
    permissionId: idString,
  })
  .strict();
const revokeSchema = z
  .object({
    type: z.literal('revoke_permission'),
    roleId: idString,
    permissionId: idString,
  })
  .strict();
const assignSchema = z
  .object({
    type: z.literal('assign_role'),
    subjectId: idString,
    roleId: idString,
  })
  .strict();
const unassignSchema = z
  .object({
    type: z.literal('unassign_role'),
    subjectId: idString,
    roleId: idString,
  })
  .strict();
const addInhSchema = z
  .object({
    type: z.literal('add_inheritance'),
    childRoleId: idString,
    parentRoleId: idString,
  })
  .strict();
const removeInhSchema = z
  .object({
    type: z.literal('remove_inheritance'),
    childRoleId: idString,
    parentRoleId: idString,
  })
  .strict();

export const createSimulationBodySchema = z
  .object({
    modelId: z.string().regex(/^mdl_[A-Za-z0-9_-]{1,120}$/),
    version: z.number().int().min(1).optional(),
    operations: z
      .array(
        z.discriminatedUnion('type', [
          grantSchema,
          revokeSchema,
          assignSchema,
          unassignSchema,
          addInhSchema,
          removeInhSchema,
        ]),
      )
      .min(1)
      .max(200),
    idempotencyKey: z.string().min(1).max(128).optional(),
  })
  .strict();

export type CreateSimulationBody = z.infer<typeof createSimulationBodySchema>;

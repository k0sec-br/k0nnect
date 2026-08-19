import { z } from 'zod';

export const userIdSchema = z.string().uuid();
export const conversationIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/u);
export const groupNameSchema = z.string().trim().min(1).max(40);

export const friendRequestSchema = z
  .object({ username: z.string().trim().min(3).max(24) })
  .strict();
export const friendUserSchema = z.object({ userId: userIdSchema }).strict();
export const groupCreateSchema = z
  .object({ name: groupNameSchema, memberIds: z.array(userIdSchema).max(19).default([]) })
  .strict();
export const groupRenameSchema = z.object({ name: groupNameSchema }).strict();
export const groupMemberSchema = z.object({ userId: userIdSchema }).strict();
export const groupTransferSchema = z.object({ newOwnerId: userIdSchema }).strict();
export const messageEditSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(2000)
      .refine((content) => content.trim().length > 0),
  })
  .strict();

export const historyQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

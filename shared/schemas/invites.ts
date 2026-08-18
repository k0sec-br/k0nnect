import { z } from 'zod';

export const createInviteSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();

export const inviteIdSchema = z.string().uuid();

import { z } from 'zod';

import { RESERVED_USERNAMES, USER_ROLES } from '../constants/security';

const reservedUsernames = new Set<string>(RESERVED_USERNAMES);

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9._-]+$/i)
  .transform((username) => username.toLowerCase())
  .refine((username) => !reservedUsernames.has(username));

export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((displayName) => !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(displayName));
export const passwordSchema = z.string().min(12).max(128);
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const recoveryCodeSchema = z.string().regex(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){7}$/);
export const turnstileTokenSchema = z.string().min(1).max(2_048);

export const registerInviteSchema = z
  .object({
    inviteToken: inviteTokenSchema,
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    turnstileToken: turnstileTokenSchema.optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    turnstileToken: turnstileTokenSchema.optional(),
  })
  .strict();

export const recoverAccountSchema = z
  .object({
    username: usernameSchema,
    recoveryCode: recoveryCodeSchema,
    newPassword: passwordSchema,
    turnstileToken: turnstileTokenSchema.optional(),
  })
  .strict();

export const regenerateRecoveryCodesSchema = z.object({ password: passwordSchema }).strict();

export const inviteRoleSchema = z.enum(USER_ROLES);

export type RegisterInviteInput = z.infer<typeof registerInviteSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RecoverAccountInput = z.infer<typeof recoverAccountSchema>;

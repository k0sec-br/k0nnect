import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import {
  conversationIdSchema,
  friendRequestSchema,
  friendUserSchema,
  groupCreateSchema,
  groupMemberSchema,
  groupRenameSchema,
  groupTransferSchema,
  historyQuerySchema,
  messageEditSchema,
} from '../../shared/schemas/social';
import { requireSession, verifyCsrf } from '../auth/session';
import type { AppBindings } from '../app-types';
import { AppError } from '../errors/app-error';
import { parseJson, success } from '../http';
import { listConversationHistory } from '../repositories/social';
import { enforceRateLimit, RATE_LIMIT_POLICIES } from '../security/rate-limit';
import {
  acceptFriend,
  addGroupMember,
  createGroup,
  deleteGroup,
  deleteMessage,
  editMessage,
  findSocialUser,
  leaveGroup,
  removeFriend,
  removeGroupMember,
  renameGroup,
  requestFriend,
  transferGroup,
} from '../services/social-service';

export const socialRoutes = new Hono<AppBindings>();

socialRoutes.use(
  '*',
  createMiddleware<AppBindings>(async (context, next) => {
    context.set('authenticated', await requireSession(context));
    await next();
  }),
);

async function authorizeMutation(context: Parameters<typeof verifyCsrf>[0]) {
  const authenticated = context.get('authenticated');
  await verifyCsrf(context, authenticated);
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.socialMutation);
  return authenticated;
}

function conversationId(context: { req: { param(name: string): string } }): string {
  const parsed = conversationIdSchema.safeParse(context.req.param('conversationId'));
  if (!parsed.success) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  return parsed.data;
}

function messageId(context: { req: { param(name: string): string } }): number {
  const parsed = z.coerce.number().int().positive().safeParse(context.req.param('messageId'));
  if (!parsed.success) throw new AppError('MESSAGE_UNAVAILABLE', 404);
  return parsed.data;
}

socialRoutes.get('/users/:username', async (context) => {
  const authenticated = context.get('authenticated');
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.userSearch);
  const username = context.req.param('username');
  if (!/^[a-z0-9._-]{3,24}$/u.test(username)) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const user = await findSocialUser(context.env.DB, username, authenticated.user.id);
  if (!user) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  return success(context, { user });
});

socialRoutes.post('/friends', async (context) => {
  const authenticated = await authorizeMutation(context);
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.friendRequest);
  const input = await parseJson(context, friendRequestSchema);
  const social = await requestFriend(context.env, authenticated.user.id, input.username);
  return success(context, { requested: true, social }, 201);
});

socialRoutes.post('/friends/:userId/accept', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = friendUserSchema.safeParse({ userId: context.req.param('userId') });
  if (!input.success) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const social = await acceptFriend(context.env, authenticated.user.id, input.data.userId);
  return success(context, { accepted: true, social });
});

socialRoutes.delete('/friends/:userId', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = friendUserSchema.safeParse({ userId: context.req.param('userId') });
  if (!input.success) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const social = await removeFriend(context.env, authenticated.user.id, input.data.userId);
  return success(context, { removed: true, social });
});

socialRoutes.post('/groups', async (context) => {
  const authenticated = await authorizeMutation(context);
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.groupCreate);
  const input = await parseJson(context, groupCreateSchema);
  const created = await createGroup(
    context.env,
    authenticated.user.id,
    input.name,
    input.memberIds,
  );
  return success(context, created, 201);
});

socialRoutes.post('/groups/:conversationId/rename', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = await parseJson(context, groupRenameSchema);
  const social = await renameGroup(
    context.env,
    authenticated.user.id,
    conversationId(context),
    input.name,
  );
  return success(context, { renamed: true, social });
});

socialRoutes.post('/groups/:conversationId/members', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = await parseJson(context, groupMemberSchema);
  const social = await addGroupMember(
    context.env,
    authenticated.user.id,
    conversationId(context),
    input.userId,
  );
  return success(context, { added: true, social }, 201);
});

socialRoutes.delete('/groups/:conversationId/members/:userId', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = friendUserSchema.safeParse({ userId: context.req.param('userId') });
  if (!input.success) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const social = await removeGroupMember(
    context.env,
    authenticated.user.id,
    conversationId(context),
    input.data.userId,
  );
  return success(context, { removed: true, social });
});

socialRoutes.post('/groups/:conversationId/transfer', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = await parseJson(context, groupTransferSchema);
  const social = await transferGroup(
    context.env,
    authenticated.user.id,
    conversationId(context),
    input.newOwnerId,
  );
  return success(context, { transferred: true, social });
});

socialRoutes.post('/groups/:conversationId/leave', async (context) => {
  const authenticated = await authorizeMutation(context);
  const social = await leaveGroup(context.env, authenticated.user.id, conversationId(context));
  return success(context, { left: true, social });
});

socialRoutes.delete('/groups/:conversationId', async (context) => {
  const authenticated = await authorizeMutation(context);
  const social = await deleteGroup(context.env, authenticated.user.id, conversationId(context));
  return success(context, { deleted: true, social });
});

socialRoutes.get('/conversations/:conversationId/messages', async (context) => {
  const authenticated = context.get('authenticated');
  const query = historyQuerySchema.safeParse(context.req.query());
  if (!query.success) throw new AppError('VALIDATION_ERROR', 400);
  await enforceRateLimit(context.env, authenticated.user.id, RATE_LIMIT_POLICIES.chatHistory);
  const messages = await listConversationHistory(
    context.env.DB,
    conversationId(context),
    authenticated.user.id,
    query.data.before,
    query.data.limit,
  );
  if (!messages) throw new AppError('FORBIDDEN', 403);
  return success(context, { messages });
});

socialRoutes.post('/messages/:messageId', async (context) => {
  const authenticated = await authorizeMutation(context);
  const input = await parseJson(context, messageEditSchema);
  return success(context, {
    message: await editMessage(
      context.env,
      authenticated.user.id,
      messageId(context),
      input.content,
    ),
  });
});

socialRoutes.delete('/messages/:messageId', async (context) => {
  const authenticated = await authorizeMutation(context);
  return success(context, {
    message: await deleteMessage(context.env, authenticated.user.id, messageId(context)),
  });
});

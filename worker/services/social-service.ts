import type { ChatMessageView, SocialStateView, SocialUserView } from '../../shared/types/api';
import { sha256 } from '../crypto/tokens';
import type { ServerRealtime } from '../durable/server-realtime';
import { AppError } from '../errors/app-error';

const PRIMARY_SERVER_ID = 'k0sec';

function pair(userId: string, peerId: string): [string, string] {
  return userId < peerId ? [userId, peerId] : [peerId, userId];
}

function server(env: Env): DurableObjectStub<ServerRealtime> {
  return env.SERVER_REALTIME.getByName(PRIMARY_SERVER_ID);
}

async function notifySocial(
  env: Env,
  userIds: string[],
  reason: 'friends' | 'groups' | 'conversations',
) {
  return server(env).refreshSocialState([...new Set(userIds)], reason);
}

function stateFor(states: Record<string, SocialStateView>, userId: string): SocialStateView {
  const state = states[userId];
  if (!state) throw new AppError('INTERNAL_ERROR', 500);
  return state;
}

export async function findSocialUser(
  database: D1Database,
  username: string,
  requestingUserId: string,
): Promise<SocialUserView | null> {
  const row = await database
    .prepare(
      `SELECT id, username, display_name FROM users
       WHERE username = ? COLLATE NOCASE AND status = 'active' AND id <> ? LIMIT 1`,
    )
    .bind(username, requestingUserId)
    .first<{ id: string; username: string; display_name: string }>();
  return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
}

export async function requestFriend(
  env: Env,
  userId: string,
  username: string,
): Promise<SocialStateView> {
  const target = await findSocialUser(env.DB, username, userId);
  if (!target) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const [lowId, highId] = pair(userId, target.id);
  const result = await env.DB.prepare(
    `INSERT INTO friendships (
       user_low_id, user_high_id, requested_by, status, created_at, responded_at
     ) VALUES (?, ?, ?, 'pending', ?, NULL)
     ON CONFLICT(user_low_id, user_high_id) DO NOTHING`,
  )
    .bind(lowId, highId, userId, new Date().toISOString())
    .run();
  if (result.meta.changes !== 1) throw new AppError('SOCIAL_UNAVAILABLE', 409);
  return stateFor(await notifySocial(env, [userId, target.id], 'friends'), userId);
}

export async function acceptFriend(
  env: Env,
  userId: string,
  peerId: string,
): Promise<SocialStateView> {
  const [lowId, highId] = pair(userId, peerId);
  const result = await env.DB.prepare(
    `UPDATE friendships SET status = 'accepted', responded_at = ?
     WHERE user_low_id = ? AND user_high_id = ? AND status = 'pending' AND requested_by = ?`,
  )
    .bind(new Date().toISOString(), lowId, highId, peerId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  return stateFor(await notifySocial(env, [userId, peerId], 'friends'), userId);
}

export async function removeFriend(
  env: Env,
  userId: string,
  peerId: string,
): Promise<SocialStateView> {
  const [lowId, highId] = pair(userId, peerId);
  const result = await env.DB.prepare(
    'DELETE FROM friendships WHERE user_low_id = ? AND user_high_id = ?',
  )
    .bind(lowId, highId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  return stateFor(await notifySocial(env, [userId, peerId], 'friends'), userId);
}

async function acceptedFriendIds(
  database: D1Database,
  userId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const placeholders = candidateIds.map(() => '?').join(', ');
  const result = await database
    .prepare(
      `SELECT CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END AS friend_id
       FROM friendships f
       JOIN users peer ON peer.id = CASE
         WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
       WHERE f.status = 'accepted' AND peer.status = 'active'
         AND (f.user_low_id = ? OR f.user_high_id = ?)
         AND CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
           IN (${placeholders})`,
    )
    .bind(userId, userId, userId, userId, userId, ...candidateIds)
    .all<{ friend_id: string }>();
  return new Set(result.results.map((row) => row.friend_id));
}

export async function createGroup(
  env: Env,
  ownerId: string,
  name: string,
  requestedMemberIds: string[],
): Promise<{ id: string; social: SocialStateView }> {
  const memberIds = [...new Set(requestedMemberIds)].filter((id) => id !== ownerId);
  if (memberIds.length > 19) throw new AppError('VALIDATION_ERROR', 400);
  const friends = await acceptedFriendIds(env.DB, ownerId, memberIds);
  if (friends.size !== memberIds.length) throw new AppError('FORBIDDEN', 403);
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const conversationId = `group_${suffix}`;
  const roomId = `call_${suffix}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rooms (id, slug, name, kind, position, created_at)
       VALUES (?, ?, ?, 'voice', 0, ?)`,
    ).bind(roomId, conversationId, name, now),
    env.DB.prepare(
      `INSERT INTO conversations (
         id, kind, space_kind, name, owner_user_id, call_room_id,
         is_default, created_at, updated_at
       ) VALUES (?, 'group', 'group', ?, ?, ?, 0, ?, ?)`,
    ).bind(conversationId, name, ownerId, roomId, now, now),
    env.DB.prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
       VALUES (?, ?, 'owner', ?)`,
    ).bind(conversationId, ownerId, now),
    ...memberIds.map((memberId) =>
      env.DB.prepare(
        `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).bind(conversationId, memberId, now),
    ),
  ]);
  const states = await notifySocial(env, [ownerId, ...memberIds], 'groups');
  return { id: conversationId, social: stateFor(states, ownerId) };
}

export async function renameGroup(
  env: Env,
  ownerId: string,
  conversationId: string,
  name: string,
): Promise<SocialStateView> {
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE conversations SET name = ?, updated_at = ?
       WHERE id = ? AND kind = 'group' AND space_kind = 'group' AND owner_user_id = ?`,
    ).bind(name, now, conversationId, ownerId),
    env.DB.prepare(
      `UPDATE rooms SET name = ? WHERE id = (
         SELECT call_room_id FROM conversations
         WHERE id = ? AND kind = 'group' AND space_kind = 'group' AND owner_user_id = ?
       )`,
    ).bind(name, conversationId, ownerId),
  ]);
  if (results[0]?.meta.changes !== 1) throw new AppError('FORBIDDEN', 403);
  const members = await groupMemberIds(env.DB, conversationId);
  return stateFor(await notifySocial(env, members, 'groups'), ownerId);
}

async function groupMemberIds(database: D1Database, conversationId: string): Promise<string[]> {
  const result = await database
    .prepare(
      `SELECT user_id FROM conversation_members
       WHERE conversation_id = ? AND removed_at IS NULL`,
    )
    .bind(conversationId)
    .all<{ user_id: string }>();
  return result.results.map((row) => row.user_id);
}

async function requireGroupOwner(database: D1Database, conversationId: string, ownerId: string) {
  const group = await database
    .prepare(
      `SELECT id FROM conversations
       WHERE id = ? AND kind = 'group' AND space_kind = 'group' AND owner_user_id = ?`,
    )
    .bind(conversationId, ownerId)
    .first<{ id: string }>();
  if (!group) throw new AppError('FORBIDDEN', 403);
}

export async function addGroupMember(
  env: Env,
  ownerId: string,
  conversationId: string,
  memberId: string,
): Promise<SocialStateView> {
  await requireGroupOwner(env.DB, conversationId, ownerId);
  if (!(await acceptedFriendIds(env.DB, ownerId, [memberId])).has(memberId)) {
    throw new AppError('FORBIDDEN', 403);
  }
  const result = await env.DB.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
     SELECT ?, ?, 'member', ?
     WHERE (SELECT COUNT(*) FROM conversation_members
            WHERE conversation_id = ? AND removed_at IS NULL) < 20
     ON CONFLICT(conversation_id, user_id) DO UPDATE SET
       member_role = 'member', joined_at = excluded.joined_at, removed_at = NULL`,
  )
    .bind(conversationId, memberId, new Date().toISOString(), conversationId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('SOCIAL_UNAVAILABLE', 409);
  return stateFor(
    await notifySocial(env, await groupMemberIds(env.DB, conversationId), 'groups'),
    ownerId,
  );
}

export async function removeGroupMember(
  env: Env,
  ownerId: string,
  conversationId: string,
  memberId: string,
): Promise<SocialStateView> {
  await requireGroupOwner(env.DB, conversationId, ownerId);
  if (memberId === ownerId) throw new AppError('VALIDATION_ERROR', 400);
  const result = await env.DB.prepare(
    `UPDATE conversation_members SET removed_at = ?
     WHERE conversation_id = ? AND user_id = ? AND member_role = 'member'
       AND removed_at IS NULL`,
  )
    .bind(new Date().toISOString(), conversationId, memberId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  return stateFor(
    await notifySocial(
      env,
      [...(await groupMemberIds(env.DB, conversationId)), memberId],
      'groups',
    ),
    ownerId,
  );
}

export async function transferGroup(
  env: Env,
  ownerId: string,
  conversationId: string,
  newOwnerId: string,
): Promise<SocialStateView> {
  await requireGroupOwner(env.DB, conversationId, ownerId);
  const membership = await env.DB.prepare(
    `SELECT 1 AS member FROM conversation_members
     WHERE conversation_id = ? AND user_id = ? AND member_role = 'member'
       AND removed_at IS NULL`,
  )
    .bind(conversationId, newOwnerId)
    .first<{ member: number }>();
  if (!membership) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE conversations SET owner_user_id = ?, updated_at = ? WHERE id = ?').bind(
      newOwnerId,
      now,
      conversationId,
    ),
    env.DB.prepare(
      `UPDATE conversation_members SET member_role = CASE
         WHEN user_id = ? THEN 'owner' ELSE 'member' END
       WHERE conversation_id = ? AND user_id IN (?, ?) AND removed_at IS NULL`,
    ).bind(newOwnerId, conversationId, ownerId, newOwnerId),
  ]);
  return stateFor(
    await notifySocial(env, await groupMemberIds(env.DB, conversationId), 'groups'),
    ownerId,
  );
}

export async function leaveGroup(
  env: Env,
  userId: string,
  conversationId: string,
): Promise<SocialStateView> {
  const result = await env.DB.prepare(
    `UPDATE conversation_members SET removed_at = ?
     WHERE conversation_id = ? AND user_id = ? AND member_role = 'member'
       AND removed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM conversations
         WHERE id = ? AND kind = 'group' AND space_kind = 'group'
       )`,
  )
    .bind(new Date().toISOString(), conversationId, userId, conversationId)
    .run();
  if (result.meta.changes !== 1) throw new AppError('FORBIDDEN', 403);
  return stateFor(
    await notifySocial(env, [...(await groupMemberIds(env.DB, conversationId)), userId], 'groups'),
    userId,
  );
}

export async function deleteGroup(
  env: Env,
  ownerId: string,
  conversationId: string,
): Promise<SocialStateView> {
  await requireGroupOwner(env.DB, conversationId, ownerId);
  const members = await groupMemberIds(env.DB, conversationId);
  const group = await env.DB.prepare('SELECT call_room_id FROM conversations WHERE id = ?')
    .bind(conversationId)
    .first<{ call_room_id: string }>();
  if (!group) throw new AppError('SOCIAL_UNAVAILABLE', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(conversationId),
    env.DB.prepare('DELETE FROM conversations WHERE id = ? AND owner_user_id = ?').bind(
      conversationId,
      ownerId,
    ),
    env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(group.call_room_id),
  ]);
  return stateFor(await notifySocial(env, members, 'groups'), ownerId);
}

export async function editMessage(
  env: Env,
  userId: string,
  messageId: number,
  content: string,
): Promise<ChatMessageView> {
  const editedAt = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE messages SET content = ?, edited_at = ?
     WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM conversation_members cm
         WHERE cm.conversation_id = messages.conversation_id AND cm.user_id = ?
           AND cm.removed_at IS NULL
       )
     RETURNING id, conversation_id, sender_id, client_message_id, content,
               created_at, edited_at, deleted_at`,
  )
    .bind(content, editedAt, messageId, userId, userId)
    .first<{
      id: number;
      conversation_id: string;
      sender_id: string;
      client_message_id: string;
      content: string;
      created_at: string;
      edited_at: string;
      deleted_at: null;
    }>();
  if (!row) throw new AppError('MESSAGE_UNAVAILABLE', 404);
  const message = {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
  await server(env).announceChatUpdate(message);
  return message;
}

export async function deleteMessage(
  env: Env,
  userId: string,
  messageId: number,
): Promise<ChatMessageView> {
  const deletedAt = new Date().toISOString();
  const row = await env.DB.prepare(
    `UPDATE messages SET content = NULL, deleted_at = ?
     WHERE id = ? AND sender_id = ? AND deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM conversation_members cm
         WHERE cm.conversation_id = messages.conversation_id AND cm.user_id = ?
           AND cm.removed_at IS NULL
       )
     RETURNING id, conversation_id, sender_id, client_message_id, created_at, edited_at`,
  )
    .bind(deletedAt, messageId, userId, userId)
    .first<{
      id: number;
      conversation_id: string;
      sender_id: string;
      client_message_id: string;
      created_at: string;
      edited_at: string | null;
    }>();
  if (!row) throw new AppError('MESSAGE_UNAVAILABLE', 404);
  const message = {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    content: null,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt,
  };
  await server(env).announceChatUpdate(message);
  return message;
}

export async function deterministicDmId(userId: string, peerId: string): Promise<string> {
  const [lowId, highId] = pair(userId, peerId);
  return `dm_${await sha256(`${lowId}:${highId}`)}`;
}

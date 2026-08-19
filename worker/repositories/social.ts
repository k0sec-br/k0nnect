import type {
  ChatMessageView,
  ConversationSummary,
  FriendRequestView,
  FriendView,
  SocialUserView,
} from '../../shared/types/api';

interface FriendRow {
  id: string;
  username: string;
  display_name: string;
  status: 'pending' | 'accepted';
  requested_by: string;
  created_at: string;
  responded_at: string | null;
}

interface ConversationRow {
  id: string;
  kind: 'dm' | 'group';
  name: string | null;
  owner_user_id: string | null;
  call_room_id: string | null;
  is_default: number;
  last_message_id: number | null;
  last_sender_id: string | null;
  last_created_at: string | null;
  last_deleted_at: string | null;
}

interface ConversationMemberRow {
  conversation_id: string;
  id: string;
  username: string;
  display_name: string;
}

export async function listSocialBootstrap(
  database: D1Database,
  userId: string,
): Promise<{
  friends: FriendView[];
  friendRequests: FriendRequestView[];
  conversations: ConversationSummary[];
}> {
  const socialResults = await database.batch([
    database
      .prepare(
        `SELECT u.id, u.username, u.display_name, f.status, f.requested_by,
                f.created_at, f.responded_at
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
         WHERE (f.user_low_id = ? OR f.user_high_id = ?) AND u.status = 'active'
         ORDER BY f.created_at DESC`,
      )
      .bind(userId, userId, userId),
    database
      .prepare(
        `SELECT c.id, c.kind, c.name, c.owner_user_id, c.call_room_id, c.is_default,
                m.id AS last_message_id, m.sender_id AS last_sender_id,
                m.created_at AS last_created_at,
                m.deleted_at AS last_deleted_at
         FROM conversation_members own
         JOIN conversations c ON c.id = own.conversation_id
         LEFT JOIN messages m ON m.id = (
           SELECT latest.id FROM messages latest
           WHERE latest.conversation_id = c.id ORDER BY latest.id DESC LIMIT 1
         )
         WHERE own.user_id = ? AND own.removed_at IS NULL
         ORDER BY COALESCE(m.id, 0) DESC, c.is_default DESC, c.created_at DESC`,
      )
      .bind(userId),
    database
      .prepare(
        `SELECT cm.conversation_id, u.id, u.username, u.display_name
         FROM conversation_members own
         JOIN conversation_members cm ON cm.conversation_id = own.conversation_id
         JOIN users u ON u.id = cm.user_id
         WHERE own.user_id = ? AND own.removed_at IS NULL AND cm.removed_at IS NULL
           AND u.status = 'active'
         ORDER BY cm.joined_at ASC`,
      )
      .bind(userId),
  ]);
  const friendResult = socialResults[0]!;
  const conversationResult = socialResults[1]!;
  const memberResult = socialResults[2]!;

  const friendRows = (friendResult.results ?? []) as unknown as FriendRow[];
  const friends = friendRows
    .filter((row) => row.status === 'accepted')
    .map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      since: row.responded_at ?? row.created_at,
    }));
  const friendRequests = friendRows
    .filter((row) => row.status === 'pending')
    .map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      direction: row.requested_by === userId ? ('outgoing' as const) : ('incoming' as const),
      createdAt: row.created_at,
    }));
  const membersByConversation = new Map<string, SocialUserView[]>();
  for (const row of (memberResult.results ?? []) as unknown as ConversationMemberRow[]) {
    const members = membersByConversation.get(row.conversation_id) ?? [];
    members.push({ id: row.id, username: row.username, displayName: row.display_name });
    membersByConversation.set(row.conversation_id, members);
  }
  const conversations = ((conversationResult.results ?? []) as unknown as ConversationRow[]).map(
    (row) => {
      const members = membersByConversation.get(row.id) ?? [];
      const peer = members.find((member) => member.id !== userId);
      return {
        id: row.id,
        kind: row.kind,
        name: row.kind === 'dm' ? (peer?.displayName ?? 'Conversa') : (row.name ?? 'Grupo'),
        ownerUserId: row.owner_user_id,
        callRoomId: row.call_room_id,
        isDefault: row.is_default === 1,
        members,
        lastMessage:
          row.last_message_id && row.last_sender_id && row.last_created_at
            ? {
                id: row.last_message_id,
                senderId: row.last_sender_id,
                createdAt: row.last_created_at,
                deleted: row.last_deleted_at !== null,
              }
            : null,
      };
    },
  );
  return { friends, friendRequests, conversations };
}

export async function listConversationHistory(
  database: D1Database,
  conversationId: string,
  userId: string,
  before: number | undefined,
  limit: number,
): Promise<ChatMessageView[] | null> {
  const result = await database
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.content,
              m.created_at, m.edited_at, m.deleted_at
       FROM conversation_members own
       JOIN messages m ON m.conversation_id = own.conversation_id
       WHERE own.conversation_id = ? AND own.user_id = ? AND own.removed_at IS NULL
         AND (? IS NULL OR m.id < ?)
       ORDER BY m.id DESC LIMIT ?`,
    )
    .bind(conversationId, userId, before ?? null, before ?? null, limit)
    .all<{
      id: number;
      conversation_id: string;
      sender_id: string;
      client_message_id: string;
      content: string | null;
      created_at: string;
      edited_at: string | null;
      deleted_at: string | null;
    }>();
  if (result.results.length === 0) {
    const membership = await database
      .prepare(
        `SELECT 1 AS allowed FROM conversation_members
         WHERE conversation_id = ? AND user_id = ? AND removed_at IS NULL`,
      )
      .bind(conversationId, userId)
      .first<{ allowed: number }>();
    if (!membership) return null;
  }
  return result.results.reverse().map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    content: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  }));
}

export async function loadRealtimeCapabilities(database: D1Database, userId: string) {
  const capabilityResults = await database.batch([
    database
      .prepare(
        `SELECT cm.conversation_id, c.call_room_id, c.kind,
                CASE WHEN c.kind = 'dm' THEN (
                  SELECT peer.user_id FROM conversation_members peer
                  WHERE peer.conversation_id = c.id AND peer.user_id <> cm.user_id
                    AND peer.removed_at IS NULL LIMIT 1
                ) END AS peer_id
         FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.user_id = ? AND cm.removed_at IS NULL`,
      )
      .bind(userId),
    database
      .prepare(
        `SELECT CASE WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END AS friend_id
         FROM friendships f
         JOIN users peer ON peer.id = CASE
           WHEN f.user_low_id = ? THEN f.user_high_id ELSE f.user_low_id END
         WHERE f.status = 'accepted' AND peer.status = 'active'
           AND (f.user_low_id = ? OR f.user_high_id = ?)`,
      )
      .bind(userId, userId, userId, userId),
  ]);
  const conversationResult = capabilityResults[0]!;
  const friendshipResult = capabilityResults[1]!;
  const conversationRows = (conversationResult.results ?? []) as unknown as {
    conversation_id: string;
    call_room_id: string | null;
    kind: 'dm' | 'group';
    peer_id: string | null;
  }[];
  const friendIds = ((friendshipResult.results ?? []) as unknown as { friend_id: string }[]).map(
    (row) => row.friend_id,
  );
  const friendSet = new Set(friendIds);
  return {
    conversationIds: conversationRows.map((row) => row.conversation_id),
    writableConversationIds: conversationRows
      .filter((row) => row.kind === 'group' || (row.peer_id && friendSet.has(row.peer_id)))
      .map((row) => row.conversation_id),
    callRoomIds: conversationRows.flatMap((row) => (row.call_room_id ? [row.call_room_id] : [])),
    friendIds,
  };
}

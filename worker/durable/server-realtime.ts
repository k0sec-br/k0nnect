import { DurableObject } from 'cloudflare:workers';

import {
  MAX_WEBSOCKET_INVALID_MESSAGES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  SESSION_IDLE_SECONDS,
} from '../../shared/constants/security';
import {
  clientRoomMessageSchema,
  REALTIME_PROTOCOL_VERSION,
  type CallParticipant,
  type MediaEndReason,
  type MediaPublication,
  type MediaSource,
  type ServerRoomMessage,
} from '../../shared/protocol/room';
import type { MemberView } from '../../shared/types/api';
import type { ChatMessageView, SocialStateView } from '../../shared/types/api';
import { sha256 } from '../crypto/tokens';
import { AppError } from '../errors/app-error';
import { listSocialBootstrap, loadRealtimeCapabilities } from '../repositories/social';
import { CloudflareRealtimeClient } from '../realtime/cloudflare-realtime';
import { enforceRateLimits, RATE_LIMIT_POLICIES } from '../security/rate-limit';

const CONNECTION_RESUME_GRACE_MS = 45_000;
const SUSPENDED_CONNECTION_PREFIX = 'suspended-connection:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface PublicationRecord extends MediaPublication {
  realtimeSessionId: string;
  realtimeTrackName: string;
  mid: string;
  pending: boolean;
}

interface ConnectionAttachment {
  conversationIds: string[];
  writableConversationIds: string[];
  friendIds: string[];
  callRoomIds: string[];
  channelId: string | null;
  connectionId: string;
  connectionEpoch: number;
  sessionId: string;
  sessionCheckAt: number;
  userId: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  invalidMessages: number;
  messageWindowStartedAt: number;
  messagesInWindow: number;
  lastSpeakingUpdateAt: number;
  lifecycleHandled?: boolean;
  realtimeSessionId: string | null;
  superseded?: boolean;
  publications: PublicationRecord[];
  pendingClosures: PublicationRecord[];
  subscriptions: { publicationId: string; mid: string; pending?: boolean }[];
}

interface SuspendedConnectionRecord {
  attachment: ConnectionAttachment;
  expiresAt: number;
}

export interface ResolvedPublication {
  publication: MediaPublication;
  realtimeSessionId: string;
  realtimeTrackName: string;
  mid: string;
}

const SOURCE_KINDS: Record<MediaSource, 'audio' | 'video'> = {
  microphone: 'audio',
  camera: 'video',
  'screen-video': 'video',
  'screen-audio': 'audio',
};

class ChatCommandError extends Error {}

function toParticipant(attachment: ConnectionAttachment): CallParticipant | null {
  if (!attachment.channelId) return null;
  return {
    userId: attachment.userId,
    channelId: attachment.channelId,
    muted: attachment.muted,
    deafened: attachment.deafened,
    speaking: attachment.speaking,
  };
}

function toPublicPublication(record: PublicationRecord): MediaPublication {
  return {
    publicationId: record.publicationId,
    userId: record.userId,
    kind: record.kind,
    source: record.source,
    createdAt: record.createdAt,
  };
}

function messageSize(message: string | ArrayBuffer): number {
  return typeof message === 'string'
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
}

export class ServerRealtime extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade necessário.', { status: 426 });
    }

    const userId = request.headers.get('X-K0nnect-User-Id');
    const sessionId = request.headers.get('X-K0nnect-Session-Id');
    const sessionCheckAt = Number(request.headers.get('X-K0nnect-Session-Check-At'));
    if (
      !userId ||
      !sessionId ||
      !UUID_PATTERN.test(userId) ||
      !UUID_PATTERN.test(sessionId) ||
      !Number.isSafeInteger(sessionCheckAt) ||
      sessionCheckAt <= Date.now()
    ) {
      return new Response('Não autorizado.', { status: 401 });
    }

    const url = new URL(request.url);
    const requestedConnectionId = url.searchParams.get('connectionId');
    const requestedEpoch = Number(url.searchParams.get('connectionEpoch'));
    const resumedAttachment =
      requestedConnectionId &&
      UUID_PATTERN.test(requestedConnectionId) &&
      Number.isSafeInteger(requestedEpoch) &&
      requestedEpoch > 1
        ? await this.resumeConnection(userId, sessionId, requestedConnectionId, requestedEpoch)
        : null;
    const resumed = resumedAttachment !== null;
    const wasOnline = await this.userIsOnline(userId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const capabilities = await loadRealtimeCapabilities(this.env.DB, userId);
    const attachment: ConnectionAttachment = resumedAttachment ?? {
      ...capabilities,
      channelId: null,
      connectionId: crypto.randomUUID(),
      connectionEpoch: 1,
      sessionId,
      sessionCheckAt,
      userId,
      muted: false,
      deafened: false,
      speaking: false,
      invalidMessages: 0,
      messageWindowStartedAt: Date.now(),
      messagesInWindow: 0,
      lastSpeakingUpdateAt: 0,
      realtimeSessionId: null,
      publications: [],
      pendingClosures: [],
      subscriptions: [],
    };
    attachment.sessionCheckAt = sessionCheckAt;
    attachment.invalidMessages = 0;
    attachment.lifecycleHandled = false;
    attachment.messageWindowStartedAt = Date.now();
    attachment.messagesInWindow = 0;
    attachment.pendingClosures ??= [];
    attachment.conversationIds = capabilities.conversationIds;
    attachment.writableConversationIds = capabilities.writableConversationIds;
    attachment.friendIds = capabilities.friendIds;
    attachment.callRoomIds = capabilities.callRoomIds;
    attachment.superseded = false;
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [
      `user:${userId}`,
      `connection:${attachment.connectionId}`,
      ...(attachment.channelId ? [`channel:${attachment.channelId}`] : []),
    ]);
    await this.ensureAlarm();
    const snapshot = await this.snapshotForAttachment(attachment);

    this.send(server, {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'server.ready',
      payload: {
        connectionId: attachment.connectionId,
        connectionEpoch: attachment.connectionEpoch,
        resumed,
        ...snapshot,
      },
    });
    if (!wasOnline) {
      this.broadcast(
        {
          v: REALTIME_PROTOCOL_VERSION,
          type: 'presence.changed',
          payload: { userId, online: true },
        },
        server,
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    socket: WebSocket,
    rawMessage: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) {
      socket.close(1011, 'Estado de conexão indisponível');
      return;
    }

    const now = Date.now();
    if (now - attachment.messageWindowStartedAt >= 10_000) {
      attachment.messageWindowStartedAt = now;
      attachment.messagesInWindow = 0;
    }
    attachment.messagesInWindow += 1;
    socket.serializeAttachment(attachment);
    if (attachment.messagesInWindow > 50 || messageSize(rawMessage) > MAX_WEBSOCKET_MESSAGE_BYTES) {
      socket.close(1009, 'Limite de mensagens excedido');
      return;
    }

    if (typeof rawMessage !== 'string') {
      this.recordInvalidMessage(socket, attachment);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      this.recordInvalidMessage(socket, attachment);
      return;
    }
    const result = clientRoomMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.recordInvalidMessage(socket, attachment);
      return;
    }

    if (result.data.type === 'chat.send') {
      await this.sendChatMessage(socket, attachment, result.data.payload);
      return;
    }

    if (result.data.type === 'call.join' || result.data.type === 'call.takeover') {
      await this.joinCall(
        socket,
        attachment,
        result.data.payload.channelId,
        result.data.payload.requestId,
        result.data.type === 'call.takeover',
      );
      return;
    }

    if (result.data.type === 'call.leave') {
      if (!attachment.channelId) {
        this.send(socket, {
          v: REALTIME_PROTOCOL_VERSION,
          type: 'call.left',
          payload: { requestId: result.data.payload.requestId },
        });
        return;
      }
      this.leaveCall(socket, attachment, result.data.payload.requestId, 'publisher_left');
      return;
    }

    if (result.data.type === 'state.resync') {
      this.send(socket, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'state.snapshot',
        payload: await this.snapshotForAttachment(attachment),
      });
      return;
    }

    if (!attachment.channelId) return;

    if (result.data.type === 'member.updated') {
      attachment.deafened = result.data.payload.deafened;
      attachment.muted = result.data.payload.muted || attachment.deafened;
      if (attachment.muted) attachment.speaking = false;
      socket.serializeAttachment(attachment);
      this.broadcastToCallRoom(attachment.channelId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'call.member.updated',
        payload: toParticipant(attachment)!,
      });
      return;
    }

    if (result.data.type === 'voice.speaking') {
      if (now - attachment.lastSpeakingUpdateAt < 150) return;
      attachment.lastSpeakingUpdateAt = now;
      const speaking = !attachment.muted && result.data.payload.speaking;
      if (speaking === attachment.speaking) return;
      attachment.speaking = speaking;
      socket.serializeAttachment(attachment);
      this.broadcastToCallRoom(attachment.channelId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: speaking ? 'voice.speaking' : 'voice.stopped',
        payload: { userId: attachment.userId },
      });
    }
  }

  override async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    void reason;
    void wasClean;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment || attachment.lifecycleHandled || attachment.superseded) return;
    attachment.lifecycleHandled = true;
    socket.serializeAttachment(attachment);
    if (code !== 1000 && code !== 4003) {
      await this.suspendConnection(attachment);
      return;
    }
    this.finalizeConnection(socket, attachment, 'publisher_left');
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1006, 'Erro de transporte', false);
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const suspendedEntries = await this.ctx.storage.list<SuspendedConnectionRecord>({
      prefix: SUSPENDED_CONNECTION_PREFIX,
    });
    for (const [key, record] of suspendedEntries) {
      if (record.expiresAt <= now) {
        this.finalizeConnection(undefined, record.attachment, 'network_failure');
        await this.ctx.storage.delete(key);
      }
    }

    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (!attachment || attachment.sessionCheckAt > now) continue;
      const nextCheck = await this.nextSessionCheck(attachment.sessionId, attachment.userId);
      if (nextCheck === null) socket.close(4003, 'Sessão encerrada');
      else {
        attachment.sessionCheckAt = nextCheck;
        socket.serializeAttachment(attachment);
      }
    }
    await this.ensureAlarm();
  }

  hasActiveCall(userId: string, connectionId: string, channelId: string): boolean {
    return this.findConnection(userId, connectionId)?.attachment.channelId === channelId;
  }

  disconnectSession(sessionId: string, reconnectable = false): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.sessionId === sessionId) {
        socket.close(reconnectable ? 4004 : 4003, 'Sessão encerrada');
      }
    }
  }

  disconnectUser(userId: string): void {
    for (const socket of this.ctx.getWebSockets(`user:${userId}`)) {
      socket.close(4003, 'Sessão encerrada');
    }
  }

  announceMember(type: 'member.added' | 'member.updated' | 'member.removed', member: MemberView) {
    this.broadcast({ v: REALTIME_PROTOCOL_VERSION, type, payload: member });
  }

  async refreshSocialState(
    userIds: string[],
    reason: 'friends' | 'groups' | 'conversations',
  ): Promise<Record<string, SocialStateView>> {
    const states: Record<string, SocialStateView> = {};
    for (const userId of [...new Set(userIds)]) {
      const [capabilities, social] = await Promise.all([
        loadRealtimeCapabilities(this.env.DB, userId),
        listSocialBootstrap(this.env.DB, userId),
      ]);
      states[userId] = social;
      for (const socket of this.ctx.getWebSockets(`user:${userId}`)) {
        const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
        if (!attachment) continue;
        attachment.conversationIds = capabilities.conversationIds;
        attachment.writableConversationIds = capabilities.writableConversationIds;
        attachment.friendIds = capabilities.friendIds;
        attachment.callRoomIds = capabilities.callRoomIds;
        if (attachment.channelId && !attachment.callRoomIds.includes(attachment.channelId)) {
          this.leaveCall(socket, attachment, undefined, 'publisher_left');
        } else {
          socket.serializeAttachment(attachment);
        }
        this.send(socket, {
          v: REALTIME_PROTOCOL_VERSION,
          type: 'social.changed',
          payload: { userId, reason, ...social },
        });
      }
      const suspended = await this.ctx.storage.list<SuspendedConnectionRecord>({
        prefix: `${SUSPENDED_CONNECTION_PREFIX}${userId}:`,
      });
      for (const [key, record] of suspended) {
        record.attachment.conversationIds = capabilities.conversationIds;
        record.attachment.writableConversationIds = capabilities.writableConversationIds;
        record.attachment.friendIds = capabilities.friendIds;
        record.attachment.callRoomIds = capabilities.callRoomIds;
        if (
          record.attachment.channelId &&
          !record.attachment.callRoomIds.includes(record.attachment.channelId)
        ) {
          this.finalizeCall(undefined, record.attachment, 'publisher_left');
          record.attachment.channelId = null;
          record.attachment.realtimeSessionId = null;
          record.attachment.publications = [];
          record.attachment.pendingClosures = [];
          record.attachment.subscriptions = [];
        }
        await this.ctx.storage.put(key, record);
      }
    }
    return states;
  }

  announceChatUpdate(message: ChatMessageView): void {
    if (message.deletedAt) {
      this.broadcastToConversation(message.conversationId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.deleted',
        payload: {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          deletedAt: message.deletedAt,
        },
      });
    } else if (message.content && message.editedAt) {
      this.broadcastToConversation(message.conversationId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.updated',
        payload: {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          content: message.content,
          editedAt: message.editedAt,
        },
      });
    }
  }

  private async sendChatMessage(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    payload: {
      conversationId?: string | undefined;
      recipientUserId?: string | undefined;
      clientMessageId: string;
      content: string;
    },
  ): Promise<void> {
    try {
      await enforceRateLimits(this.env, attachment.userId, [
        RATE_LIMIT_POLICIES.chatBurst,
        RATE_LIMIT_POLICIES.chatSustained,
      ]);
      const content = payload.content;
      let conversationId = payload.conversationId;
      let message: ChatMessageView | null = null;

      if (payload.recipientUserId) {
        if (!attachment.friendIds.includes(payload.recipientUserId)) {
          throw new ChatCommandError('Envio permitido apenas entre amigos.');
        }
        const ids = [attachment.userId, payload.recipientUserId].sort();
        const pairKey = `${ids[0]}:${ids[1]}`;
        conversationId = `dm_${await sha256(pairKey)}`;
        const now = new Date().toISOString();
        await this.env.DB.batch([
          this.env.DB.prepare(
            `INSERT INTO conversations (
               id, kind, space_kind, name, owner_user_id, dm_pair_key, call_room_id,
               is_default, created_at, updated_at
             ) VALUES (?, 'dm', NULL, NULL, NULL, ?, NULL, 0, ?, ?)
             ON CONFLICT(dm_pair_key) DO NOTHING`,
          ).bind(conversationId, pairKey, now, now),
          this.env.DB.prepare(
            `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
             VALUES (?, ?, 'member', ?)
             ON CONFLICT(conversation_id, user_id) DO NOTHING`,
          ).bind(conversationId, attachment.userId, now),
          this.env.DB.prepare(
            `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
             VALUES (?, ?, 'member', ?)
             ON CONFLICT(conversation_id, user_id) DO NOTHING`,
          ).bind(conversationId, payload.recipientUserId, now),
        ]);
        await this.refreshSocialState(
          [attachment.userId, payload.recipientUserId],
          'conversations',
        );
        attachment.conversationIds = [...new Set([...attachment.conversationIds, conversationId])];
        attachment.writableConversationIds = [
          ...new Set([...attachment.writableConversationIds, conversationId]),
        ];
      }

      if (!conversationId || !attachment.writableConversationIds.includes(conversationId)) {
        throw new ChatCommandError('Você não pode enviar mensagens nesta conversa.');
      }

      const createdAt = new Date().toISOString();
      const inserted = await this.env.DB.prepare(
        `INSERT INTO messages (
           conversation_id, sender_id, client_message_id, content, created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sender_id, client_message_id) DO NOTHING
         RETURNING id, conversation_id, sender_id, client_message_id, content,
                   created_at, edited_at, deleted_at`,
      )
        .bind(conversationId, attachment.userId, payload.clientMessageId, content, createdAt)
        .first<{
          id: number;
          conversation_id: string;
          sender_id: string;
          client_message_id: string;
          content: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
        }>();
      const row =
        inserted ??
        (await this.env.DB.prepare(
          `SELECT id, conversation_id, sender_id, client_message_id, content,
                  created_at, edited_at, deleted_at
           FROM messages WHERE sender_id = ? AND client_message_id = ? LIMIT 1`,
        )
          .bind(attachment.userId, payload.clientMessageId)
          .first<{
            id: number;
            conversation_id: string;
            sender_id: string;
            client_message_id: string;
            content: string | null;
            created_at: string;
            edited_at: string | null;
            deleted_at: string | null;
          }>());
      if (!row?.content || row.conversation_id !== conversationId) {
        throw new ChatCommandError('Não foi possível persistir a mensagem.');
      }
      const canonicalContent = row.content;
      message = {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        clientMessageId: row.client_message_id,
        content: canonicalContent,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        deletedAt: row.deleted_at,
      };
      this.broadcastToConversation(conversationId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'chat.message',
        payload: {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          clientMessageId: message.clientMessageId,
          content: canonicalContent,
          createdAt: message.createdAt,
          editedAt: null,
          deletedAt: null,
        },
      });
    } catch (error) {
      this.send(socket, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'error',
        payload: {
          message:
            error instanceof AppError
              ? error.userMessage
              : error instanceof ChatCommandError
                ? error.message
                : 'Não foi possível enviar a mensagem.',
          requestId: payload.clientMessageId,
        },
      });
    }
  }

  private async joinCall(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    channelId: string,
    requestId: string,
    takeover: boolean,
  ): Promise<void> {
    if (!attachment.callRoomIds.includes(channelId)) {
      this.send(socket, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'error',
        payload: { message: 'Este canal de voz não está disponível.', requestId },
      });
      return;
    }

    const owner = await this.findCallOwner(attachment.userId);
    if (owner && owner.attachment.connectionId !== attachment.connectionId && !takeover) {
      this.send(socket, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'call.conflict',
        payload: { channelId: owner.attachment.channelId!, requestId },
      });
      return;
    }
    if (owner && owner.attachment.connectionId !== attachment.connectionId) {
      if (owner.socket) {
        this.send(owner.socket, {
          v: REALTIME_PROTOCOL_VERSION,
          type: 'call.replaced',
          payload: { channelId: owner.attachment.channelId! },
        });
        this.leaveCall(owner.socket, owner.attachment, undefined, 'publisher_left');
      } else if (owner.storageKey) {
        this.finalizeCall(undefined, owner.attachment, 'publisher_left');
        await this.ctx.storage.delete(owner.storageKey);
      }
    }

    if (attachment.channelId && attachment.channelId !== channelId) {
      this.leaveCall(socket, attachment, undefined, 'publisher_left');
    }
    const newlyJoined = attachment.channelId !== channelId;
    attachment.channelId = channelId;
    attachment.muted = false;
    attachment.deafened = false;
    attachment.speaking = false;
    socket.serializeAttachment(attachment);

    if (newlyJoined) {
      this.broadcastToCallScope(
        channelId,
        {
          v: REALTIME_PROTOCOL_VERSION,
          type: 'call.member.joined',
          payload: toParticipant(attachment)!,
        },
        socket,
      );
    }
    const snapshot = await this.snapshot(channelId);
    this.send(socket, {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'call.joined',
      payload: {
        requestId,
        channelId,
        participants: snapshot.participants,
        publications: snapshot.publications,
      },
    });
  }

  private leaveCall(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    requestId: string | undefined,
    reason: MediaEndReason,
  ): void {
    if (!attachment.channelId) return;
    this.finalizeCall(socket, attachment, reason, requestId);
    attachment.channelId = null;
    attachment.muted = false;
    attachment.deafened = false;
    attachment.speaking = false;
    attachment.realtimeSessionId = null;
    attachment.publications = [];
    attachment.pendingClosures = [];
    attachment.subscriptions = [];
    socket.serializeAttachment(attachment);
  }

  private finalizeCall(
    socket: WebSocket | undefined,
    attachment: ConnectionAttachment,
    reason: MediaEndReason,
    requestId?: string,
  ): void {
    if (!attachment.channelId) return;
    const departing = {
      ...attachment,
      publications: [...attachment.publications],
      pendingClosures: [...attachment.pendingClosures],
      subscriptions: [...attachment.subscriptions],
    };
    void socket;
    this.ctx.waitUntil(this.cleanupRealtime(departing));
    this.broadcastUnpublished(departing, reason);
    this.broadcastToCallScope(attachment.channelId, {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'call.member.left',
      payload: {
        userId: attachment.userId,
        channelId: attachment.channelId,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  registerRealtimeSession(userId: string, connectionId: string, sessionId: string): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return false;
    if (
      connection.attachment.realtimeSessionId &&
      connection.attachment.realtimeSessionId !== sessionId
    ) {
      const previousAttachment = {
        ...connection.attachment,
        publications: [...connection.attachment.publications],
        pendingClosures: [...connection.attachment.pendingClosures],
        subscriptions: [...connection.attachment.subscriptions],
      };
      this.broadcastUnpublished(previousAttachment, 'session_rebuilt');
      this.ctx.waitUntil(this.cleanupRealtime(previousAttachment));
      connection.attachment.publications = [];
      connection.attachment.pendingClosures = [];
      connection.attachment.subscriptions = [];
    }
    connection.attachment.realtimeSessionId = sessionId;
    connection.socket.serializeAttachment(connection.attachment);
    return true;
  }

  ownsRealtimeSession(userId: string, connectionId: string, sessionId: string): boolean {
    const connection = this.findConnection(userId, connectionId);
    return connection?.attachment.realtimeSessionId === sessionId;
  }

  reservePublication(
    userId: string,
    connectionId: string,
    sessionId: string,
    source: MediaSource,
    mid: string,
  ): string | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    if (connection.attachment.publications.some((item) => item.source === source)) return null;
    if (
      source === 'screen-audio' &&
      !connection.attachment.publications.some(
        (item) => item.source === 'screen-video' && !item.pending,
      )
    ) {
      return null;
    }

    const publicationId = crypto.randomUUID();
    connection.attachment.publications.push({
      publicationId,
      userId,
      source,
      kind: SOURCE_KINDS[source],
      createdAt: Date.now(),
      realtimeSessionId: sessionId,
      realtimeTrackName: '',
      mid,
      pending: true,
    });
    connection.socket.serializeAttachment(connection.attachment);
    return publicationId;
  }

  reservePublications(
    userId: string,
    connectionId: string,
    sessionId: string,
    tracks: { source: MediaSource; mid: string }[],
  ): { publicationId: string; source: MediaSource; mid: string }[] | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    const requestedSources = new Set(tracks.map((track) => track.source));
    if (requestedSources.size !== tracks.length) return null;
    if (
      tracks.some((track) =>
        connection.attachment.publications.some((item) => item.source === track.source),
      )
    ) {
      return null;
    }
    const hasScreenVideo =
      requestedSources.has('screen-video') ||
      connection.attachment.publications.some(
        (item) => item.source === 'screen-video' && !item.pending,
      );
    if (requestedSources.has('screen-audio') && !hasScreenVideo) return null;
    const reservations = tracks.map((track) => ({ ...track, publicationId: crypto.randomUUID() }));
    connection.attachment.publications.push(
      ...reservations.map((reservation) => ({
        publicationId: reservation.publicationId,
        userId,
        source: reservation.source,
        kind: SOURCE_KINDS[reservation.source],
        createdAt: Date.now(),
        realtimeSessionId: sessionId,
        realtimeTrackName: '',
        mid: reservation.mid,
        pending: true,
      })),
    );
    connection.socket.serializeAttachment(connection.attachment);
    return reservations;
  }

  completePublication(
    userId: string,
    connectionId: string,
    publicationId: string,
    realtimeTrackName: string,
  ): MediaPublication | null {
    const connection = this.findConnection(userId, connectionId);
    const record = connection?.attachment.publications.find(
      (item) => item.publicationId === publicationId && item.pending,
    );
    if (!connection || !record) return null;
    record.realtimeTrackName = realtimeTrackName;
    record.pending = false;
    connection.socket.serializeAttachment(connection.attachment);
    const publication = toPublicPublication(record);
    if (!connection.attachment.channelId) return null;
    this.broadcastToCallRoom(connection.attachment.channelId, {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'media.published',
      payload: publication,
    });
    return publication;
  }

  completePublications(
    userId: string,
    connectionId: string,
    tracks: { publicationId: string; realtimeTrackName: string }[],
  ): MediaPublication[] | null {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return null;
    const records = tracks.map((track) =>
      connection.attachment.publications.find(
        (item) => item.publicationId === track.publicationId && item.pending,
      ),
    );
    if (records.some((record) => !record)) return null;
    const publications = records.map((record, index) => {
      record!.realtimeTrackName = tracks[index]!.realtimeTrackName;
      record!.pending = false;
      return toPublicPublication(record!);
    });
    connection.socket.serializeAttachment(connection.attachment);
    for (const publication of publications) {
      if (!connection.attachment.channelId) return null;
      this.broadcastToCallRoom(connection.attachment.channelId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'media.published',
        payload: publication,
      });
    }
    return publications;
  }

  cancelPublications(userId: string, connectionId: string, publicationIds: string[]): void {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return;
    const cancelled = new Set(publicationIds);
    connection.attachment.publications = connection.attachment.publications.filter(
      (item) => !cancelled.has(item.publicationId) || !item.pending,
    );
    connection.socket.serializeAttachment(connection.attachment);
  }

  cancelPublication(userId: string, connectionId: string, publicationId: string): void {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return;
    connection.attachment.publications = connection.attachment.publications.filter(
      (item) => item.publicationId !== publicationId || !item.pending,
    );
    connection.socket.serializeAttachment(connection.attachment);
  }

  async resolvePublication(
    userId: string,
    connectionId: string,
    publicationId: string,
  ): Promise<ResolvedPublication | null> {
    const connection = this.findConnection(userId, connectionId);
    if (!connection?.attachment.channelId) return null;
    const publication = await this.findRemotePublication(
      userId,
      connection.attachment.channelId,
      publicationId,
    );
    return publication ? this.resolveRecord(publication) : null;
  }

  async reserveSubscription(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
  ): Promise<ResolvedPublication | null> {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    if (
      connection.attachment.subscriptions.some(
        (subscription) => subscription.publicationId === publicationId,
      )
    ) {
      return null;
    }

    if (!connection.attachment.channelId) return null;
    const publication = await this.findRemotePublication(
      userId,
      connection.attachment.channelId,
      publicationId,
    );
    if (!publication) return null;
    connection.attachment.subscriptions.push({ publicationId, mid: '', pending: true });
    connection.socket.serializeAttachment(connection.attachment);
    return this.resolveRecord(publication);
  }

  async reserveSubscriptions(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationIds: string[],
  ): Promise<ResolvedPublication[] | null> {
    const connection = this.findConnection(userId, connectionId);
    if (
      !connection?.attachment.channelId ||
      connection.attachment.realtimeSessionId !== sessionId
    ) {
      return null;
    }
    const uniqueIds = new Set(publicationIds);
    if (
      uniqueIds.size !== publicationIds.length ||
      publicationIds.some((publicationId) =>
        connection.attachment.subscriptions.some(
          (subscription) => subscription.publicationId === publicationId,
        ),
      )
    ) {
      return null;
    }
    const records: PublicationRecord[] = [];
    for (const publicationId of publicationIds) {
      const publication = await this.findRemotePublication(
        userId,
        connection.attachment.channelId,
        publicationId,
      );
      if (!publication) return null;
      records.push(publication);
    }
    connection.attachment.subscriptions.push(
      ...publicationIds.map((publicationId) => ({ publicationId, mid: '', pending: true })),
    );
    connection.socket.serializeAttachment(connection.attachment);
    return records.map((record) => this.resolveRecord(record));
  }

  completeSubscriptions(
    userId: string,
    connectionId: string,
    sessionId: string,
    subscriptions: { publicationId: string; mid: string }[],
  ): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return false;
    const pending = subscriptions.map((subscription) =>
      connection.attachment.subscriptions.find(
        (item) => item.publicationId === subscription.publicationId && item.pending === true,
      ),
    );
    if (pending.some((subscription) => !subscription)) return false;
    pending.forEach((subscription, index) => {
      subscription!.mid = subscriptions[index]!.mid;
      subscription!.pending = false;
    });
    connection.socket.serializeAttachment(connection.attachment);
    return true;
  }

  cancelSubscriptions(userId: string, connectionId: string, publicationIds: string[]): void {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return;
    const cancelled = new Set(publicationIds);
    connection.attachment.subscriptions = connection.attachment.subscriptions.filter(
      (item) => !cancelled.has(item.publicationId) || item.pending !== true,
    );
    connection.socket.serializeAttachment(connection.attachment);
  }

  resolveOwnedPublication(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
  ): ResolvedPublication | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    const record = [
      ...connection.attachment.publications,
      ...connection.attachment.pendingClosures,
    ].find((item) => item.publicationId === publicationId && !item.pending);
    return record ? this.resolveRecord(record) : null;
  }

  resolveOwnedPublicationBySource(
    userId: string,
    connectionId: string,
    sessionId: string,
    source: MediaSource,
  ): ResolvedPublication | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    const record = [
      ...connection.attachment.publications,
      ...connection.attachment.pendingClosures,
    ].find((item) => item.source === source && !item.pending);
    return record ? this.resolveRecord(record) : null;
  }

  removePublication(
    userId: string,
    connectionId: string,
    publicationId: string,
    reason: MediaEndReason = 'error',
  ): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return false;
    const record = connection.attachment.publications.find(
      (item) => item.publicationId === publicationId && !item.pending,
    );
    if (!record) return false;
    if (
      !connection.attachment.pendingClosures.some((item) => item.publicationId === publicationId)
    ) {
      connection.attachment.pendingClosures.push(record);
    }
    connection.attachment.publications = connection.attachment.publications.filter(
      (item) => item.publicationId !== publicationId,
    );
    connection.socket.serializeAttachment(connection.attachment);
    if (!connection.attachment.channelId) return false;
    this.broadcastToCallRoom(connection.attachment.channelId, {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'media.unpublished',
      payload: { publicationId, userId, source: record.source, reason },
    });
    return true;
  }

  completePublicationClosures(
    userId: string,
    connectionId: string,
    publicationIds: string[],
  ): void {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return;
    const completed = new Set(publicationIds);
    connection.attachment.pendingClosures = connection.attachment.pendingClosures.filter(
      (publication) => !completed.has(publication.publicationId),
    );
    connection.socket.serializeAttachment(connection.attachment);
  }

  hasOwnedPublicationSource(userId: string, connectionId: string, source: MediaSource): boolean {
    const connection = this.findConnection(userId, connectionId);
    return Boolean(
      connection?.attachment.publications.some(
        (publication) => publication.source === source && !publication.pending,
      ),
    );
  }

  completeSubscription(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
    mid: string,
  ): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return false;
    const subscription = connection.attachment.subscriptions.find(
      (item) => item.publicationId === publicationId && item.pending === true,
    );
    if (!subscription) return false;
    subscription.mid = mid;
    subscription.pending = false;
    connection.socket.serializeAttachment(connection.attachment);
    return true;
  }

  cancelSubscription(userId: string, connectionId: string, publicationId: string): void {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return;
    connection.attachment.subscriptions = connection.attachment.subscriptions.filter(
      (item) => item.publicationId !== publicationId || item.pending !== true,
    );
    connection.socket.serializeAttachment(connection.attachment);
  }

  takeSubscription(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
  ): string | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    const subscription = connection.attachment.subscriptions.find(
      (item) => item.publicationId === publicationId && item.pending !== true,
    );
    if (!subscription) return null;
    connection.attachment.subscriptions = connection.attachment.subscriptions.filter(
      (item) => item.publicationId !== publicationId,
    );
    connection.socket.serializeAttachment(connection.attachment);
    return subscription.mid;
  }

  private resolveRecord(record: PublicationRecord): ResolvedPublication {
    return {
      publication: toPublicPublication(record),
      realtimeSessionId: record.realtimeSessionId,
      realtimeTrackName: record.realtimeTrackName,
      mid: record.mid,
    };
  }

  private async findRemotePublication(
    requestingUserId: string,
    channelId: string,
    publicationId: string,
  ): Promise<PublicationRecord | null> {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      const publication = attachment?.publications.find(
        (item) => item.publicationId === publicationId && !item.pending,
      );
      if (
        attachment?.userId !== requestingUserId &&
        attachment?.channelId === channelId &&
        publication
      ) {
        return publication;
      }
    }
    const suspended = await this.suspendedConnections();
    for (const record of suspended) {
      if (
        record.attachment.userId === requestingUserId ||
        record.attachment.channelId !== channelId
      ) {
        continue;
      }
      const publication = record.attachment.publications.find(
        (item) => item.publicationId === publicationId && !item.pending,
      );
      if (publication) return publication;
    }
    return null;
  }

  private async findCallOwner(userId: string): Promise<{
    attachment: ConnectionAttachment;
    socket?: WebSocket;
    storageKey?: string;
  } | null> {
    for (const socket of this.ctx.getWebSockets(`user:${userId}`)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.channelId) return { attachment, socket };
    }
    const suspended = await this.ctx.storage.list<SuspendedConnectionRecord>({
      prefix: `${SUSPENDED_CONNECTION_PREFIX}${userId}:`,
    });
    for (const [storageKey, record] of suspended) {
      if (record.expiresAt > Date.now() && record.attachment.channelId) {
        return { attachment: record.attachment, storageKey };
      }
    }
    return null;
  }

  private async snapshot(
    channelId?: string,
    allowedRoomIds?: string[],
  ): Promise<{
    onlineUserIds: string[];
    participants: CallParticipant[];
    publications: MediaPublication[];
  }> {
    const active = this.ctx.getWebSockets().flatMap((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return attachment ? [attachment] : [];
    });
    const suspended = (await this.suspendedConnections()).map((record) => record.attachment);
    const connections = [...active, ...suspended];
    const onlineUserIds = [...new Set(connections.map((connection) => connection.userId))];
    const seenCallUsers = new Set<string>();
    const participants: CallParticipant[] = [];
    const publications: MediaPublication[] = [];
    for (const connection of connections) {
      if (
        !connection.channelId ||
        (channelId && connection.channelId !== channelId) ||
        (allowedRoomIds && !allowedRoomIds.includes(connection.channelId))
      ) {
        continue;
      }
      if (!seenCallUsers.has(connection.userId)) {
        const participant = toParticipant(connection);
        if (participant) participants.push(participant);
        seenCallUsers.add(connection.userId);
      }
      publications.push(
        ...connection.publications
          .filter((publication) => !publication.pending)
          .map(toPublicPublication),
      );
    }
    return { onlineUserIds, participants, publications };
  }

  private async snapshotForAttachment(attachment: ConnectionAttachment): Promise<{
    onlineUserIds: string[];
    participants: CallParticipant[];
    publications: MediaPublication[];
  }> {
    const availableCalls = await this.snapshot(undefined, attachment.callRoomIds);
    const activeCall = attachment.channelId
      ? await this.snapshot(attachment.channelId)
      : { publications: [] as MediaPublication[] };
    return {
      onlineUserIds: availableCalls.onlineUserIds,
      participants: availableCalls.participants,
      publications: activeCall.publications,
    };
  }

  private async userIsOnline(userId: string, excludedConnectionId?: string): Promise<boolean> {
    for (const socket of this.ctx.getWebSockets(`user:${userId}`)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment && attachment.connectionId !== excludedConnectionId) return true;
    }
    return (await this.suspendedConnections()).some(
      (record) =>
        record.attachment.userId === userId &&
        record.attachment.connectionId !== excludedConnectionId,
    );
  }

  private findConnection(
    userId: string,
    connectionId: string,
  ): { socket: WebSocket; attachment: ConnectionAttachment } | undefined {
    for (const socket of this.ctx.getWebSockets(`connection:${connectionId}`)) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.userId === userId) {
        attachment.pendingClosures ??= [];
        return { socket, attachment };
      }
    }
    return undefined;
  }

  private suspendedConnectionKey(userId: string, connectionId: string): string {
    return `${SUSPENDED_CONNECTION_PREFIX}${userId}:${connectionId}`;
  }

  private async suspendedConnections(): Promise<SuspendedConnectionRecord[]> {
    const now = Date.now();
    const records = await this.ctx.storage.list<SuspendedConnectionRecord>({
      prefix: SUSPENDED_CONNECTION_PREFIX,
    });
    return [...records.values()].filter((record) => record.expiresAt > now);
  }

  private async resumeConnection(
    userId: string,
    sessionId: string,
    connectionId: string,
    requestedEpoch: number,
  ): Promise<ConnectionAttachment | null> {
    for (const socket of this.ctx.getWebSockets(`connection:${connectionId}`)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const existing = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (
        existing?.userId !== userId ||
        existing.connectionId !== connectionId ||
        requestedEpoch <= existing.connectionEpoch
      ) {
        continue;
      }
      existing.superseded = true;
      existing.lifecycleHandled = true;
      socket.serializeAttachment(existing);
      socket.close(4002, 'Transporte substituído');
      return {
        ...existing,
        connectionEpoch: requestedEpoch,
        lifecycleHandled: false,
        sessionId,
        superseded: false,
      };
    }

    const key = this.suspendedConnectionKey(userId, connectionId);
    const suspended = await this.ctx.storage.get<SuspendedConnectionRecord>(key);
    if (
      !suspended ||
      suspended.expiresAt <= Date.now() ||
      suspended.attachment.connectionId !== connectionId ||
      requestedEpoch <= suspended.attachment.connectionEpoch
    ) {
      return null;
    }
    await this.ctx.storage.delete(key);
    return {
      ...suspended.attachment,
      connectionEpoch: requestedEpoch,
      lifecycleHandled: false,
      sessionId,
      superseded: false,
    };
  }

  private async suspendConnection(attachment: ConnectionAttachment): Promise<void> {
    const suspendedAttachment = {
      ...attachment,
      lifecycleHandled: false,
      superseded: false,
      speaking: false,
    };
    await this.ctx.storage.put(
      this.suspendedConnectionKey(attachment.userId, attachment.connectionId),
      {
        attachment: suspendedAttachment,
        expiresAt: Date.now() + CONNECTION_RESUME_GRACE_MS,
      } satisfies SuspendedConnectionRecord,
    );
    await this.ensureAlarm();
  }

  private finalizeConnection(
    socket: WebSocket | undefined,
    attachment: ConnectionAttachment,
    reason: MediaEndReason,
  ): void {
    if (attachment.channelId) this.finalizeCall(socket, attachment, reason);
    this.ctx.waitUntil(
      this.userIsOnline(attachment.userId, attachment.connectionId).then((online) => {
        if (!online) {
          this.broadcast({
            v: REALTIME_PROTOCOL_VERSION,
            type: 'presence.changed',
            payload: { userId: attachment.userId, online: false },
          });
        }
      }),
    );
  }

  private async ensureAlarm(): Promise<void> {
    const candidates: number[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment) candidates.push(attachment.sessionCheckAt);
    }
    const suspended = await this.ctx.storage.list<SuspendedConnectionRecord>({
      prefix: SUSPENDED_CONNECTION_PREFIX,
    });
    for (const record of suspended.values()) {
      candidates.push(record.expiresAt, record.attachment.sessionCheckAt);
    }
    const desiredTime = Math.min(...candidates.filter((value) => value > Date.now()));
    if (!Number.isFinite(desiredTime)) return;
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredTime < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredTime);
    }
  }

  private async nextSessionCheck(sessionId: string, userId: string): Promise<number | null> {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - SESSION_IDLE_SECONDS * 1_000).toISOString();
    const session = await this.env.DB.prepare(
      `SELECT s.last_seen_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL
         AND s.expires_at > ? AND s.last_seen_at > ? AND u.status = 'active'
       LIMIT 1`,
    )
      .bind(sessionId, userId, now.toISOString(), idleCutoff)
      .first<{ last_seen_at: string; expires_at: string }>();
    if (!session) return null;
    return Math.min(
      new Date(session.expires_at).getTime(),
      new Date(session.last_seen_at).getTime() + SESSION_IDLE_SECONDS * 1_000,
    );
  }

  private async cleanupRealtime(attachment: ConnectionAttachment): Promise<void> {
    if (this.env.REALTIME_ENABLED !== 'true' || !attachment.realtimeSessionId) return;
    const mids = [
      ...attachment.publications.map((publication) => publication.mid),
      ...(attachment.pendingClosures ?? []).map((publication) => publication.mid),
      ...attachment.subscriptions
        .filter((subscription) => subscription.pending !== true)
        .map((subscription) => subscription.mid),
    ].filter((mid) => mid.length > 0);
    const realtime = new CloudflareRealtimeClient(this.env);
    const uniqueMids = [...new Set(mids)];
    if (uniqueMids.length === 0) return;
    try {
      await realtime.closeTracks(attachment.realtimeSessionId, uniqueMids);
    } catch {
      // Cleanup failures must not prevent WebSocket teardown.
    }
  }

  private broadcastUnpublished(attachment: ConnectionAttachment, reason: MediaEndReason): void {
    for (const publication of attachment.publications) {
      if (publication.pending) continue;
      if (!attachment.channelId) continue;
      this.broadcastToCallRoom(attachment.channelId, {
        v: REALTIME_PROTOCOL_VERSION,
        type: 'media.unpublished',
        payload: {
          publicationId: publication.publicationId,
          userId: attachment.userId,
          source: publication.source,
          reason,
        },
      });
    }
  }

  private recordInvalidMessage(socket: WebSocket, attachment: ConnectionAttachment): void {
    attachment.invalidMessages += 1;
    socket.serializeAttachment(attachment);
    if (attachment.invalidMessages >= MAX_WEBSOCKET_INVALID_MESSAGES) {
      socket.close(1008, 'Mensagem inválida');
    }
  }

  private send(socket: WebSocket, message: ServerRoomMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcastToConversation(conversationId: string, message: ServerRoomMessage): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.conversationIds.includes(conversationId)) this.send(socket, message);
    }
  }

  private broadcastToCallRoom(
    channelId: string,
    message: ServerRoomMessage,
    excludedSocket?: WebSocket,
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excludedSocket) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.channelId === channelId) this.send(socket, message);
    }
  }

  private broadcastToCallScope(
    channelId: string,
    message: ServerRoomMessage,
    excludedSocket?: WebSocket,
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excludedSocket) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.callRoomIds.includes(channelId)) this.send(socket, message);
    }
  }

  private broadcast(message: ServerRoomMessage, excludedSocket?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== excludedSocket) this.send(socket, message);
    }
  }
}

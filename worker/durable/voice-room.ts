import { DurableObject } from 'cloudflare:workers';

import {
  MAX_WEBSOCKET_INVALID_MESSAGES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  SESSION_IDLE_SECONDS,
} from '../../shared/constants/security';
import {
  clientRoomMessageSchema,
  ROOM_PROTOCOL_VERSION,
  type MediaEndReason,
  type MediaPublication,
  type MediaSource,
  type RoomParticipant,
  type ServerRoomMessage,
} from '../../shared/protocol/room';
import { CloudflareRealtimeClient } from '../realtime/cloudflare-realtime';

const SESSION_REVALIDATION_SECONDS = 60;
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
  callInstanceId: string;
  connectionId: string;
  connectionEpoch: number;
  sessionId: string;
  userId: string;
  displayName: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  invalidMessages: number;
  messageWindowStartedAt: number;
  messagesInWindow: number;
  lastSpeakingUpdateAt: number;
  lastHeartbeatAt: number;
  lifecycleHandled?: boolean;
  realtimeSessionId: string | null;
  cleanupStarted?: boolean;
  superseded?: boolean;
  visibility: 'foreground' | 'background';
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

function toParticipant(attachment: ConnectionAttachment): RoomParticipant {
  return {
    userId: attachment.userId,
    displayName: attachment.displayName,
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

export class VoiceRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade necessário.', { status: 426 });
    }

    const userId = request.headers.get('X-K0nnect-User-Id');
    const sessionId = request.headers.get('X-K0nnect-Session-Id');
    const encodedDisplayName = request.headers.get('X-K0nnect-Display-Name');
    if (
      !userId ||
      !sessionId ||
      !UUID_PATTERN.test(userId) ||
      !UUID_PATTERN.test(sessionId) ||
      !encodedDisplayName
    ) {
      return new Response('Não autorizado.', { status: 401 });
    }
    if (!(await this.sessionIsActive(sessionId, userId))) {
      return new Response('Não autorizado.', { status: 401 });
    }

    const displayName = decodeURIComponent(encodedDisplayName);
    const url = new URL(request.url);
    const requestedCallInstanceId = url.searchParams.get('callInstanceId');
    const requestedConnectionId = url.searchParams.get('connectionId');
    const requestedEpoch = Number(url.searchParams.get('connectionEpoch'));
    const resumedAttachment =
      requestedCallInstanceId &&
      requestedConnectionId &&
      UUID_PATTERN.test(requestedCallInstanceId) &&
      UUID_PATTERN.test(requestedConnectionId) &&
      Number.isSafeInteger(requestedEpoch) &&
      requestedEpoch > 1
        ? await this.resumeConnection(
            userId,
            sessionId,
            requestedCallInstanceId,
            requestedConnectionId,
            requestedEpoch,
          )
        : null;
    const resumed = resumedAttachment !== null;

    if (!resumed) {
      await this.finalizeSuspendedConnections(userId);
      for (const existingSocket of this.ctx.getWebSockets(`user:${userId}`)) {
        const existing = existingSocket.deserializeAttachment() as ConnectionAttachment | null;
        if (existing) {
          existing.superseded = true;
          existing.lifecycleHandled = true;
          existingSocket.serializeAttachment(existing);
          this.broadcastUnpublished(existing, 'publisher_left');
          this.scheduleRealtimeCleanup(existingSocket, existing);
        }
        existingSocket.close(4001, 'Conexão substituída');
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = resumedAttachment ?? {
      callInstanceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      connectionEpoch: 1,
      sessionId,
      userId,
      displayName,
      muted: false,
      deafened: false,
      speaking: false,
      invalidMessages: 0,
      messageWindowStartedAt: Date.now(),
      messagesInWindow: 0,
      lastSpeakingUpdateAt: 0,
      lastHeartbeatAt: Date.now(),
      realtimeSessionId: null,
      cleanupStarted: false,
      visibility: 'foreground',
      publications: [],
      pendingClosures: [],
      subscriptions: [],
    };
    attachment.displayName = displayName;
    attachment.invalidMessages = 0;
    attachment.lifecycleHandled = false;
    attachment.messageWindowStartedAt = Date.now();
    attachment.messagesInWindow = 0;
    attachment.pendingClosures ??= [];
    attachment.superseded = false;
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [
      `user:${userId}`,
      `connection:${attachment.connectionId}`,
      `call:${attachment.callInstanceId}`,
    ]);
    await this.ensureSessionAlarm();

    const suspended = await this.suspendedConnections();
    const activeParticipants = this.participants();
    const activePublications = this.publications();
    const participants = [
      ...activeParticipants,
      ...suspended
        .filter(
          (record) =>
            !activeParticipants.some(
              (participant) => participant.userId === record.attachment.userId,
            ),
        )
        .map((record) => toParticipant(record.attachment)),
    ];
    const publications = [
      ...activePublications,
      ...suspended.flatMap((record) =>
        activePublications.some((publication) => publication.userId === record.attachment.userId)
          ? []
          : record.attachment.publications
              .filter((publication) => !publication.pending)
              .map(toPublicPublication),
      ),
    ];

    this.send(server, {
      v: ROOM_PROTOCOL_VERSION,
      type: 'room.ready',
      payload: {
        connectionId: attachment.connectionId,
        callInstanceId: attachment.callInstanceId,
        connectionEpoch: attachment.connectionEpoch,
        resumed,
        participants,
        publications,
      },
    });
    if (resumed) {
      this.send(server, {
        v: ROOM_PROTOCOL_VERSION,
        type: 'connection.restored',
        payload: { connectionEpoch: attachment.connectionEpoch },
      });
      this.broadcast(
        { v: ROOM_PROTOCOL_VERSION, type: 'member.updated', payload: toParticipant(attachment) },
        server,
      );
    } else {
      this.broadcast(
        { v: ROOM_PROTOCOL_VERSION, type: 'member.joined', payload: toParticipant(attachment) },
        server,
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): void {
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

    if (result.data.type === 'member.updated') {
      attachment.deafened = result.data.payload.deafened;
      attachment.muted = result.data.payload.muted || attachment.deafened;
      if (attachment.muted) attachment.speaking = false;
      socket.serializeAttachment(attachment);
      this.broadcast({
        v: ROOM_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: toParticipant(attachment),
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
      this.broadcast({
        v: ROOM_PROTOCOL_VERSION,
        type: speaking ? 'voice.speaking' : 'voice.stopped',
        payload: { userId: attachment.userId },
      });
      return;
    }

    if (result.data.type === 'heartbeat') {
      if (
        result.data.payload.connectionEpoch !== undefined &&
        result.data.payload.connectionEpoch !== attachment.connectionEpoch
      ) {
        return;
      }
      attachment.lastHeartbeatAt = now;
      attachment.visibility = result.data.payload.visibility ?? attachment.visibility;
      socket.serializeAttachment(attachment);
      this.send(socket, {
        v: ROOM_PROTOCOL_VERSION,
        type: 'heartbeat.ack',
        payload: { serverTime: now },
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
    const replacementIsOpen = this.ctx
      .getWebSockets(`user:${attachment.userId}`)
      .some((candidate) => candidate !== socket && candidate.readyState === WebSocket.OPEN);
    if (replacementIsOpen) return;
    if (code !== 1000 && code !== 4001 && code !== 4003) {
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
      const sessionActive = await this.sessionIsActive(
        record.attachment.sessionId,
        record.attachment.userId,
      );
      if (record.expiresAt <= now || !sessionActive) {
        this.finalizeConnection(undefined, record.attachment, 'network_failure');
        await this.ctx.storage.delete(key);
      }
    }

    const sockets = this.ctx
      .getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN);
    const validity = await Promise.all(
      sockets.map(async (socket) => {
        const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
        return {
          attachment,
          active: attachment
            ? await this.sessionIsActive(attachment.sessionId, attachment.userId)
            : false,
        };
      }),
    );

    let activeConnections = 0;
    for (const [index, result] of validity.entries()) {
      const socket = sockets[index];
      if (!socket) continue;
      if (!result.active) socket.close(4003, 'Sessão encerrada');
      else activeConnections += 1;
    }
    const remainingSuspended = [...suspendedEntries.values()].some(
      (record) => record.expiresAt > now,
    );
    if (activeConnections > 0 || remainingSuspended) {
      await this.ctx.storage.setAlarm(
        Date.now() +
          (remainingSuspended
            ? Math.min(SESSION_REVALIDATION_SECONDS * 1_000, CONNECTION_RESUME_GRACE_MS)
            : SESSION_REVALIDATION_SECONDS * 1_000),
      );
    }
  }

  hasConnection(userId: string, connectionId: string): boolean {
    return this.findConnection(userId, connectionId) !== undefined;
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
    this.broadcast({ v: ROOM_PROTOCOL_VERSION, type: 'media.published', payload: publication });
    return publication;
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
    if (!this.findConnection(userId, connectionId)) return null;
    const publication = await this.findRemotePublication(userId, publicationId);
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

    const publication = await this.findRemotePublication(userId, publicationId);
    if (!publication) return null;
    connection.attachment.subscriptions.push({ publicationId, mid: '', pending: true });
    connection.socket.serializeAttachment(connection.attachment);
    return this.resolveRecord(publication);
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
    this.broadcast({
      v: ROOM_PROTOCOL_VERSION,
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
    publicationId: string,
  ): Promise<PublicationRecord | null> {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      const publication = attachment?.publications.find(
        (item) => item.publicationId === publicationId && !item.pending,
      );
      if (attachment?.userId !== requestingUserId && publication) return publication;
    }
    const suspended = await this.suspendedConnections();
    for (const record of suspended) {
      if (record.attachment.userId === requestingUserId) continue;
      const publication = record.attachment.publications.find(
        (item) => item.publicationId === publicationId && !item.pending,
      );
      if (publication) return publication;
    }
    return null;
  }

  private participants(): RoomParticipant[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return attachment ? [toParticipant(attachment)] : [];
    });
  }

  private publications(): MediaPublication[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return (
        attachment?.publications
          .filter((publication) => !publication.pending)
          .map(toPublicPublication) ?? []
      );
    });
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

  private suspendedConnectionKey(userId: string, callInstanceId: string): string {
    return `${SUSPENDED_CONNECTION_PREFIX}${userId}:${callInstanceId}`;
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
    callInstanceId: string,
    connectionId: string,
    requestedEpoch: number,
  ): Promise<ConnectionAttachment | null> {
    for (const socket of this.ctx.getWebSockets(`call:${callInstanceId}`)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const existing = socket.deserializeAttachment() as ConnectionAttachment | null;
      if (
        existing?.userId !== userId ||
        existing.sessionId !== sessionId ||
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
        cleanupStarted: false,
        lifecycleHandled: false,
        superseded: false,
      };
    }

    const key = this.suspendedConnectionKey(userId, callInstanceId);
    const suspended = await this.ctx.storage.get<SuspendedConnectionRecord>(key);
    if (
      !suspended ||
      suspended.expiresAt <= Date.now() ||
      suspended.attachment.sessionId !== sessionId ||
      suspended.attachment.connectionId !== connectionId ||
      requestedEpoch <= suspended.attachment.connectionEpoch
    ) {
      return null;
    }
    await this.ctx.storage.delete(key);
    return {
      ...suspended.attachment,
      connectionEpoch: requestedEpoch,
      cleanupStarted: false,
      lifecycleHandled: false,
      superseded: false,
    };
  }

  private async suspendConnection(attachment: ConnectionAttachment): Promise<void> {
    const suspendedAttachment = {
      ...attachment,
      cleanupStarted: false,
      lifecycleHandled: false,
      superseded: false,
      speaking: false,
    };
    await this.ctx.storage.put(
      this.suspendedConnectionKey(attachment.userId, attachment.callInstanceId),
      {
        attachment: suspendedAttachment,
        expiresAt: Date.now() + CONNECTION_RESUME_GRACE_MS,
      } satisfies SuspendedConnectionRecord,
    );
    await this.ensureSessionAlarm(Date.now() + CONNECTION_RESUME_GRACE_MS);
  }

  private async finalizeSuspendedConnections(userId: string): Promise<void> {
    const records = await this.ctx.storage.list<SuspendedConnectionRecord>({
      prefix: `${SUSPENDED_CONNECTION_PREFIX}${userId}:`,
    });
    for (const [key, record] of records) {
      this.finalizeConnection(undefined, record.attachment, 'publisher_left');
      await this.ctx.storage.delete(key);
    }
  }

  private finalizeConnection(
    socket: WebSocket | undefined,
    attachment: ConnectionAttachment,
    reason: MediaEndReason,
  ): void {
    if (socket) this.scheduleRealtimeCleanup(socket, attachment);
    else this.ctx.waitUntil(this.cleanupRealtime(attachment));
    this.broadcastUnpublished(attachment, reason);
    this.broadcast({
      v: ROOM_PROTOCOL_VERSION,
      type: 'member.left',
      payload: { userId: attachment.userId },
    });
  }

  private async ensureSessionAlarm(
    desiredTime = Date.now() + SESSION_REVALIDATION_SECONDS * 1_000,
  ): Promise<void> {
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || desiredTime < currentAlarm) {
      await this.ctx.storage.setAlarm(desiredTime);
    }
  }

  private async sessionIsActive(sessionId: string, userId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(userId)) return false;
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - SESSION_IDLE_SECONDS * 1_000).toISOString();
    const session = await this.env.DB.prepare(
      `SELECT s.id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL
         AND s.expires_at > ? AND s.last_seen_at > ? AND u.status = 'active'
       LIMIT 1`,
    )
      .bind(sessionId, userId, now.toISOString(), idleCutoff)
      .first<{ id: string }>();
    return session !== null;
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

  private scheduleRealtimeCleanup(socket: WebSocket, attachment: ConnectionAttachment): void {
    if (attachment.cleanupStarted) return;
    attachment.cleanupStarted = true;
    socket.serializeAttachment(attachment);
    this.ctx.waitUntil(this.cleanupRealtime(attachment));
  }

  private broadcastUnpublished(attachment: ConnectionAttachment, reason: MediaEndReason): void {
    for (const publication of attachment.publications) {
      if (publication.pending) continue;
      this.broadcast({
        v: ROOM_PROTOCOL_VERSION,
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

  private broadcast(message: ServerRoomMessage, excludedSocket?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== excludedSocket) this.send(socket, message);
    }
  }
}

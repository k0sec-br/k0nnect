import { DurableObject } from 'cloudflare:workers';

import {
  MAX_WEBSOCKET_INVALID_MESSAGES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
} from '../../shared/constants/security';
import {
  clientRoomMessageSchema,
  ROOM_PROTOCOL_VERSION,
  type MediaPublication,
  type MediaSource,
  type RoomParticipant,
  type ServerRoomMessage,
} from '../../shared/protocol/room';

interface PublicationRecord extends MediaPublication {
  realtimeSessionId: string;
  realtimeTrackName: string;
  mid: string;
  pending: boolean;
}

interface ConnectionAttachment {
  connectionId: string;
  userId: string;
  displayName: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  invalidMessages: number;
  messageWindowStartedAt: number;
  messagesInWindow: number;
  lastSpeakingUpdateAt: number;
  realtimeSessionId: string | null;
  publications: PublicationRecord[];
  subscriptions: { publicationId: string; mid: string }[];
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
  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Upgrade necessário.', { status: 426 });
    }

    const userId = request.headers.get('X-K0nnect-User-Id');
    const encodedDisplayName = request.headers.get('X-K0nnect-Display-Name');
    if (!userId || !encodedDisplayName) return new Response('Não autorizado.', { status: 401 });

    const displayName = decodeURIComponent(encodedDisplayName);
    for (const existingSocket of this.ctx.getWebSockets(`user:${userId}`)) {
      const existing = existingSocket.deserializeAttachment() as ConnectionAttachment | null;
      if (existing) this.broadcastUnpublished(existing);
      existingSocket.close(4001, 'Conexão substituída');
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      connectionId: crypto.randomUUID(),
      userId,
      displayName,
      muted: false,
      deafened: false,
      speaking: false,
      invalidMessages: 0,
      messageWindowStartedAt: Date.now(),
      messagesInWindow: 0,
      lastSpeakingUpdateAt: 0,
      realtimeSessionId: null,
      publications: [],
      subscriptions: [],
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`user:${userId}`, `connection:${attachment.connectionId}`]);

    this.send(server, {
      v: ROOM_PROTOCOL_VERSION,
      type: 'room.ready',
      payload: {
        connectionId: attachment.connectionId,
        participants: this.participants(),
        publications: this.publications(),
      },
    });
    this.broadcast(
      { v: ROOM_PROTOCOL_VERSION, type: 'member.joined', payload: toParticipant(attachment) },
      server,
    );
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
    }
  }

  override webSocketClose(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) return;
    const replacementIsOpen = this.ctx
      .getWebSockets(`user:${attachment.userId}`)
      .some((candidate) => candidate !== socket && candidate.readyState === WebSocket.OPEN);
    if (replacementIsOpen) return;
    this.broadcastUnpublished(attachment);
    this.broadcast({
      v: ROOM_PROTOCOL_VERSION,
      type: 'member.left',
      payload: { userId: attachment.userId },
    });
  }

  override webSocketError(socket: WebSocket): void {
    this.webSocketClose(socket);
  }

  hasConnection(userId: string, connectionId: string): boolean {
    return this.findConnection(userId, connectionId) !== undefined;
  }

  registerRealtimeSession(userId: string, connectionId: string, sessionId: string): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return false;
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

  resolvePublication(
    userId: string,
    connectionId: string,
    publicationId: string,
  ): ResolvedPublication | null {
    if (!this.findConnection(userId, connectionId)) return null;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      const record = attachment?.publications.find(
        (item) => item.publicationId === publicationId && !item.pending,
      );
      if (attachment?.userId !== userId && record) return this.resolveRecord(record);
    }
    return null;
  }

  resolveOwnedPublication(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
  ): ResolvedPublication | null {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return null;
    const record = connection.attachment.publications.find(
      (item) => item.publicationId === publicationId && !item.pending,
    );
    return record ? this.resolveRecord(record) : null;
  }

  removePublication(userId: string, connectionId: string, publicationId: string): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (!connection) return false;
    const record = connection.attachment.publications.find(
      (item) => item.publicationId === publicationId && !item.pending,
    );
    if (!record) return false;
    connection.attachment.publications = connection.attachment.publications.filter(
      (item) => item.publicationId !== publicationId,
    );
    connection.socket.serializeAttachment(connection.attachment);
    this.broadcast({
      v: ROOM_PROTOCOL_VERSION,
      type: 'media.unpublished',
      payload: { publicationId, userId },
    });
    return true;
  }

  hasOwnedPublicationSource(userId: string, connectionId: string, source: MediaSource): boolean {
    const connection = this.findConnection(userId, connectionId);
    return Boolean(
      connection?.attachment.publications.some(
        (publication) => publication.source === source && !publication.pending,
      ),
    );
  }

  registerSubscription(
    userId: string,
    connectionId: string,
    sessionId: string,
    publicationId: string,
    mid: string,
  ): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return false;
    connection.attachment.subscriptions = [
      ...connection.attachment.subscriptions.filter(
        (subscription) => subscription.publicationId !== publicationId,
      ),
      { publicationId, mid },
    ];
    connection.socket.serializeAttachment(connection.attachment);
    return true;
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
      (item) => item.publicationId === publicationId,
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
      if (attachment?.userId === userId) return { socket, attachment };
    }
    return undefined;
  }

  private broadcastUnpublished(attachment: ConnectionAttachment): void {
    for (const publication of attachment.publications) {
      if (publication.pending) continue;
      this.broadcast({
        v: ROOM_PROTOCOL_VERSION,
        type: 'media.unpublished',
        payload: { publicationId: publication.publicationId, userId: attachment.userId },
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

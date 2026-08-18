import { DurableObject } from 'cloudflare:workers';

import {
  MAX_WEBSOCKET_INVALID_MESSAGES,
  MAX_WEBSOCKET_MESSAGE_BYTES,
} from '../../shared/constants/security';
import {
  clientRoomMessageSchema,
  ROOM_PROTOCOL_VERSION,
  type RoomParticipant,
  type ServerRoomMessage,
} from '../../shared/protocol/room';

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
  audioTrackName: string | null;
}

function toParticipant(attachment: ConnectionAttachment): RoomParticipant {
  return {
    userId: attachment.userId,
    displayName: attachment.displayName,
    muted: attachment.muted,
    deafened: attachment.deafened,
    speaking: attachment.speaking,
    realtimeSessionId: attachment.realtimeSessionId,
    audioTrackName: attachment.audioTrackName,
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
      audioTrackName: null,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`user:${userId}`, `connection:${attachment.connectionId}`]);

    const participants = this.participants();
    this.send(server, {
      v: ROOM_PROTOCOL_VERSION,
      type: 'room.ready',
      payload: { connectionId: attachment.connectionId, participants },
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

  publishAudioTrack(
    userId: string,
    connectionId: string,
    sessionId: string,
    trackName: string,
  ): boolean {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.realtimeSessionId !== sessionId) return false;
    connection.attachment.audioTrackName = trackName;
    connection.socket.serializeAttachment(connection.attachment);
    this.broadcast({
      v: ROOM_PROTOCOL_VERSION,
      type: 'voice.track-published',
      payload: { userId, realtimeSessionId: sessionId, trackName },
    });
    return true;
  }

  canSubscribe(
    userId: string,
    connectionId: string,
    remoteSessionId: string,
    remoteTrackName: string,
  ): boolean {
    if (!this.findConnection(userId, connectionId)) return false;
    return this.ctx.getWebSockets().some((socket) => {
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return (
        attachment?.userId !== userId &&
        attachment?.realtimeSessionId === remoteSessionId &&
        attachment?.audioTrackName === remoteTrackName
      );
    });
  }

  ownsTrack(userId: string, connectionId: string, sessionId: string, trackName: string): boolean {
    const connection = this.findConnection(userId, connectionId);
    return (
      connection?.attachment.realtimeSessionId === sessionId &&
      connection.attachment.audioTrackName === trackName
    );
  }

  clearTrack(userId: string, connectionId: string, trackName: string): void {
    const connection = this.findConnection(userId, connectionId);
    if (connection?.attachment.audioTrackName !== trackName) return;
    connection.attachment.audioTrackName = null;
    connection.socket.serializeAttachment(connection.attachment);
  }

  private participants(): RoomParticipant[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return [];
      const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
      return attachment ? [toParticipant(attachment)] : [];
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

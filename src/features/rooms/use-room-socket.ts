import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ROOM_PROTOCOL_VERSION,
  serverRoomMessageSchema,
  type ClientRoomMessage,
  type RoomParticipant,
} from '../../../shared/protocol/room';

export type RoomConnectionState = 'connected' | 'connecting' | 'offline' | 'reconnecting';

function reconnectJitter(maximum: number): number {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return Math.floor((random / 0xffff_ffff) * maximum);
}

export function useRoomSocket(roomId: string | null) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<RoomConnectionState>('connecting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      if (!active) return;
      setConnectionState(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/socket`,
      );
      socketRef.current = socket;

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') return;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = serverRoomMessageSchema.safeParse(raw);
        if (!parsed.success) return;
        const roomMessage = parsed.data;
        if (roomMessage.type === 'room.ready') {
          setConnectionId(roomMessage.payload.connectionId);
          setParticipants(roomMessage.payload.participants);
          setConnectionState('connected');
          setMessage('');
          reconnectAttempt = 0;
          return;
        }
        if (roomMessage.type === 'member.joined' || roomMessage.type === 'member.updated') {
          setParticipants((current) => [
            ...current.filter((participant) => participant.userId !== roomMessage.payload.userId),
            roomMessage.payload,
          ]);
          return;
        }
        if (roomMessage.type === 'member.left') {
          setParticipants((current) =>
            current.filter((participant) => participant.userId !== roomMessage.payload.userId),
          );
          return;
        }
        if (roomMessage.type === 'voice.speaking' || roomMessage.type === 'voice.stopped') {
          setParticipants((current) =>
            current.map((participant) =>
              participant.userId === roomMessage.payload.userId
                ? { ...participant, speaking: roomMessage.type === 'voice.speaking' }
                : participant,
            ),
          );
          return;
        }
        if (roomMessage.type === 'voice.track-published') {
          setParticipants((current) =>
            current.map((participant) =>
              participant.userId === roomMessage.payload.userId
                ? {
                    ...participant,
                    realtimeSessionId: roomMessage.payload.realtimeSessionId,
                    audioTrackName: roomMessage.payload.trackName,
                  }
                : participant,
            ),
          );
          return;
        }
        if (roomMessage.type === 'error') setMessage(roomMessage.payload.message);
      });

      socket.addEventListener('close', (event) => {
        if (!active || event.code === 1000) return;
        setConnectionId(null);
        reconnectAttempt += 1;
        if (reconnectAttempt > 8) {
          setConnectionState('offline');
          setMessage('Sua conexão foi interrompida. Verifique sua internet para tentar novamente.');
          return;
        }
        const delay = Math.min(1_000 * 2 ** (reconnectAttempt - 1), 20_000) + reconnectJitter(500);
        setConnectionState('reconnecting');
        setMessage('Sua conexão foi interrompida. Estamos tentando reconectar.');
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener('error', () => socket.close());
    };

    const reconnectWhenOnline = () => {
      const socketState = socketRef.current?.readyState;
      if (socketState !== WebSocket.OPEN && socketState !== WebSocket.CONNECTING) {
        reconnectAttempt = 0;
        connect();
      }
    };
    window.addEventListener('online', reconnectWhenOnline);
    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.removeEventListener('online', reconnectWhenOnline);
      socketRef.current?.close(1000, 'Saindo da sala');
      socketRef.current = null;
    };
  }, [roomId]);

  const send = useCallback((roomMessage: ClientRoomMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(roomMessage));
    }
  }, []);

  const updatePresence = useCallback(
    (muted: boolean, deafened: boolean) => {
      send({
        v: ROOM_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: { muted, deafened },
      });
    },
    [send],
  );

  const updateSpeaking = useCallback(
    (speaking: boolean) => {
      send({ v: ROOM_PROTOCOL_VERSION, type: 'voice.speaking', payload: { speaking } });
    },
    [send],
  );

  return { connectionId, connectionState, message, participants, updatePresence, updateSpeaking };
}

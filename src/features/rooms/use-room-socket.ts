import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ROOM_PROTOCOL_VERSION,
  serverRoomMessageSchema,
  type ClientRoomMessage,
  type MediaPublication,
  type RoomParticipant,
} from '../../../shared/protocol/room';

export type RoomConnectionState =
  'connected' | 'connecting' | 'disconnected' | 'offline' | 'reconnecting';

interface LogicalConnection {
  callInstanceId: string;
  connectionEpoch: number;
  connectionId: string;
}

const FOREGROUND_HEARTBEAT_MS = 25_000;
const BACKGROUND_HEARTBEAT_MS = 75_000;
const SOCKET_READY_TIMEOUT_MS = 10_000;

export function shouldReconnectRoomSocket(closeCode: number): boolean {
  return closeCode !== 1000 && closeCode !== 4001 && closeCode !== 4003;
}

export function roomSocketIsStale(
  lastServerMessageAt: number,
  visibility: DocumentVisibilityState,
  now = Date.now(),
): boolean {
  const tolerance = visibility === 'hidden' ? 210_000 : 70_000;
  return now - lastServerMessageAt > tolerance;
}

export function useRoomSocket(roomId: string | null) {
  const activeRef = useRef(false);
  const connectRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const logicalConnectionRef = useRef<LogicalConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const transportGenerationRef = useRef(0);
  const lastServerMessageAtRef = useRef(0);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [publications, setPublications] = useState<MediaPublication[]>([]);
  const [connectionState, setConnectionState] = useState<RoomConnectionState>('connecting');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!roomId) return;
    activeRef.current = true;
    lastServerMessageAtRef.current = Date.now();
    let heartbeatTimer: number | null = null;

    const scheduleHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearTimeout(heartbeatTimer);
      const delay =
        document.visibilityState === 'hidden' ? BACKGROUND_HEARTBEAT_MS : FOREGROUND_HEARTBEAT_MS;
      heartbeatTimer = window.setTimeout(() => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              v: ROOM_PROTOCOL_VERSION,
              type: 'heartbeat',
              payload: {
                visibility: document.visibilityState === 'hidden' ? 'background' : 'foreground',
                ...(logicalConnectionRef.current
                  ? { connectionEpoch: logicalConnectionRef.current.connectionEpoch }
                  : {}),
              },
            } satisfies ClientRoomMessage),
          );
        }
        scheduleHeartbeat();
      }, delay);
    };

    const connect = async (): Promise<boolean> => {
      if (!activeRef.current) return false;
      const currentSocket = socketRef.current;
      if (currentSocket?.readyState === WebSocket.OPEN) return true;
      if (currentSocket?.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve) => {
          const timeout = window.setTimeout(() => resolve(false), SOCKET_READY_TIMEOUT_MS);
          currentSocket.addEventListener(
            'open',
            () => {
              window.clearTimeout(timeout);
              resolve(true);
            },
            { once: true },
          );
          currentSocket.addEventListener(
            'close',
            () => {
              window.clearTimeout(timeout);
              resolve(false);
            },
            { once: true },
          );
        });
      }

      const generation = transportGenerationRef.current + 1;
      transportGenerationRef.current = generation;
      const logicalConnection = logicalConnectionRef.current;
      const requestedEpoch = logicalConnection ? logicalConnection.connectionEpoch + 1 : 1;
      setConnectionState(logicalConnection ? 'reconnecting' : 'connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(
        `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/socket`,
      );
      if (logicalConnection) {
        url.searchParams.set('callInstanceId', logicalConnection.callInstanceId);
        url.searchParams.set('connectionId', logicalConnection.connectionId);
        url.searchParams.set('connectionEpoch', String(requestedEpoch));
      }
      const socket = new WebSocket(url);
      socketRef.current = socket;

      return new Promise((resolve) => {
        let settled = false;
        const settle = (result: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          resolve(result);
        };
        const timeout = window.setTimeout(() => {
          if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
            socket.close(4000, 'Timeout de conexão');
          }
          settle(false);
        }, SOCKET_READY_TIMEOUT_MS);

        socket.addEventListener('message', (event) => {
          if (generation !== transportGenerationRef.current || typeof event.data !== 'string') {
            return;
          }
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return;
          }
          const parsed = serverRoomMessageSchema.safeParse(raw);
          if (!parsed.success) return;
          lastServerMessageAtRef.current = Date.now();
          const roomMessage = parsed.data;
          if (roomMessage.type === 'room.ready') {
            logicalConnectionRef.current = {
              callInstanceId: roomMessage.payload.callInstanceId,
              connectionEpoch: roomMessage.payload.connectionEpoch,
              connectionId: roomMessage.payload.connectionId,
            };
            setConnectionId(roomMessage.payload.connectionId);
            setParticipants(roomMessage.payload.participants);
            setPublications(roomMessage.payload.publications);
            setConnectionState('connected');
            setMessage('');
            settle(true);
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
            setPublications((current) =>
              current.filter((publication) => publication.userId !== roomMessage.payload.userId),
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
          if (roomMessage.type === 'media.published') {
            setPublications((current) => [
              ...current.filter(
                (publication) => publication.publicationId !== roomMessage.payload.publicationId,
              ),
              roomMessage.payload,
            ]);
            return;
          }
          if (roomMessage.type === 'media.unpublished') {
            setPublications((current) =>
              current.filter(
                (publication) => publication.publicationId !== roomMessage.payload.publicationId,
              ),
            );
            return;
          }
          if (roomMessage.type === 'error') setMessage(roomMessage.payload.message);
        });

        socket.addEventListener('close', (event) => {
          if (generation !== transportGenerationRef.current) return;
          settle(false);
          if (!activeRef.current) return;
          if (!shouldReconnectRoomSocket(event.code)) {
            if (event.code === 4001) {
              logicalConnectionRef.current = null;
              setConnectionId(null);
              setPublications([]);
              setConnectionState('offline');
              setMessage('Esta conta foi conectada à sala em outro dispositivo.');
            } else if (event.code === 4003) {
              setConnectionState('offline');
              setMessage('Sua sessão foi encerrada. Entre novamente para continuar.');
            }
            return;
          }
          setConnectionState('disconnected');
        });

        socket.addEventListener('error', () => socket.close(4000, 'Erro de transporte'));
      });
    };

    connectRef.current = connect;
    scheduleHeartbeat();
    void connect();
    return () => {
      activeRef.current = false;
      transportGenerationRef.current += 1;
      if (heartbeatTimer !== null) window.clearTimeout(heartbeatTimer);
      socketRef.current?.close(1000, 'Saindo da sala');
      socketRef.current = null;
      logicalConnectionRef.current = null;
      setConnectionId(null);
    };
  }, [roomId]);

  const reconcile = useCallback(async () => {
    const socket = socketRef.current;
    if (
      socket?.readyState === WebSocket.OPEN &&
      !roomSocketIsStale(lastServerMessageAtRef.current, document.visibilityState)
    ) {
      return true;
    }
    if (socket?.readyState === WebSocket.OPEN) {
      transportGenerationRef.current += 1;
      socketRef.current = null;
      socket.close(4000, 'Conexão sem resposta');
    }
    return connectRef.current();
  }, []);

  const disconnect = useCallback(() => {
    activeRef.current = false;
    transportGenerationRef.current += 1;
    socketRef.current?.close(1000, 'Saindo da sala');
    socketRef.current = null;
    logicalConnectionRef.current = null;
    setConnectionId(null);
    setConnectionState('offline');
  }, []);

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

  return {
    connectionId,
    connectionState,
    connectionIdentity: () => logicalConnectionRef.current,
    disconnect,
    lastServerMessageAt: () => lastServerMessageAtRef.current,
    message,
    participants,
    publications,
    reconcile,
    updatePresence,
    updateSpeaking,
  };
}

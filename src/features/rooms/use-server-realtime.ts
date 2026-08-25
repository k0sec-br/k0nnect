import { useCallback, useEffect, useRef, useState } from 'react';

import {
  REALTIME_PROTOCOL_VERSION,
  serverRoomMessageSchema,
  type CallParticipant,
  type ClientRoomMessage,
  type MediaPublication,
} from '../../../shared/protocol/room';
import type { ChatMessageView, MemberView, SocialStateView } from '../../../shared/types/api';
import { incrementDevelopmentMetric } from '../../lib/development-metrics';
import {
  clearRealtimeResumeIdentity,
  loadRealtimeResumeIdentity,
  saveRealtimeResumeIdentity,
} from './realtime-resume';

export type RealtimeConnectionState =
  'connected' | 'connecting' | 'disconnected' | 'offline' | 'reconnecting';

interface LogicalConnection {
  connectionEpoch: number;
  connectionId: string;
}

interface PendingCommand {
  reject(error: Error): void;
  resolve(): void;
  timer: number;
}

const SOCKET_READY_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 8_000;
const EMPTY_CHAT_MESSAGES: ChatMessageView[] = [];
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

export class CallConflictError extends Error {
  override name = 'CallConflictError';

  constructor(readonly channelId: string) {
    super('Esta conta já está em uma chamada em outro dispositivo.');
  }
}

export function shouldReconnectServerSocket(closeCode: number): boolean {
  return closeCode !== 1000 && closeCode !== 4003;
}

export function useServerRealtime(
  serverId: string | null,
  userId: string | null,
  onMemberEvent: (
    type: 'member.added' | 'member.updated' | 'member.removed',
    member: MemberView,
  ) => void,
  onSocialChange: (state: SocialStateView) => void,
) {
  const activeRef = useRef(false);
  const connectRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const logicalConnectionRef = useRef<LogicalConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const transportGenerationRef = useRef(0);
  const pendingCommandsRef = useRef(new Map<string, PendingCommand>());
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [publications, setPublications] = useState<MediaPublication[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<RealtimeConnectionState>('offline');
  const [message, setMessage] = useState('');
  const [callReplacementCount, setCallReplacementCount] = useState(0);
  const chatMessagesRef = useRef<Record<string, ChatMessageView[]>>({});
  const historyLoadedConversationIdsRef = useRef(new Set<string>());
  const chatListenersRef = useRef(new Map<string, Set<() => void>>());
  const chatRecencyRef = useRef<string[]>([]);

  const updateChat = useCallback(
    (conversationId: string, update: (messages: ChatMessageView[]) => ChatMessageView[]) => {
      chatRecencyRef.current = [
        conversationId,
        ...chatRecencyRef.current.filter((id) => id !== conversationId),
      ].slice(0, 5);
      const retainedIds = new Set(chatRecencyRef.current);
      const previous = chatMessagesRef.current;
      const next = {
        ...previous,
        [conversationId]: update(previous[conversationId] ?? EMPTY_CHAT_MESSAGES).slice(-100),
      };
      const changedIds = new Set([conversationId]);
      for (const cachedId of Object.keys(next)) {
        if (!retainedIds.has(cachedId)) {
          delete next[cachedId];
          historyLoadedConversationIdsRef.current.delete(cachedId);
          changedIds.add(cachedId);
        }
      }
      chatMessagesRef.current = next;
      for (const changedId of changedIds) {
        for (const listener of chatListenersRef.current.get(changedId) ?? []) listener();
      }
    },
    [],
  );

  const settleCommand = useCallback((requestId: string, error?: Error) => {
    const pending = pendingCommandsRef.current.get(requestId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingCommandsRef.current.delete(requestId);
    if (error) pending.reject(error);
    else pending.resolve();
  }, []);

  useEffect(() => {
    if (!serverId || !userId) return;
    activeRef.current = true;
    const persistedConnection = loadRealtimeResumeIdentity(serverId, userId);
    logicalConnectionRef.current = persistedConnection
      ? {
          connectionId: persistedConnection.connectionId,
          connectionEpoch: persistedConnection.connectionEpoch,
        }
      : null;
    let pageIsUnloading = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    const pendingCommands = pendingCommandsRef.current;
    const historyLoadedConversationIds = historyLoadedConversationIdsRef.current;
    const chatListeners = chatListenersRef.current;

    let scheduleReconnect = (_immediate = false) => undefined;
    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
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
      if (logicalConnection) incrementDevelopmentMetric('wsReconnects');
      const requestedEpoch = logicalConnection ? logicalConnection.connectionEpoch + 1 : 1;
      setConnectionState(logicalConnection ? 'reconnecting' : 'connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = new URL(
        `${protocol}//${window.location.host}/api/servers/${encodeURIComponent(serverId)}/socket`,
      );
      if (logicalConnection) {
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
          socket.close(4000, 'Timeout de conexão');
          settle(false);
        }, SOCKET_READY_TIMEOUT_MS);

        socket.addEventListener('message', (event) => {
          if (generation !== transportGenerationRef.current || typeof event.data !== 'string')
            return;
          incrementDevelopmentMetric('wsMessagesReceived');
          let raw: unknown;
          try {
            raw = JSON.parse(event.data);
          } catch {
            return;
          }
          const parsed = serverRoomMessageSchema.safeParse(raw);
          if (!parsed.success) return;
          const realtimeMessage = parsed.data;
          if (realtimeMessage.type === 'server.ready') {
            logicalConnectionRef.current = {
              connectionEpoch: realtimeMessage.payload.connectionEpoch,
              connectionId: realtimeMessage.payload.connectionId,
            };
            saveRealtimeResumeIdentity(serverId, userId, logicalConnectionRef.current);
            reconnectAttempt = 0;
            clearReconnectTimer();
            setConnectionId(realtimeMessage.payload.connectionId);
            setOnlineUserIds(realtimeMessage.payload.onlineUserIds);
            setParticipants(realtimeMessage.payload.participants);
            setPublications(realtimeMessage.payload.publications);
            setConnectionState('connected');
            setMessage('');
            settle(true);
            return;
          }
          if (realtimeMessage.type === 'state.snapshot') {
            setOnlineUserIds(realtimeMessage.payload.onlineUserIds);
            setParticipants(realtimeMessage.payload.participants);
            setPublications(realtimeMessage.payload.publications);
            return;
          }
          if (realtimeMessage.type === 'presence.changed') {
            setOnlineUserIds((current) =>
              realtimeMessage.payload.online
                ? [...new Set([...current, realtimeMessage.payload.userId])]
                : current.filter((id) => id !== realtimeMessage.payload.userId),
            );
            return;
          }
          if (realtimeMessage.type === 'call.joined') {
            setParticipants((current) => [
              ...current.filter(
                (participant) => participant.channelId !== realtimeMessage.payload.channelId,
              ),
              ...realtimeMessage.payload.participants,
            ]);
            setPublications(realtimeMessage.payload.publications);
            settleCommand(realtimeMessage.payload.requestId);
            return;
          }
          if (realtimeMessage.type === 'call.conflict') {
            settleCommand(
              realtimeMessage.payload.requestId,
              new CallConflictError(realtimeMessage.payload.channelId),
            );
            return;
          }
          if (realtimeMessage.type === 'call.replaced') {
            setParticipants((current) =>
              current.filter((participant) => participant.userId !== userId),
            );
            setPublications((current) =>
              current.filter((publication) => publication.userId !== userId),
            );
            setCallReplacementCount((current) => current + 1);
            return;
          }
          if (realtimeMessage.type === 'call.left') {
            settleCommand(realtimeMessage.payload.requestId);
            return;
          }
          if (
            realtimeMessage.type === 'call.member.joined' ||
            realtimeMessage.type === 'call.member.updated'
          ) {
            setParticipants((current) => [
              ...current.filter(
                (participant) => participant.userId !== realtimeMessage.payload.userId,
              ),
              realtimeMessage.payload,
            ]);
            return;
          }
          if (realtimeMessage.type === 'call.member.left') {
            setParticipants((current) =>
              current.filter(
                (participant) => participant.userId !== realtimeMessage.payload.userId,
              ),
            );
            setPublications((current) =>
              current.filter(
                (publication) => publication.userId !== realtimeMessage.payload.userId,
              ),
            );
            if (realtimeMessage.payload.requestId) settleCommand(realtimeMessage.payload.requestId);
            return;
          }
          if (
            realtimeMessage.type === 'voice.speaking' ||
            realtimeMessage.type === 'voice.stopped'
          ) {
            setParticipants((current) =>
              current.map((participant) =>
                participant.userId === realtimeMessage.payload.userId
                  ? { ...participant, speaking: realtimeMessage.type === 'voice.speaking' }
                  : participant,
              ),
            );
            return;
          }
          if (realtimeMessage.type === 'media.published') {
            setPublications((current) => [
              ...current.filter(
                (publication) =>
                  publication.publicationId !== realtimeMessage.payload.publicationId,
              ),
              realtimeMessage.payload,
            ]);
            return;
          }
          if (realtimeMessage.type === 'media.unpublished') {
            setPublications((current) =>
              current.filter(
                (publication) =>
                  publication.publicationId !== realtimeMessage.payload.publicationId,
              ),
            );
            return;
          }
          if (realtimeMessage.type === 'chat.message') {
            updateChat(realtimeMessage.payload.conversationId, (current) => [
              ...current.filter(
                (message) =>
                  message.clientMessageId !== realtimeMessage.payload.clientMessageId &&
                  message.id !== realtimeMessage.payload.id,
              ),
              { ...realtimeMessage.payload, deliveryState: 'sent' },
            ]);
            return;
          }
          if (realtimeMessage.type === 'chat.updated') {
            updateChat(realtimeMessage.payload.conversationId, (current) =>
              current.map((message) =>
                message.id === realtimeMessage.payload.id
                  ? {
                      ...message,
                      content: realtimeMessage.payload.content,
                      editedAt: realtimeMessage.payload.editedAt,
                    }
                  : message,
              ),
            );
            return;
          }
          if (realtimeMessage.type === 'chat.deleted') {
            updateChat(realtimeMessage.payload.conversationId, (current) =>
              current.map((message) =>
                message.id === realtimeMessage.payload.id
                  ? { ...message, content: null, deletedAt: realtimeMessage.payload.deletedAt }
                  : message,
              ),
            );
            return;
          }
          if (realtimeMessage.type === 'social.changed') {
            incrementDevelopmentMetric('internalNotifications');
            onSocialChange({
              friends: realtimeMessage.payload.friends,
              friendRequests: realtimeMessage.payload.friendRequests,
              conversations: realtimeMessage.payload.conversations,
            });
            return;
          }
          if (
            realtimeMessage.type === 'member.added' ||
            realtimeMessage.type === 'member.updated' ||
            realtimeMessage.type === 'member.removed'
          ) {
            onMemberEvent(realtimeMessage.type, realtimeMessage.payload);
            return;
          }
          if (realtimeMessage.type === 'error') {
            setMessage(realtimeMessage.payload.message);
            if (realtimeMessage.payload.requestId) {
              for (const [conversationId, messages] of Object.entries(chatMessagesRef.current)) {
                if (
                  messages.some(
                    (item) => item.clientMessageId === realtimeMessage.payload.requestId,
                  )
                ) {
                  updateChat(conversationId, (current) =>
                    current.map((item) =>
                      item.clientMessageId === realtimeMessage.payload.requestId
                        ? { ...item, deliveryState: 'failed' as const }
                        : item,
                    ),
                  );
                }
              }
              settleCommand(
                realtimeMessage.payload.requestId,
                new Error(realtimeMessage.payload.message),
              );
            }
          }
        });

        socket.addEventListener('close', (event) => {
          if (generation !== transportGenerationRef.current) return;
          settle(false);
          if (!activeRef.current) return;
          if (!shouldReconnectServerSocket(event.code)) {
            if (event.code === 4003) {
              logicalConnectionRef.current = null;
              clearRealtimeResumeIdentity(serverId, userId);
              setConnectionId(null);
              setConnectionState('offline');
              setMessage('Sua sessão foi encerrada. Entre novamente para continuar.');
            }
            return;
          }
          setConnectionState('disconnected');
          scheduleReconnect();
        });
        socket.addEventListener('error', () => socket.close(4000, 'Erro de transporte'));
      });
    };

    scheduleReconnect = (immediate = false) => {
      if (!activeRef.current || reconnectTimer !== null || !navigator.onLine) return;
      const delay = immediate ? 0 : RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect().then((connected) => {
          if (!connected) scheduleReconnect();
        });
      }, delay);
    };

    const handleOnline = () => scheduleReconnect(true);
    const handlePageHide = () => {
      pageIsUnloading = true;
      socketRef.current?.close(4004, 'Suspending realtime connection');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('pagehide', handlePageHide);

    connectRef.current = connect;
    void connect().then((connected) => {
      if (!connected) scheduleReconnect();
    });
    return () => {
      activeRef.current = false;
      clearReconnectTimer();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('pagehide', handlePageHide);
      transportGenerationRef.current += 1;
      socketRef.current?.close(
        pageIsUnloading ? 4004 : 1000,
        pageIsUnloading ? 'Suspending realtime connection' : 'Leaving server',
      );
      socketRef.current = null;
      logicalConnectionRef.current = null;
      if (!pageIsUnloading) clearRealtimeResumeIdentity(serverId, userId);
      setConnectionId(null);
      for (const pending of pendingCommands.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('Conexão encerrada.'));
      }
      pendingCommands.clear();
      const cachedConversationIds = Object.keys(chatMessagesRef.current);
      chatMessagesRef.current = {};
      historyLoadedConversationIds.clear();
      chatRecencyRef.current = [];
      for (const conversationId of cachedConversationIds) {
        for (const listener of chatListeners.get(conversationId) ?? []) listener();
      }
    };
  }, [onMemberEvent, onSocialChange, serverId, settleCommand, updateChat, userId]);

  const reconcile = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return true;
    return connectRef.current();
  }, []);

  const sendCommand = useCallback(async (message: ClientRoomMessage, requestId: string) => {
    if (!(await connectRef.current())) throw new Error('Conexão realtime indisponível.');
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('Conexão realtime indisponível.');
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingCommandsRef.current.delete(requestId);
        reject(new Error('O servidor não confirmou esta ação a tempo.'));
      }, COMMAND_TIMEOUT_MS);
      pendingCommandsRef.current.set(requestId, { reject, resolve, timer });
      socket.send(JSON.stringify(message));
      incrementDevelopmentMetric('wsMessagesSent');
    });
  }, []);

  const joinCall = useCallback(
    (channelId: string, takeover = false) => {
      setMessage('');
      const requestId = crypto.randomUUID();
      return sendCommand(
        {
          v: REALTIME_PROTOCOL_VERSION,
          type: takeover ? 'call.takeover' : 'call.join',
          payload: { channelId, requestId },
        },
        requestId,
      );
    },
    [sendCommand],
  );

  const leaveCall = useCallback(() => {
    const requestId = crypto.randomUUID();
    setParticipants((current) => current.filter((participant) => participant.userId !== userId));
    setPublications((current) => current.filter((publication) => publication.userId !== userId));
    return sendCommand(
      { v: REALTIME_PROTOCOL_VERSION, type: 'call.leave', payload: { requestId } },
      requestId,
    );
  }, [sendCommand, userId]);

  const send = useCallback((realtimeMessage: ClientRoomMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(realtimeMessage));
      incrementDevelopmentMetric('wsMessagesSent');
    }
  }, []);

  const sendChat = useCallback(
    async (
      target: { conversationId: string } | { recipientUserId: string },
      content: string,
      retryClientMessageId?: string,
    ) => {
      if (!(await connectRef.current())) throw new Error('Conexão realtime indisponível.');
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) throw new Error('Conexão realtime indisponível.');
      const clientMessageId = retryClientMessageId ?? crypto.randomUUID();
      const cacheId =
        'conversationId' in target ? target.conversationId : `pending_${target.recipientUserId}`;
      updateChat(cacheId, (current) => [
        ...current.filter((message) => message.clientMessageId !== clientMessageId),
        {
          id: -Date.now(),
          conversationId: cacheId,
          senderId: userId!,
          clientMessageId,
          content,
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          deliveryState: 'sending',
        },
      ]);
      socket.send(
        JSON.stringify({
          v: REALTIME_PROTOCOL_VERSION,
          type: 'chat.send',
          payload: { ...target, clientMessageId, content },
        } satisfies ClientRoomMessage),
      );
      incrementDevelopmentMetric('wsMessagesSent');
      incrementDevelopmentMetric('d1Writes');
      return clientMessageId;
    },
    [updateChat, userId],
  );

  const getChatMessages = useCallback(
    (conversationId: string | null) =>
      conversationId
        ? (chatMessagesRef.current[conversationId] ?? EMPTY_CHAT_MESSAGES)
        : EMPTY_CHAT_MESSAGES,
    [],
  );

  const subscribeChat = useCallback((conversationId: string | null, listener: () => void) => {
    if (!conversationId) return () => undefined;
    const listeners = chatListenersRef.current.get(conversationId) ?? new Set();
    listeners.add(listener);
    chatListenersRef.current.set(conversationId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) chatListenersRef.current.delete(conversationId);
    };
  }, []);

  const setConversationMessages = useCallback(
    (conversationId: string, messages: ChatMessageView[]) => {
      historyLoadedConversationIdsRef.current.add(conversationId);
      updateChat(conversationId, () => messages);
    },
    [updateChat],
  );

  const isHistoryLoaded = useCallback(
    (conversationId: string | null) =>
      Boolean(conversationId && historyLoadedConversationIdsRef.current.has(conversationId)),
    [],
  );

  return {
    callReplacementCount,
    connectionId,
    connectionState,
    connectionIdentity: () => logicalConnectionRef.current,
    getChatMessages,
    isHistoryLoaded,
    joinCall,
    leaveCall,
    message,
    onlineUserIds,
    participants,
    publications,
    reconcile,
    sendChat,
    setConversationMessages,
    subscribeChat,
    updatePresence: (muted: boolean, deafened: boolean) =>
      send({
        v: REALTIME_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: { muted, deafened },
      }),
    updateSpeaking: (speaking: boolean) =>
      send({ v: REALTIME_PROTOCOL_VERSION, type: 'voice.speaking', payload: { speaking } }),
  };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { RoomView } from '../../../shared/types/api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { useRoomSocket } from '../rooms/use-room-socket';
import { useVoiceSession } from '../voice/use-voice-session';

interface CallContextValue {
  activateRoom(): void;
  config: ReturnType<typeof usePublicConfig>;
  loadError: string;
  room: RoomView | null;
  socket: ReturnType<typeof useRoomSocket>;
  voice: ReturnType<typeof useVoiceSession>;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const config = usePublicConfig();
  const [activated, setActivated] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [loadError, setLoadError] = useState('');
  const roomRequestRef = useRef<Promise<void> | null>(null);
  const previousUserIdRef = useRef<string | null>(null);

  const socket = useRoomSocket(user && activated ? (room?.id ?? null) : null);
  const voice = useVoiceSession({
    roomId: room?.id ?? 'room_general',
    connectionId: socket.connectionId,
    publications: socket.publications.filter((publication) => publication.userId !== user?.id),
    updatePresence: socket.updatePresence,
    updateSpeaking: socket.updateSpeaking,
  });

  const activateRoom = useCallback(() => setActivated(true), []);

  useEffect(() => {
    if (!user || !activated || room || roomRequestRef.current) return;
    setLoadError('');
    const request = apiClient
      .get<{ rooms: RoomView[] }>('/api/rooms')
      .then((result) => {
        const firstRoom = result.rooms[0] ?? null;
        setRoom(firstRoom);
        if (!firstRoom) setLoadError('Nenhuma sala está disponível agora.');
      })
      .catch(() => setLoadError('Não foi possível carregar as salas agora.'))
      .finally(() => {
        roomRequestRef.current = null;
      });
    roomRequestRef.current = request;
  }, [activated, room, user]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = user?.id ?? null;
    previousUserIdRef.current = currentUserId;
    if (!previousUserId || previousUserId === currentUserId) return;
    void voice.leave();
    setActivated(false);
    setRoom(null);
    setLoadError('');
    roomRequestRef.current = null;
  }, [user?.id, voice]);

  const value = useMemo<CallContextValue>(
    () => ({ activateRoom, config, loadError, room, socket, voice }),
    [activateRoom, config, loadError, room, socket, voice],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('CallProvider ausente');
  return context;
}

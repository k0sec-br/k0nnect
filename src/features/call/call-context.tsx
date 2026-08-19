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

import type { RoomParticipant } from '../../../shared/protocol/room';
import type { MemberView, RoomView } from '../../../shared/types/api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useAuth } from '../auth/auth-context';
import { useServerRealtime } from '../rooms/use-server-realtime';
import { useVoiceSession } from '../voice/use-voice-session';
import { useCallConnectionSupervisor } from './use-call-connection-supervisor';

interface CallContextValue {
  config: ReturnType<typeof usePublicConfig>;
  loadError: string;
  members: MemberView[];
  room: RoomView | null;
  socket: Omit<ReturnType<typeof useServerRealtime>, 'participants'> & {
    participants: RoomParticipant[];
  };
  voice: ReturnType<typeof useVoiceSession>;
  connectionState: ReturnType<typeof useCallConnectionSupervisor>['state'];
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { bootstrap, user } = useAuth();
  const config = usePublicConfig();
  const room = bootstrap?.channels[0] ?? null;
  const loadError = bootstrap && !room ? 'Nenhuma sala está disponível agora.' : '';
  const [members, setMembers] = useState<MemberView[]>([]);

  useEffect(() => setMembers(bootstrap?.members ?? []), [bootstrap]);

  const handleMemberEvent = useCallback(
    (type: 'member.added' | 'member.updated' | 'member.removed', member: MemberView) => {
      setMembers((current) =>
        type === 'member.removed'
          ? current.filter((item) => item.id !== member.id)
          : [...current.filter((item) => item.id !== member.id), member],
      );
    },
    [],
  );

  const realtime = useServerRealtime(
    user && bootstrap ? bootstrap.server.id : null,
    user?.id ?? null,
    handleMemberEvent,
  );
  const participants = useMemo<RoomParticipant[]>(
    () =>
      realtime.participants.flatMap((participant) => {
        const member = members.find((item) => item.id === participant.userId);
        return member ? [{ ...participant, displayName: member.displayName }] : [];
      }),
    [members, realtime.participants],
  );
  const socket = useMemo(() => ({ ...realtime, participants }), [participants, realtime]);
  const voice = useVoiceSession({
    roomId: room?.id ?? 'room_general',
    connectionId: socket.connectionId,
    publications: socket.publications.filter((publication) => publication.userId !== user?.id),
    joinCall: socket.joinCall,
    leaveCall: socket.leaveCall,
    updatePresence: socket.updatePresence,
    updateSpeaking: socket.updateSpeaking,
  });
  const handledCallReplacementRef = useRef(0);
  useEffect(() => {
    if (socket.callReplacementCount <= handledCallReplacementRef.current) return;
    handledCallReplacementRef.current = socket.callReplacementCount;
    if (voice.status !== 'idle') void voice.leave();
  }, [socket.callReplacementCount, voice]);
  const supervisor = useCallConnectionSupervisor({
    active: Boolean(user && bootstrap),
    socket,
    voice,
  });

  const value = useMemo<CallContextValue>(
    () => ({
      config,
      connectionState: supervisor.state,
      loadError,
      members,
      room,
      socket,
      voice,
    }),
    [config, loadError, members, room, socket, supervisor.state, voice],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('CallProvider ausente');
  return context;
}

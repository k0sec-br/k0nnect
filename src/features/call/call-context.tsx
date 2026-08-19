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
import type {
  ConversationSummary,
  FriendRequestView,
  FriendView,
  MemberView,
  RoomView,
  SocialStateView,
} from '../../../shared/types/api';
import { usePublicConfig } from '../../hooks/use-public-config';
import { useAuth } from '../auth/auth-context';
import { useServerRealtime } from '../rooms/use-server-realtime';
import { useVoiceSession } from '../voice/use-voice-session';
import { useCallConnectionSupervisor } from './use-call-connection-supervisor';

interface CallContextValue {
  config: ReturnType<typeof usePublicConfig>;
  loadError: string;
  members: MemberView[];
  friends: FriendView[];
  friendRequests: FriendRequestView[];
  conversations: ConversationSummary[];
  selectedConversation: ConversationSummary | null;
  callConversation: ConversationSummary | null;
  selectConversation(conversationId: string): void;
  selectCallConversation(conversationId: string): void;
  room: RoomView | null;
  socket: Omit<ReturnType<typeof useServerRealtime>, 'participants'> & {
    participants: RoomParticipant[];
  };
  voice: ReturnType<typeof useVoiceSession>;
  connectionState: ReturnType<typeof useCallConnectionSupervisor>['state'];
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const { bootstrap, updateSocialState, user } = useAuth();
  const config = usePublicConfig();
  const defaultConversation = bootstrap?.conversations.find(
    (conversation) => conversation.isDefault,
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [callConversationId, setCallConversationId] = useState<string | null>(null);
  const selectedConversation =
    bootstrap?.conversations.find((conversation) => conversation.id === selectedConversationId) ??
    defaultConversation ??
    bootstrap?.conversations[0] ??
    null;
  const callConversation =
    bootstrap?.conversations.find((conversation) => conversation.id === callConversationId) ??
    defaultConversation ??
    null;
  const room =
    bootstrap?.channels.find((channel) => channel.id === callConversation?.callRoomId) ?? null;
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

  const handleSocialChange = useCallback(
    (state: SocialStateView) => updateSocialState(state),
    [updateSocialState],
  );

  const realtime = useServerRealtime(
    user && bootstrap ? bootstrap.server.id : null,
    user?.id ?? null,
    handleMemberEvent,
    handleSocialChange,
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
      friends: bootstrap?.friends ?? [],
      friendRequests: bootstrap?.friendRequests ?? [],
      conversations: bootstrap?.conversations ?? [],
      selectedConversation,
      callConversation,
      selectConversation: setSelectedConversationId,
      selectCallConversation: setCallConversationId,
      connectionState: supervisor.state,
      loadError,
      members,
      room,
      socket,
      voice,
    }),
    [
      bootstrap,
      callConversation,
      config,
      loadError,
      members,
      room,
      selectedConversation,
      socket,
      supervisor.state,
      voice,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('CallProvider ausente');
  return context;
}

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
import {
  clearCallResumeState,
  loadCallResumeState,
  saveCallResumeState,
  type CallResumeState,
} from './call-resume';

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
  joinConversationCall(conversationId: string): void;
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
    (conversation) => conversation.spaceKind === 'community',
  );
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [callConversationId, setCallConversationId] = useState<string | null>(null);
  const callResumeRef = useRef<CallResumeState | null>(null);
  const resumedCallRef = useRef(false);
  const shouldResumeCameraRef = useRef(false);
  const hadActiveCallRef = useRef(false);
  const switchingCallRef = useRef(false);
  const selectedConversation =
    bootstrap?.conversations.find((conversation) => conversation.id === selectedConversationId) ??
    defaultConversation ??
    bootstrap?.conversations[0] ??
    null;
  const callConversation =
    bootstrap?.conversations.find((conversation) => conversation.id === callConversationId) ??
    defaultConversation ??
    null;
  const room = useMemo<RoomView | null>(() => {
    const persistedRoom = bootstrap?.channels.find(
      (channel) => channel.id === callConversation?.callRoomId,
    );
    return (
      persistedRoom ??
      (callConversation?.callRoomId
        ? {
            id: callConversation.callRoomId,
            slug: callConversation.callRoomId,
            name: callConversation.kind === 'dm' ? 'Chamada' : callConversation.name,
            kind: 'voice',
            position: 0,
          }
        : null)
    );
  }, [bootstrap?.channels, callConversation]);
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
  const callRoomParticipantIds = useMemo(
    () =>
      new Set(
        realtime.participants
          .filter((participant) => participant.channelId === callConversation?.callRoomId)
          .map((participant) => participant.userId),
      ),
    [callConversation?.callRoomId, realtime.participants],
  );
  const callPublications = useMemo(
    () =>
      socket.publications.filter(
        (publication) =>
          publication.userId !== user?.id && callRoomParticipantIds.has(publication.userId),
      ),
    [callRoomParticipantIds, socket.publications, user?.id],
  );
  const voice = useVoiceSession({
    roomId: room?.id ?? 'room_general',
    connectionId: socket.connectionId,
    publications: callPublications,
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
  const joinVoice = voice.join;
  const switchVoiceCall = voice.switchCall;

  useEffect(() => {
    if (!voice.callConflictChannelId) return;
    const conflictingConversation = bootstrap?.conversations.find(
      (conversation) => conversation.callRoomId === voice.callConflictChannelId,
    );
    if (!conflictingConversation) return;
    setCallConversationId(conflictingConversation.id);
  }, [bootstrap?.conversations, voice.callConflictChannelId]);

  useEffect(() => {
    if (!bootstrap || !user) return;
    callResumeRef.current = loadCallResumeState(bootstrap.server.id, user.id);
    resumedCallRef.current = false;
    shouldResumeCameraRef.current = false;
    hadActiveCallRef.current = false;
  }, [bootstrap?.server.id, user?.id]);

  useEffect(() => {
    const resumeState = callResumeRef.current;
    if (
      !resumeState ||
      resumedCallRef.current ||
      !socket.connectionId ||
      voice.status !== 'idle'
    ) {
      return;
    }
    const conversation = bootstrap?.conversations.find(
      (item) => item.id === resumeState.conversationId,
    );
    if (!conversation?.callRoomId || !bootstrap || !user) {
      if (bootstrap && user) clearCallResumeState(bootstrap.server.id, user.id);
      callResumeRef.current = null;
      return;
    }
    resumedCallRef.current = true;
    shouldResumeCameraRef.current = resumeState.cameraEnabled;
    hadActiveCallRef.current = true;
    setCallConversationId(conversation.id);
    void joinVoice(false, conversation.callRoomId);
  }, [bootstrap, joinVoice, socket.connectionId, user, voice.status]);

  useEffect(() => {
    if (!shouldResumeCameraRef.current || voice.status !== 'connected') return;
    shouldResumeCameraRef.current = false;
    if (voice.cameraState === 'idle') void voice.startCamera();
  }, [voice.cameraState, voice.startCamera, voice.status]);

  useEffect(() => {
    if (!bootstrap || !user) return;
    const active = ['joining', 'connected', 'reconnecting', 'recovering'].includes(voice.status);
    if (callConversationId && active) {
      hadActiveCallRef.current = true;
      saveCallResumeState(bootstrap.server.id, user.id, {
        cameraEnabled: voice.cameraState !== 'idle',
        conversationId: callConversationId,
      });
      return;
    }
    if (hadActiveCallRef.current && voice.status === 'idle' && !switchingCallRef.current) {
      hadActiveCallRef.current = false;
      callResumeRef.current = null;
      clearCallResumeState(bootstrap.server.id, user.id);
      setCallConversationId(null);
    }
  }, [bootstrap, callConversationId, user, voice.cameraState, voice.status]);

  const joinConversationCall = useCallback(
    (conversationId: string) => {
      const conversation = bootstrap?.conversations.find((item) => item.id === conversationId);
      if (!conversation?.callRoomId) return;
      hadActiveCallRef.current = true;
      if (voice.status === 'idle') {
        setCallConversationId(conversationId);
        void joinVoice(false, conversation.callRoomId);
        return;
      }
      switchingCallRef.current = true;
      void switchVoiceCall(conversation.callRoomId).then(() => {
        hadActiveCallRef.current = true;
        setCallConversationId(conversationId);
      }).finally(() => {
        switchingCallRef.current = false;
      });
    },
    [bootstrap?.conversations, joinVoice, switchVoiceCall, voice.status],
  );

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
      joinConversationCall,
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
      joinConversationCall,
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

import { useEffect, useState } from 'react';

import type { MediaPublication } from '../../shared/protocol/room';
import type { FriendView, SocialUserView } from '../../shared/types/api';
import { AppShell } from '../components/app-shell';
import { CallStage, type CallStageControls } from '../components/call-stage';
import { CallView } from '../components/call-view';
import { FloatingMediaDock } from '../components/floating-media-dock';
import { FormMessage } from '../components/form-message';
import { RemoteAudio } from '../components/remote-audio';
import { useAuth } from '../features/auth/auth-context';
import { useCall } from '../features/call/call-context';
import { callStatusLabel, shouldShowCallPanel } from '../features/call/call-panel-state';
import { ChatView } from '../features/social/chat-view';
import { CreateGroupDialog } from '../features/social/create-group-dialog';
import { SocialHome } from '../features/social/social-home';
import { navigate } from '../lib/navigation';

type NavigationContext = 'group' | 'home';
type HomeContent = 'dm' | 'friends';
type ActiveView = 'call' | 'chat';

export function AppPage() {
  const { logout, updateSocialState, user } = useAuth();
  const call = useCall();
  const { config, connectionState, members, room, socket, voice } = call;
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersSidebarOpen, setMembersSidebarOpen] = useState(
    () => window.matchMedia('(min-width: 1200px)').matches,
  );
  const [navigationContext, setNavigationContext] = useState<NavigationContext>('home');
  const [homeContent, setHomeContent] = useState<HomeContent>('friends');
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [directRecipient, setDirectRecipient] = useState<SocialUserView | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [callPanelDismissed, setCallPanelDismissed] = useState(false);
  const [watchedConversationId, setWatchedConversationId] = useState<string | null>(null);
  const [watchedMediaKeys, setWatchedMediaKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!directRecipient) return;
    const conversation = call.conversations.find(
      (item) =>
        item.kind === 'dm' && item.members.some((member) => member.id === directRecipient.id),
    );
    if (conversation) {
      call.selectConversation(conversation.id);
      setDirectRecipient(null);
      setHomeContent('dm');
    }
  }, [call, directRecipient]);

  useEffect(() => {
    if (voice.status === 'idle') {
      setCallPanelDismissed(false);
      setActiveView('chat');
    }
  }, [voice.status]);

  if (!user) return null;

  const homeActive = navigationContext === 'home';
  const friendsHomeActive = homeActive && homeContent === 'friends' && !directRecipient;
  const selectedMembers = directRecipient
    ? members.filter((member) => member.id === user.id || member.id === directRecipient.id)
    : homeActive && homeContent === 'friends'
      ? members.filter((member) => call.friends.some((friend) => friend.id === member.id))
      : members.filter((member) =>
          (call.selectedConversation?.members ?? []).some(
            (conversationMember) => conversationMember.id === member.id,
          ),
        );
  const shellVoice = {
    status: voice.status,
    muted: voice.muted,
    userMuted: voice.userMuted,
    deafened: voice.deafened,
    canJoin: Boolean(socket.connectionId && config?.realtimeEnabled && room),
    selectedMicrophone: voice.selectedMicrophone,
    microphones: voice.microphones,
    cameraState: voice.cameraState,
    cameras: voice.cameras,
    screenState: voice.screenState,
    supportsCamera: voice.supportsCamera,
    supportsScreenShare: voice.supportsScreenShare,
    join: () => void voice.join(),
    leave: () => void voice.leave(),
    toggleMuted: voice.toggleMuted,
    toggleDeafened: voice.toggleDeafened,
    changeMicrophone: (deviceId: string) => void voice.changeMicrophone(deviceId),
    toggleCamera: () =>
      void (voice.cameraState === 'active' ? voice.stopCamera() : voice.startCamera()),
    switchCamera: () => void voice.switchCamera(),
    toggleScreenShare: () =>
      void (voice.screenState === 'active' ? voice.stopScreenShare() : voice.startScreenShare()),
  };
  const canSendToSelectedConversation =
    call.selectedConversation?.kind === 'group'
      ? true
      : (call.selectedConversation?.members.some(
          (member) =>
            member.id !== user.id && call.friends.some((friend) => friend.id === member.id),
        ) ?? false);
  const canSendMessage = directRecipient
    ? call.friends.some((friend) => friend.id === directRecipient.id)
    : canSendToSelectedConversation;
  const showCallPanel = shouldShowCallPanel(voice.status, callPanelDismissed);
  const selectedCallRoomId = directRecipient ? null : call.selectedConversation?.callRoomId;
  const selectedCallParticipants = socket.participants.filter(
    (participant) => participant.channelId === selectedCallRoomId,
  );
  const selectedCallParticipantIds = new Set(
    selectedCallParticipants.map((participant) => participant.userId),
  );
  const selectedCallActive = Boolean(
    voice.status !== 'idle' &&
    call.callConversation?.id === call.selectedConversation?.id &&
    selectedCallRoomId,
  );
  const selectedCallPublications = [
    ...socket.publications,
    ...(selectedCallActive
      ? [...voice.localMedia, ...voice.remoteMedia].map((media) => media.publication)
      : []),
  ].filter(
    (publication, index, publications) =>
      selectedCallParticipantIds.has(publication.userId) &&
      publications.findIndex((item) => item.publicationId === publication.publicationId) === index,
  );
  const canJoinSelectedCall = Boolean(
    socket.connectionId &&
    config?.realtimeEnabled &&
    selectedCallRoomId &&
    (voice.status === 'idle' || selectedCallActive),
  );
  const selectedCallAvailable = selectedCallParticipants.length > 0 || selectedCallActive;
  const selectedConversation = directRecipient ? null : call.selectedConversation;
  const selectedPeer = selectedConversation?.members.find((member) => member.id !== user.id);
  const selectedCallTitle =
    selectedConversation?.spaceKind === 'community'
      ? 'Geral'
      : selectedConversation?.kind === 'dm'
        ? `Chamada com @${selectedPeer?.username ?? 'unknown'}`
        : 'Chamada do grupo';
  const selectedCallContext =
    selectedConversation?.kind === 'dm'
      ? `@${selectedPeer?.username ?? 'unknown'}`
      : (selectedConversation?.name ?? 'k0nnect');
  const callStageControls: CallStageControls = {
    muted: voice.muted,
    deafened: voice.deafened,
    cameraActive: voice.cameraState === 'active',
    screenActive: voice.screenState === 'active',
    supportsCamera: voice.supportsCamera,
    supportsScreenShare: voice.supportsScreenShare,
    canSwitchCamera:
      ['active', 'switching'].includes(voice.cameraState) && voice.cameras.length > 1,
    cameraSwitching: voice.cameraState === 'switching',
    onToggleMuted: voice.toggleMuted,
    onToggleDeafened: voice.toggleDeafened,
    onToggleCamera: () =>
      void (voice.cameraState === 'active' ? voice.stopCamera() : voice.startCamera()),
    onSwitchCamera: () => void voice.switchCamera(),
    onToggleScreenShare: () =>
      void (voice.screenState === 'active' ? voice.stopScreenShare() : voice.startScreenShare()),
    onLeave: () => void voice.leave(),
  };
  const watchedConversation = call.conversations.find(
    (conversation) => conversation.id === watchedConversationId,
  );
  const watchedRoomId = watchedConversation?.callRoomId;
  const watchedCallParticipants = socket.participants.filter(
    (participant) => participant.channelId === watchedRoomId,
  );
  const visibleConversationId =
    !directRecipient && !(homeActive && homeContent === 'friends')
      ? call.selectedConversation?.id
      : null;
  const watchedConversationFocused = visibleConversationId === watchedConversationId;
  const visibleWatchedMediaKeys = watchedConversationFocused
    ? watchedMediaKeys
    : watchedMediaKeys.slice(-1);
  const visibleWatchedMediaKeySet = new Set(visibleWatchedMediaKeys);
  const watchedLocalMedia = voice.localMedia.filter(
    (media) =>
      media.publication.kind === 'video' &&
      visibleWatchedMediaKeySet.has(`${media.publication.userId}:${media.publication.source}`),
  );
  const watchedRemoteMedia = voice.remoteMedia.filter(
    (media) =>
      media.publication.kind === 'video' &&
      visibleWatchedMediaKeySet.has(`${media.publication.userId}:${media.publication.source}`),
  );

  function selectHomeConversation(conversationId: string) {
    call.selectConversation(conversationId);
    setDirectRecipient(null);
    setNavigationContext('home');
    setHomeContent('dm');
    setActiveView('chat');
    setChannelsOpen(false);
  }

  function selectGroupConversation(conversationId: string) {
    call.selectConversation(conversationId);
    setDirectRecipient(null);
    setNavigationContext('group');
    setActiveView('chat');
    setChannelsOpen(false);
  }

  function activateVoiceChannel() {
    if (selectedCallActive) {
      setActiveView('call');
      setCallPanelDismissed(false);
      return;
    }
    if (voice.status !== 'idle') {
      setCallPanelDismissed(false);
      return;
    }
    if (!call.selectedConversation?.callRoomId) return;
    setActiveView('call');
    call.joinConversationCall(call.selectedConversation.id);
  }

  function watchPublication(publication: MediaPublication) {
    const conversation = call.selectedConversation;
    if (!conversation?.callRoomId) return;
    if (publication.kind !== 'video') return;
    const mediaKey = `${publication.userId}:${publication.source}`;
    setWatchedMediaKeys((current) =>
      watchedConversationId === conversation.id
        ? [...current.filter((key) => key !== mediaKey), mediaKey]
        : [mediaKey],
    );
    setWatchedConversationId(conversation.id);
    if (!selectedCallActive && voice.status === 'idle') {
      call.joinConversationCall(conversation.id);
    }
  }

  function returnToWatchedConversation() {
    const conversation = watchedConversation;
    if (!conversation) return;
    call.selectConversation(conversation.id);
    setDirectRecipient(null);
    setHomeContent(conversation.kind === 'dm' ? 'dm' : 'friends');
    setNavigationContext(conversation.kind === 'dm' ? 'home' : 'group');
    setActiveView('chat');
    setChannelsOpen(false);
  }

  return (
    <AppShell
      user={user}
      roomName={call.callConversation?.name ?? room?.name ?? 'Chamada'}
      participants={socket.participants}
      members={selectedMembers}
      onlineUserIds={socket.onlineUserIds}
      publications={socket.publications}
      connectionState={connectionState}
      conversations={call.conversations}
      selectedConversation={call.selectedConversation}
      navigationContext={navigationContext}
      activeView={activeView}
      voice={shellVoice}
      showCallPanel={showCallPanel}
      channelsOpen={channelsOpen}
      membersOpen={friendsHomeActive ? false : membersSidebarOpen}
      onChannelsOpenChange={setChannelsOpen}
      onMembersOpenChange={setMembersSidebarOpen}
      onHomeSelect={() => {
        setNavigationContext('home');
        setHomeContent('friends');
        setActiveView('chat');
        setDirectRecipient(null);
        setChannelsOpen(false);
      }}
      onHomeConversationSelect={selectHomeConversation}
      onGroupConversationSelect={selectGroupConversation}
      onTextChannelActivate={() => setActiveView('chat')}
      onCreateGroup={() => setCreatingGroup(true)}
      onVoiceChannelActivate={activateVoiceChannel}
      onDismissCallPanel={() => setCallPanelDismissed(true)}
      onLogout={() => void logout().then(() => navigate('/login'))}
    >
      <div className="social-app-main">
        {(socket.message || voice.error || call.loadError) && (
          <FormMessage message={voice.error || socket.message || call.loadError} />
        )}
        {voice.callConflict && (
          <button
            className="button secondary call-conflict-action"
            type="button"
            onClick={voice.takeoverCall}
          >
            Transferir chamada para este dispositivo
          </button>
        )}
        {homeActive && homeContent === 'friends' && !directRecipient ? (
          <SocialHome
            friends={call.friends}
            requests={call.friendRequests}
            onlineUserIds={socket.onlineUserIds}
            onChanged={updateSocialState}
            onMessage={(friend: FriendView) => {
              const conversation = call.conversations.find(
                (item) =>
                  item.kind === 'dm' && item.members.some((member) => member.id === friend.id),
              );
              if (conversation) selectHomeConversation(conversation.id);
              else {
                setDirectRecipient(friend);
                setNavigationContext('home');
                setHomeContent('dm');
              }
            }}
          />
        ) : (
          <>
            <div className="conversation-chat-layer" hidden={activeView === 'call'}>
              <ChatView
                conversation={selectedConversation}
                recipient={directRecipient}
                currentUserId={user.id}
                currentUsername={user.username}
                getMessages={socket.getChatMessages}
                isHistoryLoaded={socket.isHistoryLoaded}
                subscribeChat={socket.subscribeChat}
                canJoinCall={canJoinSelectedCall}
                callActive={selectedCallActive}
                callAvailable={selectedCallAvailable}
                callStage={
                  selectedConversation?.spaceKind !== 'community' && selectedCallAvailable ? (
                    <CallStage
                      title={selectedCallTitle}
                      contextLabel={selectedCallContext}
                      participants={selectedCallParticipants}
                      currentUserId={user.id}
                      publications={selectedCallPublications}
                      active={selectedCallActive}
                      canJoin={canJoinSelectedCall}
                      statusLabel={
                        selectedCallActive ? callStatusLabel(voice.status) : 'Chamada ativa'
                      }
                      variant="compact"
                      onActivate={activateVoiceChannel}
                      onWatchPublication={watchPublication}
                    />
                  ) : null
                }
                canSend={canSendMessage}
                friends={call.friends}
                onOpenChannels={() => setChannelsOpen(true)}
                membersSidebarOpen={membersSidebarOpen}
                onToggleMembers={() => setMembersSidebarOpen((open) => !open)}
                onMessagesLoaded={(messages) => {
                  if (call.selectedConversation) {
                    socket.setConversationMessages(call.selectedConversation.id, messages);
                  }
                }}
                onSend={socket.sendChat}
                onUseGroupCall={activateVoiceChannel}
                onSocialChanged={updateSocialState}
                onGroupLeft={() => {
                  setNavigationContext('home');
                  setHomeContent('friends');
                  setActiveView('chat');
                  setDirectRecipient(null);
                }}
              />
            </div>
            {activeView === 'call' && selectedCallRoomId && (
              <CallView
                title={selectedCallTitle}
                contextLabel={selectedCallContext}
                participants={selectedCallParticipants}
                currentUserId={user.id}
                publications={selectedCallPublications}
                active={selectedCallActive}
                canJoin={canJoinSelectedCall}
                statusLabel={
                  selectedCallActive ? callStatusLabel(voice.status) : 'Preparando chamada'
                }
                membersSidebarOpen={membersSidebarOpen}
                controls={callStageControls}
                onActivate={activateVoiceChannel}
                onBackToChat={() => setActiveView('chat')}
                onOpenChannels={() => setChannelsOpen(true)}
                onToggleMembers={() => setMembersSidebarOpen((open) => !open)}
                onWatchPublication={watchPublication}
              />
            )}
          </>
        )}

        {watchedConversation && watchedMediaKeys.length > 0 && voice.status !== 'idle' && (
          <FloatingMediaDock
            title={
              watchedConversation.kind === 'dm'
                ? `@${watchedConversation.members.find((member) => member.id !== user.id)?.username ?? 'unknown'}`
                : watchedConversation.name
            }
            participants={watchedCallParticipants}
            userId={user.id}
            localMedia={watchedLocalMedia}
            remoteMedia={watchedRemoteMedia}
            focusedConversation={watchedConversationFocused}
            onClose={() => {
              setWatchedConversationId(null);
              setWatchedMediaKeys([]);
            }}
            onReturnToConversation={returnToWatchedConversation}
          />
        )}
        <div hidden aria-hidden="true">
          {voice.remoteMedia
            .filter((remote) => remote.publication.kind === 'audio')
            .map((remote) => (
              <RemoteAudio
                key={remote.publication.publicationId}
                stream={remote.stream}
                muted={voice.deafened}
              />
            ))}
        </div>
      </div>
      {creatingGroup && (
        <CreateGroupDialog
          friends={call.friends}
          onClose={() => setCreatingGroup(false)}
          onCreated={(conversationId, social) => {
            updateSocialState(social);
            call.selectConversation(conversationId);
            call.selectCallConversation(conversationId);
            setNavigationContext('group');
            setCreatingGroup(false);
          }}
        />
      )}
    </AppShell>
  );
}

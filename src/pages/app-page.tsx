import { useEffect, useState } from 'react';

import type { FriendView, SocialUserView } from '../../shared/types/api';
import { AppShell } from '../components/app-shell';
import { FormMessage } from '../components/form-message';
import { IconButton } from '../components/icon-button';
import { CloseIcon } from '../components/icons';
import { MediaRoomView } from '../components/media-room-view';
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

export function AppPage() {
  const { logout, updateSocialState, user } = useAuth();
  const call = useCall();
  const { config, connectionState, members, room, socket, voice } = call;
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [navigationContext, setNavigationContext] = useState<NavigationContext>('home');
  const [homeContent, setHomeContent] = useState<HomeContent>('friends');
  const [directRecipient, setDirectRecipient] = useState<SocialUserView | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [callPanelDismissed, setCallPanelDismissed] = useState(false);

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
    if (voice.status === 'idle') setCallPanelDismissed(false);
  }, [voice.status]);

  if (!user) return null;

  const homeActive = navigationContext === 'home';
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
  const videoMedia = [...voice.localMedia, ...voice.remoteMedia].some(
    (media) => media.publication.kind === 'video',
  );
  const showCallPanel = shouldShowCallPanel(voice.status, callPanelDismissed);

  function selectHomeConversation(conversationId: string) {
    call.selectConversation(conversationId);
    setDirectRecipient(null);
    setNavigationContext('home');
    setHomeContent('dm');
    setChannelsOpen(false);
  }

  function selectGroupConversation(conversationId: string) {
    call.selectConversation(conversationId);
    setDirectRecipient(null);
    setNavigationContext('group');
    setChannelsOpen(false);
  }

  function activateVoiceChannel() {
    if (voice.status !== 'idle') {
      setCallPanelDismissed(false);
      return;
    }
    if (!call.selectedConversation?.callRoomId) return;
    call.joinConversationCall(call.selectedConversation.id);
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
      voice={shellVoice}
      showCallPanel={showCallPanel}
      channelsOpen={channelsOpen}
      membersOpen={membersOpen}
      onChannelsOpenChange={setChannelsOpen}
      onMembersOpenChange={setMembersOpen}
      onHomeSelect={() => {
        setNavigationContext('home');
        setHomeContent('friends');
        setDirectRecipient(null);
        setChannelsOpen(false);
      }}
      onHomeConversationSelect={selectHomeConversation}
      onGroupConversationSelect={selectGroupConversation}
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
          <ChatView
            conversation={directRecipient ? null : call.selectedConversation}
            recipient={directRecipient}
            currentUserId={user.id}
            currentUsername={user.username}
            getMessages={socket.getChatMessages}
            isHistoryLoaded={socket.isHistoryLoaded}
            subscribeChat={socket.subscribeChat}
            canJoinCall={Boolean(
              socket.connectionId && config?.realtimeEnabled && voice.status === 'idle',
            )}
            canSend={canSendMessage}
            friends={call.friends}
            onOpenChannels={() => setChannelsOpen(true)}
            onOpenMembers={() => setMembersOpen(true)}
            onMessagesLoaded={(messages) => {
              if (call.selectedConversation) {
                socket.setConversationMessages(call.selectedConversation.id, messages);
              }
            }}
            onSend={socket.sendChat}
            onUseGroupCall={() => {
              if (call.selectedConversation?.callRoomId) {
                activateVoiceChannel();
              }
            }}
            onSocialChanged={updateSocialState}
            onGroupLeft={() => {
              setNavigationContext('home');
              setHomeContent('friends');
              setDirectRecipient(null);
            }}
          />
        )}

        {voice.status !== 'idle' && videoMedia && (
          <aside className="global-call-stage" aria-label="Chamada em andamento">
            <MediaRoomView
              participants={socket.participants}
              userId={user.id}
              localMedia={voice.localMedia}
              remoteMedia={voice.remoteMedia}
            />
          </aside>
        )}
        {showCallPanel && room && (
          <div className="global-call-bar">
            <div>
              <strong>{call.callConversation?.name ?? room.name}</strong>
              <span>{callStatusLabel(voice.status)}</span>
            </div>
            <IconButton
              label="Ocultar painel da chamada"
              onClick={() => setCallPanelDismissed(true)}
            >
              <CloseIcon aria-hidden="true" />
            </IconButton>
          </div>
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

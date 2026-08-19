import { useEffect, useState } from 'react';

import type { FriendView, SocialUserView } from '../../shared/types/api';
import { AppShell } from '../components/app-shell';
import { FormMessage } from '../components/form-message';
import { MicIcon } from '../components/icons';
import { MediaRoomView } from '../components/media-room-view';
import { RemoteAudio } from '../components/remote-audio';
import { useAuth } from '../features/auth/auth-context';
import { useCall } from '../features/call/call-context';
import { ChatView } from '../features/social/chat-view';
import { CreateGroupDialog } from '../features/social/create-group-dialog';
import { SocialHome } from '../features/social/social-home';
import { navigate } from '../lib/navigation';

export function AppPage() {
  const { logout, updateSocialState, user } = useAuth();
  const call = useCall();
  const { config, connectionState, members, room, socket, voice } = call;
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [homeActive, setHomeActive] = useState(true);
  const [directRecipient, setDirectRecipient] = useState<SocialUserView | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  useEffect(() => {
    if (!directRecipient) return;
    const conversation = call.conversations.find(
      (item) =>
        item.kind === 'dm' && item.members.some((member) => member.id === directRecipient.id),
    );
    if (conversation) {
      call.selectConversation(conversation.id);
      setDirectRecipient(null);
      setHomeActive(false);
    }
  }, [call, directRecipient]);

  if (!user) return null;

  const selectedMembers = directRecipient
    ? members.filter((member) => member.id === user.id || member.id === directRecipient.id)
    : homeActive
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

  function selectConversation(conversationId: string) {
    call.selectConversation(conversationId);
    setDirectRecipient(null);
    setHomeActive(false);
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
      homeActive={homeActive}
      voice={shellVoice}
      channelsOpen={channelsOpen}
      membersOpen={membersOpen}
      onChannelsOpenChange={setChannelsOpen}
      onMembersOpenChange={setMembersOpen}
      onHomeSelect={() => {
        setHomeActive(true);
        setDirectRecipient(null);
        setChannelsOpen(false);
      }}
      onConversationSelect={selectConversation}
      onCreateGroup={() => setCreatingGroup(true)}
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
        {homeActive && !directRecipient ? (
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
              if (conversation) selectConversation(conversation.id);
              else {
                setDirectRecipient(friend);
                setHomeActive(true);
              }
            }}
          />
        ) : (
          <ChatView
            conversation={directRecipient ? null : call.selectedConversation}
            recipient={directRecipient}
            currentUserId={user.id}
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
                call.selectCallConversation(call.selectedConversation.id);
              }
            }}
            onSocialChanged={updateSocialState}
            onGroupLeft={() => {
              setHomeActive(true);
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
        {voice.status === 'idle' && room && (
          <div className="global-call-bar">
            <div>
              <strong>{call.callConversation?.name ?? room.name}</strong>
              <span>Chamada de voz</span>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={() => void voice.join()}
              disabled={!socket.connectionId || !config?.realtimeEnabled}
            >
              <MicIcon aria-hidden="true" /> Entrar
            </button>
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
            setHomeActive(false);
            setCreatingGroup(false);
          }}
        />
      )}
    </AppShell>
  );
}

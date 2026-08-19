import type { ReactNode } from 'react';

import type { MediaPublication, RoomParticipant } from '../../shared/protocol/room';
import type { ConversationSummary, MemberView, SessionUser } from '../../shared/types/api';
import { useMediaQuery } from '../hooks/use-media-query';
import { handleInternalLink } from '../lib/navigation';
import { Avatar, participantState } from './avatar';
import { Brand } from './brand';
import { DeviceSelect } from './device-select';
import { IconButton } from './icon-button';
import {
  CameraIcon,
  CameraOffIcon,
  CloseIcon,
  ExitIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SettingsIcon,
  SwitchCameraIcon,
  UsersIcon,
  VolumeIcon,
} from './icons';

interface VoiceControls {
  status: string;
  muted: boolean;
  userMuted: boolean;
  deafened: boolean;
  canJoin: boolean;
  selectedMicrophone: string;
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  cameraState: string;
  screenState: string;
  supportsCamera: boolean;
  supportsScreenShare: boolean;
  join(): void;
  leave(): void;
  toggleMuted(): void;
  toggleDeafened(): void;
  changeMicrophone(deviceId: string): void;
  toggleCamera(): void;
  switchCamera(): void;
  toggleScreenShare(): void;
}

function microphoneControlLabel(voice: VoiceControls): string {
  if (voice.deafened) {
    return voice.userMuted
      ? 'Ativar microfone ao reativar áudio'
      : 'Desativar microfone ao reativar áudio';
  }
  return voice.userMuted ? 'Ativar microfone' : 'Desativar microfone';
}

interface AppShellProps {
  children: ReactNode;
  user: SessionUser;
  roomName: string;
  participants: RoomParticipant[];
  members: MemberView[];
  onlineUserIds: string[];
  publications: MediaPublication[];
  connectionState: string;
  conversations: ConversationSummary[];
  selectedConversation: ConversationSummary | null;
  homeActive: boolean;
  voice: VoiceControls;
  channelsOpen: boolean;
  membersOpen: boolean;
  onChannelsOpenChange(open: boolean): void;
  onMembersOpenChange(open: boolean): void;
  onLogout(): void;
  onHomeSelect(): void;
  onConversationSelect(conversationId: string): void;
  onCreateGroup(): void;
}

function ParticipantLine({
  participant,
  userId,
  publications,
}: {
  participant: RoomParticipant;
  userId: string;
  publications: MediaPublication[];
}) {
  const isSharingScreen = publications.some(
    (publication) =>
      publication.userId === participant.userId && publication.source === 'screen-video',
  );
  const cameraActive = publications.some(
    (publication) => publication.userId === participant.userId && publication.source === 'camera',
  );
  return (
    <div className={`channel-member ${participant.speaking ? 'is-speaking' : ''}`}>
      <Avatar
        displayName={participant.displayName}
        state={participantState(participant)}
        size="small"
      />
      <span>
        {participant.displayName}
        {participant.userId === userId ? ' (você)' : ''}
      </span>
      {isSharingScreen ? (
        <ScreenShareIcon aria-label="Compartilhando tela" />
      ) : cameraActive ? (
        <CameraIcon aria-label="Câmera ligada" />
      ) : participant.deafened ? (
        <HeadphonesOffIcon aria-label="Áudio desativado" />
      ) : participant.muted ? (
        <MicOffIcon aria-label="Microfone desativado" />
      ) : null}
    </div>
  );
}

function VoiceConnectionPanel({ roomName, voice }: { roomName: string; voice: VoiceControls }) {
  if (voice.status === 'idle') return null;
  return (
    <section className="voice-connection-panel" aria-label="Conexão de voz">
      <div>
        <span className="voice-status-label">Voz conectada</span>
        <strong>{roomName}</strong>
      </div>
      <div className="voice-connection-actions">
        {voice.microphones.length > 0 && (
          <DeviceSelect
            compact
            devices={voice.microphones}
            emptyLabel="Nenhum microfone"
            fallbackLabel="Microfone"
            label="Microfone"
            value={voice.selectedMicrophone}
            onChange={voice.changeMicrophone}
          />
        )}
        <IconButton label="Desconectar" tone="danger" onClick={voice.leave}>
          <ExitIcon aria-hidden="true" />
        </IconButton>
      </div>
    </section>
  );
}

function UserPanel({
  user,
  voice,
  onLogout,
}: {
  user: SessionUser;
  voice: VoiceControls;
  onLogout(): void;
}) {
  return (
    <div className="user-panel">
      <div className="user-identity">
        <Avatar displayName={user.displayName} size="small" />
        <span>
          <strong>{user.displayName}</strong>
          <small>@{user.username}</small>
        </span>
      </div>
      <div className="user-actions">
        <IconButton
          label={microphoneControlLabel(voice)}
          className={voice.muted ? 'is-active' : ''}
          aria-pressed={voice.muted}
          onClick={voice.toggleMuted}
          disabled={voice.status === 'idle'}
        >
          {voice.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        </IconButton>
        <IconButton
          label={voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}
          className={voice.deafened ? 'is-active' : ''}
          aria-pressed={voice.deafened}
          onClick={voice.toggleDeafened}
          disabled={voice.status === 'idle'}
        >
          {voice.deafened ? (
            <HeadphonesOffIcon aria-hidden="true" />
          ) : (
            <HeadphonesIcon aria-hidden="true" />
          )}
        </IconButton>
        {voice.supportsCamera && (
          <IconButton
            label={voice.cameraState === 'active' ? 'Desativar câmera' : 'Ativar câmera'}
            className={voice.cameraState === 'active' ? 'is-active' : ''}
            aria-pressed={voice.cameraState === 'active'}
            onClick={voice.toggleCamera}
            disabled={
              voice.status !== 'connected' ||
              !['idle', 'active', 'error'].includes(voice.cameraState)
            }
          >
            {voice.cameraState === 'active' ? (
              <CameraOffIcon aria-hidden="true" />
            ) : (
              <CameraIcon aria-hidden="true" />
            )}
          </IconButton>
        )}
        {voice.supportsScreenShare && (
          <IconButton
            label={voice.screenState === 'active' ? 'Parar compartilhamento' : 'Compartilhar tela'}
            className={voice.screenState === 'active' ? 'is-active' : ''}
            aria-pressed={voice.screenState === 'active'}
            onClick={voice.toggleScreenShare}
            disabled={
              voice.status !== 'connected' ||
              !['idle', 'active', 'error'].includes(voice.screenState)
            }
          >
            {voice.screenState === 'active' ? (
              <ScreenShareOffIcon aria-hidden="true" />
            ) : (
              <ScreenShareIcon aria-hidden="true" />
            )}
          </IconButton>
        )}
        <a
          className="icon-link"
          href="/settings"
          onClick={handleInternalLink}
          aria-label="Abrir configurações"
          data-tooltip="Configurações"
        >
          <SettingsIcon aria-hidden="true" />
        </a>
        <IconButton label="Sair da conta" onClick={onLogout}>
          <ExitIcon aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

function ChannelSidebar({
  roomName,
  participants,
  publications,
  user,
  voice,
  open,
  onClose,
  onLogout,
  conversations,
  selectedConversation,
  homeActive,
  onHomeSelect,
  onConversationSelect,
}: Pick<
  AppShellProps,
  | 'roomName'
  | 'participants'
  | 'publications'
  | 'user'
  | 'voice'
  | 'onLogout'
  | 'conversations'
  | 'selectedConversation'
  | 'homeActive'
  | 'onHomeSelect'
  | 'onConversationSelect'
> & {
  open: boolean;
  onClose(): void;
}) {
  return (
    <aside className={`channel-sidebar ${open ? 'is-open' : ''}`} aria-label="Canais">
      <header className="group-header">
        <span>{homeActive ? 'Início' : (selectedConversation?.name ?? 'k0nnect')}</span>
        <IconButton label="Fechar canais" className="drawer-close" onClick={onClose}>
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </header>
      <nav className="channel-navigation" aria-label="Navegação social">
        {homeActive ? (
          <>
            <div className="channel-category">
              <span>Social</span>
            </div>
            <button className="voice-channel is-active" type="button" onClick={onHomeSelect}>
              <UsersIcon aria-hidden="true" />
              <span>Amigos</span>
            </button>
            <div className="channel-category">
              <span>Mensagens diretas</span>
            </div>
            {conversations
              .filter((item) => item.kind === 'dm')
              .map((conversation) => (
                <button
                  className={`voice-channel ${selectedConversation?.id === conversation.id ? 'is-active' : ''}`}
                  type="button"
                  key={conversation.id}
                  onClick={() => onConversationSelect(conversation.id)}
                >
                  <Avatar displayName={conversation.name} size="small" />
                  <span>{conversation.name}</span>
                </button>
              ))}
          </>
        ) : (
          <>
            <div className="channel-category">
              <span>Texto</span>
            </div>
            <button className="voice-channel is-active" type="button">
              <span aria-hidden="true">#</span>
              <span>chat</span>
            </button>
            {selectedConversation?.callRoomId && (
              <>
                <div className="channel-category">
                  <span>Voz</span>
                </div>
                <div className="voice-channel">
                  <VolumeIcon aria-hidden="true" />
                  <span>Geral</span>
                </div>
              </>
            )}
          </>
        )}
        <div className="channel-members">
          {participants.map((participant) => (
            <ParticipantLine
              key={participant.userId}
              participant={participant}
              userId={user.id}
              publications={publications}
            />
          ))}
        </div>
      </nav>
      <div className="channel-sidebar-spacer" />
      <VoiceConnectionPanel roomName={roomName} voice={voice} />
      <UserPanel user={user} voice={voice} onLogout={onLogout} />
    </aside>
  );
}

function MemberSidebar({
  members,
  onlineUserIds,
  participants,
  publications,
  userId,
  open,
  onClose,
}: {
  members: MemberView[];
  onlineUserIds: string[];
  participants: RoomParticipant[];
  publications: MediaPublication[];
  userId: string;
  open: boolean;
  onClose(): void;
}) {
  const participantByUser = new Map(
    participants.map((participant) => [participant.userId, participant]),
  );
  const onlineIds = new Set(onlineUserIds);
  const onlineMembers = members.filter((member) => onlineIds.has(member.id));
  const offlineMembers = members.filter((member) => !onlineIds.has(member.id));

  const renderMember = (member: MemberView, online: boolean) => {
    const participant = participantByUser.get(member.id);
    const state = participant ? participantState(participant) : online ? 'online' : 'offline';
    const isSharingScreen = publications.some(
      (publication) => publication.userId === member.id && publication.source === 'screen-video',
    );
    const cameraActive = publications.some(
      (publication) => publication.userId === member.id && publication.source === 'camera',
    );
    return (
      <div className={`member-item ${participant?.speaking ? 'is-speaking' : ''}`} key={member.id}>
        <Avatar displayName={member.displayName} state={state} />
        <span>
          <strong>
            {member.displayName}
            {member.id === userId ? ' (você)' : ''}
          </strong>
          <small>
            {isSharingScreen
              ? 'Compartilhando tela'
              : cameraActive
                ? 'Câmera ligada'
                : participant
                  ? state === 'speaking'
                    ? 'Falando'
                    : state === 'muted'
                      ? 'Microfone desativado'
                      : state === 'deafened'
                        ? 'Áudio desativado'
                        : 'Em Geral'
                  : online
                    ? 'Online'
                    : 'Offline'}
          </small>
        </span>
      </div>
    );
  };

  return (
    <aside className={`member-sidebar ${open ? 'is-open' : ''}`} aria-label="Participantes">
      <header className="member-sidebar-header">
        <span>Online — {onlineMembers.length}</span>
        <IconButton label="Fechar participantes" className="drawer-close" onClick={onClose}>
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </header>
      <div className="member-list">
        {onlineMembers.map((member) => renderMember(member, true))}
        {offlineMembers.length > 0 && (
          <div className="member-list-section" aria-label={`Offline — ${offlineMembers.length}`}>
            <span>Offline — {offlineMembers.length}</span>
          </div>
        )}
        {offlineMembers.map((member) => renderMember(member, false))}
      </div>
    </aside>
  );
}

export function AppShell(props: AppShellProps) {
  const mobileLayout = useMediaQuery('(max-width: 767px)');
  return (
    <div className="app-shell">
      <aside className="group-rail" aria-label="Grupos">
        <button
          className={`rail-item rail-home ${props.homeActive ? 'is-active' : ''}`}
          type="button"
          onClick={props.onHomeSelect}
          aria-label="k0nnect"
        >
          <Brand compact />
        </button>
        <span className="rail-separator" />
        {props.conversations
          .filter((item) => item.kind === 'group')
          .map((conversation) => (
            <button
              className={`rail-item ${!props.homeActive && props.selectedConversation?.id === conversation.id ? 'is-active' : ''}`}
              type="button"
              key={conversation.id}
              aria-label={conversation.name}
              aria-current={
                !props.homeActive && props.selectedConversation?.id === conversation.id
                  ? 'page'
                  : undefined
              }
              onClick={() => props.onConversationSelect(conversation.id)}
            >
              {conversation.isDefault ? (
                <img src="/brand/k0sec-logo.png" alt="" />
              ) : (
                <span className="rail-group-initial" aria-hidden="true">
                  {conversation.name.charAt(0).toUpperCase()}
                </span>
              )}
            </button>
          ))}
        <span className="rail-separator" />
        <button
          className="rail-item"
          type="button"
          onClick={props.onCreateGroup}
          aria-label="Criar grupo"
        >
          <PlusIcon aria-hidden="true" />
        </button>
      </aside>
      <ChannelSidebar
        roomName={props.roomName}
        participants={props.participants}
        publications={props.publications}
        user={props.user}
        voice={props.voice}
        open={props.channelsOpen}
        onClose={() => props.onChannelsOpenChange(false)}
        onLogout={props.onLogout}
        conversations={props.conversations}
        selectedConversation={props.selectedConversation}
        homeActive={props.homeActive}
        onHomeSelect={props.onHomeSelect}
        onConversationSelect={props.onConversationSelect}
      />
      <main className="app-main">{props.children}</main>
      <MemberSidebar
        members={props.members}
        onlineUserIds={props.onlineUserIds}
        participants={props.participants}
        publications={props.publications}
        userId={props.user.id}
        open={props.membersOpen}
        onClose={() => props.onMembersOpenChange(false)}
      />
      {(props.channelsOpen || props.membersOpen) && (
        <button
          className="drawer-backdrop"
          type="button"
          aria-label="Fechar navegação"
          onClick={() => {
            props.onChannelsOpenChange(false);
            props.onMembersOpenChange(false);
          }}
        />
      )}
      {mobileLayout && (
        <div className="mobile-voice-bar" aria-label="Controles de voz">
          {props.voice.status === 'idle' ? (
            <button
              className="button primary"
              type="button"
              disabled={!props.voice.canJoin}
              onClick={props.voice.join}
            >
              <MicIcon aria-hidden="true" /> Entrar na voz
            </button>
          ) : (
            <>
              <IconButton
                label={microphoneControlLabel(props.voice)}
                className={props.voice.muted ? 'is-active' : ''}
                aria-pressed={props.voice.muted}
                onClick={props.voice.toggleMuted}
              >
                {props.voice.muted ? (
                  <MicOffIcon aria-hidden="true" />
                ) : (
                  <MicIcon aria-hidden="true" />
                )}
              </IconButton>
              <IconButton
                label={props.voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}
                className={props.voice.deafened ? 'is-active' : ''}
                aria-pressed={props.voice.deafened}
                onClick={props.voice.toggleDeafened}
              >
                {props.voice.deafened ? (
                  <HeadphonesOffIcon aria-hidden="true" />
                ) : (
                  <HeadphonesIcon aria-hidden="true" />
                )}
              </IconButton>
              {props.voice.supportsCamera && (
                <IconButton
                  label={
                    props.voice.cameraState === 'active' ? 'Desativar câmera' : 'Ativar câmera'
                  }
                  className={props.voice.cameraState === 'active' ? 'is-active' : ''}
                  aria-pressed={props.voice.cameraState === 'active'}
                  onClick={props.voice.toggleCamera}
                  disabled={!['idle', 'active', 'error'].includes(props.voice.cameraState)}
                >
                  {props.voice.cameraState === 'active' ? (
                    <CameraOffIcon aria-hidden="true" />
                  ) : (
                    <CameraIcon aria-hidden="true" />
                  )}
                </IconButton>
              )}
              {['active', 'switching'].includes(props.voice.cameraState) &&
                props.voice.cameras.length > 1 && (
                  <IconButton
                    label="Trocar câmera"
                    className="camera-switch-button"
                    disabled={props.voice.cameraState === 'switching'}
                    onClick={props.voice.switchCamera}
                  >
                    <SwitchCameraIcon aria-hidden="true" />
                  </IconButton>
                )}
              {props.voice.supportsScreenShare && (
                <IconButton
                  label={
                    props.voice.screenState === 'active'
                      ? 'Parar compartilhamento'
                      : 'Compartilhar tela'
                  }
                  className={props.voice.screenState === 'active' ? 'is-active' : ''}
                  aria-pressed={props.voice.screenState === 'active'}
                  onClick={props.voice.toggleScreenShare}
                  disabled={!['idle', 'active', 'error'].includes(props.voice.screenState)}
                >
                  {props.voice.screenState === 'active' ? (
                    <ScreenShareOffIcon aria-hidden="true" />
                  ) : (
                    <ScreenShareIcon aria-hidden="true" />
                  )}
                </IconButton>
              )}
              <IconButton label="Desconectar" tone="danger" onClick={props.voice.leave}>
                <ExitIcon aria-hidden="true" />
              </IconButton>
            </>
          )}
          <IconButton
            label={props.membersOpen ? 'Ocultar participantes' : 'Mostrar participantes'}
            aria-expanded={props.membersOpen}
            onClick={() => props.onMembersOpenChange(!props.membersOpen)}
          >
            <UsersIcon aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

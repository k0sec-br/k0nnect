import type { ReactNode } from 'react';

import type { RoomParticipant } from '../../shared/protocol/room';
import type { SessionUser } from '../../shared/types/api';
import { handleInternalLink } from '../lib/navigation';
import { Avatar, participantState } from './avatar';
import { Brand } from './brand';
import { IconButton } from './icon-button';
import {
  CloseIcon,
  ExitIcon,
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
  VolumeIcon,
} from './icons';

interface VoiceControls {
  status: string;
  muted: boolean;
  deafened: boolean;
  canJoin: boolean;
  selectedDevice: string;
  devices: MediaDeviceInfo[];
  join(): void;
  leave(): void;
  toggleMuted(): void;
  toggleDeafened(): void;
  changeMicrophone(deviceId: string): void;
}

interface AppShellProps {
  children: ReactNode;
  user: SessionUser;
  roomName: string;
  participants: RoomParticipant[];
  connectionState: string;
  voice: VoiceControls;
  channelsOpen: boolean;
  membersOpen: boolean;
  onChannelsOpenChange(open: boolean): void;
  onMembersOpenChange(open: boolean): void;
  onLogout(): void;
}

function ParticipantLine({
  participant,
  userId,
}: {
  participant: RoomParticipant;
  userId: string;
}) {
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
      {participant.deafened ? (
        <HeadphonesIcon aria-label="Áudio desativado" />
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
        {voice.devices.length > 0 && (
          <label className="compact-device-select">
            <span>Microfone</span>
            <select
              value={voice.selectedDevice}
              onChange={(event) => voice.changeMicrophone(event.target.value)}
              aria-label="Microfone"
            >
              {voice.devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microfone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
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
          label={voice.muted ? 'Ativar microfone' : 'Silenciar'}
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
          <HeadphonesIcon aria-hidden="true" />
        </IconButton>
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
  user,
  voice,
  open,
  onClose,
  onLogout,
}: Pick<AppShellProps, 'roomName' | 'participants' | 'user' | 'voice' | 'onLogout'> & {
  open: boolean;
  onClose(): void;
}) {
  return (
    <aside className={`channel-sidebar ${open ? 'is-open' : ''}`} aria-label="Canais">
      <header className="group-header">
        <span>K0Sec</span>
        <IconButton label="Fechar canais" className="drawer-close" onClick={onClose}>
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </header>
      <nav className="channel-navigation" aria-label="Canais de K0Sec">
        <div className="channel-category">
          <span>Voz</span>
        </div>
        <a
          className="voice-channel is-active"
          href="/app"
          onClick={handleInternalLink}
          aria-current="page"
        >
          <VolumeIcon aria-hidden="true" />
          <span>{roomName}</span>
        </a>
        <div className="channel-members">
          {participants.map((participant) => (
            <ParticipantLine key={participant.userId} participant={participant} userId={user.id} />
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
  participants,
  userId,
  open,
  onClose,
}: {
  participants: RoomParticipant[];
  userId: string;
  open: boolean;
  onClose(): void;
}) {
  return (
    <aside className={`member-sidebar ${open ? 'is-open' : ''}`} aria-label="Participantes">
      <header className="member-sidebar-header">
        <span>Online — {participants.length}</span>
        <IconButton label="Fechar participantes" className="drawer-close" onClick={onClose}>
          <CloseIcon aria-hidden="true" />
        </IconButton>
      </header>
      <div className="member-list">
        {participants.map((participant) => {
          const state = participantState(participant);
          return (
            <div
              className={`member-item ${participant.speaking ? 'is-speaking' : ''}`}
              key={participant.userId}
            >
              <Avatar displayName={participant.displayName} state={state} />
              <span>
                <strong>
                  {participant.displayName}
                  {participant.userId === userId ? ' (você)' : ''}
                </strong>
                <small>
                  {state === 'speaking'
                    ? 'Falando'
                    : state === 'muted'
                      ? 'Microfone desativado'
                      : state === 'deafened'
                        ? 'Áudio desativado'
                        : 'Conectado'}
                </small>
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function AppShell(props: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="group-rail" aria-label="Grupos">
        <a
          className="rail-item rail-home"
          href="/app"
          onClick={handleInternalLink}
          aria-label="k0nnect"
        >
          <Brand compact />
        </a>
        <span className="rail-separator" />
        <a
          className="rail-item is-active"
          href="/app"
          onClick={handleInternalLink}
          aria-label="K0Sec"
          aria-current="page"
        >
          <img src="/brand/k0sec-logo.png" alt="" />
        </a>
        <span className="rail-separator" />
        <button className="rail-item" type="button" disabled aria-label="Criar grupo indisponível">
          <PlusIcon aria-hidden="true" />
        </button>
      </aside>
      <ChannelSidebar
        roomName={props.roomName}
        participants={props.participants}
        user={props.user}
        voice={props.voice}
        open={props.channelsOpen}
        onClose={() => props.onChannelsOpenChange(false)}
        onLogout={props.onLogout}
      />
      <main className="app-main">{props.children}</main>
      <MemberSidebar
        participants={props.participants}
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
              label={props.voice.muted ? 'Ativar microfone' : 'Silenciar'}
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
              <HeadphonesIcon aria-hidden="true" />
            </IconButton>
            <IconButton label="Desconectar" tone="danger" onClick={props.voice.leave}>
              <ExitIcon aria-hidden="true" />
            </IconButton>
          </>
        )}
        <IconButton
          label="Mostrar participantes"
          aria-expanded={props.membersOpen}
          onClick={() => props.onMembersOpenChange(!props.membersOpen)}
        >
          <UsersIcon aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

import type { RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { Avatar, participantState } from './avatar';
import { IconButton } from './icon-button';
import {
  CameraIcon,
  CameraOffIcon,
  ExitIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SwitchCameraIcon,
  VolumeIcon,
} from './icons';
import { MediaRoomView } from './media-room-view';

interface CallControlsProps {
  muted: boolean;
  deafened: boolean;
  cameraActive: boolean;
  screenActive: boolean;
  supportsCamera: boolean;
  supportsScreenShare: boolean;
  canSwitchCamera: boolean;
  cameraSwitching: boolean;
  onToggleMuted(): void;
  onToggleDeafened(): void;
  onToggleCamera(): void;
  onSwitchCamera(): void;
  onToggleScreenShare(): void;
  onLeave(): void;
}

function CallControls(props: CallControlsProps) {
  return (
    <div className="call-stage-controls" aria-label="Controles da chamada">
      <IconButton
        label={props.muted ? 'Ativar microfone' : 'Desativar microfone'}
        className={props.muted ? 'is-active' : ''}
        aria-pressed={props.muted}
        onClick={props.onToggleMuted}
      >
        {props.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
      </IconButton>
      <IconButton
        label={props.deafened ? 'Ativar áudio' : 'Desativar áudio'}
        className={props.deafened ? 'is-active' : ''}
        aria-pressed={props.deafened}
        onClick={props.onToggleDeafened}
      >
        {props.deafened ? (
          <HeadphonesOffIcon aria-hidden="true" />
        ) : (
          <HeadphonesIcon aria-hidden="true" />
        )}
      </IconButton>
      {props.supportsCamera && (
        <IconButton
          label={props.cameraActive ? 'Desativar câmera' : 'Ativar câmera'}
          className={props.cameraActive ? 'is-active' : ''}
          aria-pressed={props.cameraActive}
          onClick={props.onToggleCamera}
        >
          {props.cameraActive ? (
            <CameraOffIcon aria-hidden="true" />
          ) : (
            <CameraIcon aria-hidden="true" />
          )}
        </IconButton>
      )}
      {props.canSwitchCamera && (
        <IconButton
          label="Trocar câmera"
          className="camera-switch-button"
          disabled={props.cameraSwitching}
          onClick={props.onSwitchCamera}
        >
          <SwitchCameraIcon aria-hidden="true" />
        </IconButton>
      )}
      {props.supportsScreenShare && (
        <IconButton
          label={props.screenActive ? 'Parar compartilhamento' : 'Compartilhar tela'}
          className={props.screenActive ? 'is-active' : ''}
          aria-pressed={props.screenActive}
          onClick={props.onToggleScreenShare}
        >
          {props.screenActive ? (
            <ScreenShareOffIcon aria-hidden="true" />
          ) : (
            <ScreenShareIcon aria-hidden="true" />
          )}
        </IconButton>
      )}
      <IconButton label="Sair da chamada" tone="danger" onClick={props.onLeave}>
        <ExitIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function SpeakingIndicator({ speaking }: { speaking: boolean }) {
  return (
    <span
      className={`speaking-indicator ${speaking ? 'is-speaking' : ''}`}
      aria-label={speaking ? 'Falando' : 'Em chamada'}
    />
  );
}

function ParticipantTile({
  participant,
  currentUserId,
}: {
  participant: RoomParticipant;
  currentUserId: string;
}) {
  return (
    <article className={`call-participant-tile ${participant.speaking ? 'is-speaking' : ''}`}>
      <div className="call-participant-avatar">
        <Avatar
          displayName={participant.displayName}
          state={participantState(participant)}
          size="large"
        />
        <SpeakingIndicator speaking={participant.speaking} />
      </div>
      <strong>
        {participant.displayName}
        {participant.userId === currentUserId ? ' (você)' : ''}
      </strong>
      <small>
        {participant.speaking
          ? 'Falando'
          : participant.deafened
            ? 'Áudio desativado'
            : participant.muted
              ? 'Microfone desativado'
              : 'Em chamada'}
      </small>
    </article>
  );
}

export type CallStageControls = CallControlsProps;

export function CallStage({
  title,
  contextLabel,
  participants,
  currentUserId,
  localMedia,
  remoteMedia,
  active,
  canJoin,
  statusLabel,
  variant,
  controls,
  onActivate,
}: {
  title: string;
  contextLabel: string;
  participants: RoomParticipant[];
  currentUserId: string;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
  active: boolean;
  canJoin: boolean;
  statusLabel: string;
  variant: 'compact' | 'full';
  controls?: CallStageControls;
  onActivate(): void;
}) {
  const hasVideo = [...localMedia, ...remoteMedia].some(
    (media) => media.publication.kind === 'video',
  );
  const participantLabel = `${participants.length} ${participants.length === 1 ? 'participante' : 'participantes'}`;

  return (
    <section
      className={`call-stage is-${variant} ${hasVideo ? 'has-video' : 'is-audio-only'}`}
      aria-label={`${contextLabel}: ${title}`}
    >
      <header className="call-stage-header">
        <button
          className="call-stage-summary"
          type="button"
          onClick={onActivate}
          disabled={!canJoin}
        >
          <VolumeIcon aria-hidden="true" />
          <span>
            <strong>{title}</strong>
            <small>
              {statusLabel} · {participantLabel}
            </small>
          </span>
        </button>
        {variant === 'compact' && (
          <button
            className="button secondary"
            type="button"
            onClick={onActivate}
            disabled={!canJoin}
          >
            {active ? 'Abrir chamada' : 'Entrar'}
          </button>
        )}
      </header>

      <div className="call-stage-content">
        {active && hasVideo ? (
          <MediaRoomView
            participants={participants}
            userId={currentUserId}
            localMedia={localMedia}
            remoteMedia={remoteMedia}
          />
        ) : participants.length > 0 ? (
          <div className="call-participant-grid" aria-label="Participantes da chamada">
            {participants.map((participant) => (
              <ParticipantTile
                key={participant.userId}
                participant={participant}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        ) : (
          <p className="call-stage-empty">Aguardando participantes…</p>
        )}
      </div>

      {variant === 'full' && active && controls && <CallControls {...controls} />}
    </section>
  );
}

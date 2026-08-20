import { useRef } from 'react';

import type { MediaPublication, RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { shouldMirrorLocalCamera } from '../features/voice/video-layout';
import { Avatar, participantState } from './avatar';
import { FullscreenButton } from './fullscreen-button';
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
  ScreenShareIcon,
  ScreenShareOffIcon,
  SwitchCameraIcon,
  VolumeIcon,
} from './icons';
import { MediaVideo } from './media-video';

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
  videoPublications,
  watchedPublication,
  watchedMedia,
  canWatch,
  onWatchPublication,
  onStopWatching,
}: {
  participant: RoomParticipant;
  currentUserId: string;
  videoPublications: MediaPublication[];
  watchedPublication: MediaPublication | undefined;
  watchedMedia: MediaStreamView | undefined;
  canWatch: boolean;
  onWatchPublication(publication: MediaPublication): void;
  onStopWatching(publication: MediaPublication): void;
}) {
  const tileRef = useRef<HTMLElement>(null);
  const participantName = `${participant.displayName}${
    participant.userId === currentUserId ? ' (você)' : ''
  }`;

  if (watchedPublication) {
    const localCamera =
      participant.userId === currentUserId && watchedPublication.source === 'camera';
    return (
      <article
        ref={tileRef}
        className={`call-participant-tile has-inline-media ${
          participant.speaking ? 'is-speaking' : ''
        }`}
      >
        {watchedMedia ? (
          <MediaVideo
            stream={watchedMedia.stream}
            muted={participant.userId === currentUserId}
            mirrored={
              localCamera && shouldMirrorLocalCamera(watchedMedia.stream.getVideoTracks()[0])
            }
            label={`${watchedPublication.source === 'camera' ? 'Câmera' : 'Tela'} de ${
              participantName
            }`}
          />
        ) : (
          <span className="inline-media-pending">Preparando transmissão…</span>
        )}
        <span className="inline-media-label">{participantName}</span>
        <div className="inline-media-actions">
          {watchedMedia && <FullscreenButton targetRef={tileRef} />}
          <IconButton label="Parar de assistir" onClick={() => onStopWatching(watchedPublication)}>
            <CloseIcon aria-hidden="true" />
          </IconButton>
        </div>
      </article>
    );
  }

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
      <strong>{participantName}</strong>
      <small>
        {participant.speaking
          ? 'Falando'
          : participant.deafened
            ? 'Áudio desativado'
            : participant.muted
              ? 'Microfone desativado'
              : 'Em chamada'}
      </small>
      {videoPublications.map((publication) => (
        <button
          className="button secondary compact"
          type="button"
          key={publication.publicationId}
          disabled={!canWatch}
          onClick={() => onWatchPublication(publication)}
        >
          {videoPublications.length === 1
            ? 'Assistir'
            : publication.source === 'camera'
              ? 'Assistir câmera'
              : 'Assistir tela'}
        </button>
      ))}
    </article>
  );
}

export type CallStageControls = CallControlsProps;

export function CallStage({
  title,
  contextLabel,
  participants,
  currentUserId,
  publications,
  active,
  canJoin,
  statusLabel,
  variant,
  controls,
  localMedia,
  remoteMedia,
  watchedMediaKeys,
  onActivate,
  onWatchPublication,
  onStopWatching,
}: {
  title: string;
  contextLabel: string;
  participants: RoomParticipant[];
  currentUserId: string;
  publications: MediaPublication[];
  active: boolean;
  canJoin: boolean;
  statusLabel: string;
  variant: 'compact' | 'full';
  controls?: CallStageControls;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
  watchedMediaKeys: string[];
  onActivate(): void;
  onWatchPublication(publication: MediaPublication): void;
  onStopWatching(publication: MediaPublication): void;
}) {
  const videoPublications = publications.filter((publication) => publication.kind === 'video');
  const videoMedia = [...localMedia, ...remoteMedia].filter(
    (media) => media.publication.kind === 'video',
  );
  const hasVideo = videoPublications.length > 0;
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
            disabled={active || !canJoin}
          >
            {active ? 'Conectado' : 'Entrar'}
          </button>
        )}
      </header>

      <div className="call-stage-content">
        {participants.length > 0 ? (
          <div className="call-participant-grid" aria-label="Participantes da chamada">
            {participants.map((participant) => {
              const participantPublications = videoPublications.filter(
                (publication) => publication.userId === participant.userId,
              );
              const watchedPublication = participantPublications.find((publication) =>
                watchedMediaKeys.includes(`${publication.userId}:${publication.source}`),
              );
              const watchedMedia = watchedPublication
                ? videoMedia.find(
                    (media) =>
                      media.publication.userId === watchedPublication.userId &&
                      media.publication.source === watchedPublication.source,
                  )
                : undefined;
              return (
                <ParticipantTile
                  key={participant.userId}
                  participant={participant}
                  currentUserId={currentUserId}
                  videoPublications={participantPublications}
                  watchedPublication={watchedPublication}
                  watchedMedia={watchedMedia}
                  canWatch={canJoin || active}
                  onWatchPublication={onWatchPublication}
                  onStopWatching={onStopWatching}
                />
              );
            })}
          </div>
        ) : (
          <p className="call-stage-empty">Aguardando participantes…</p>
        )}
      </div>

      {variant === 'full' && active && controls && <CallControls {...controls} />}
    </section>
  );
}

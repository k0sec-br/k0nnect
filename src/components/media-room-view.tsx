import { useEffect, useMemo, useRef, useState } from 'react';

import type { RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { mediaTrackAspectRatio, shouldMirrorLocalCamera } from '../features/voice/video-layout';
import { Avatar, participantState } from './avatar';
import { FullscreenButton } from './fullscreen-button';
import { MediaVideo } from './media-video';
import { ScreenShareViewport } from './screen-share-viewport';

interface DisplayMedia extends MediaStreamView {
  local: boolean;
}

function participantName(
  media: DisplayMedia,
  participants: RoomParticipant[],
  userId: string,
): string {
  const participant = participants.find((item) => item.userId === media.publication.userId);
  const name = participant?.displayName ?? 'Participante';
  return media.publication.userId === userId ? `${name} (você)` : name;
}

function VideoTile({
  media,
  participants,
  userId,
  compact = false,
  fitContainer = false,
  onSelect,
}: {
  media: DisplayMedia;
  participants: RoomParticipant[];
  userId: string;
  compact?: boolean;
  fitContainer?: boolean;
  onSelect?(): void;
}) {
  const tileRef = useRef<HTMLElement>(null);
  const name = participantName(media, participants, userId);
  const speaking = participants.some(
    (participant) => participant.userId === media.publication.userId && participant.speaking,
  );
  const cameraTrack = media.stream.getVideoTracks()[0];
  const [aspectRatio, setAspectRatio] = useState(
    () => mediaTrackAspectRatio(cameraTrack) ?? 16 / 9,
  );
  useEffect(() => {
    setAspectRatio(mediaTrackAspectRatio(media.stream.getVideoTracks()[0]) ?? 16 / 9);
  }, [media.stream]);
  const tileClassName = `media-tile ${compact ? 'is-compact' : ''} ${fitContainer ? 'is-fit-container' : ''} ${
    media.local && media.publication.source === 'camera' && shouldMirrorLocalCamera(cameraTrack)
      ? 'is-local-camera'
      : ''
  } ${speaking ? 'is-speaking' : ''}`;
  const content = (
    <>
      <MediaVideo
        stream={media.stream}
        muted={media.local}
        mirrored={
          media.local &&
          media.publication.source === 'camera' &&
          shouldMirrorLocalCamera(cameraTrack)
        }
        label={`${media.publication.source === 'camera' ? 'Câmera' : 'Tela'} de ${name}`}
        onAspectRatioChange={setAspectRatio}
      />
      <span className="media-tile-label">{name}</span>
    </>
  );
  return (
    <article
      className={tileClassName}
      ref={tileRef}
      style={fitContainer ? undefined : { aspectRatio }}
    >
      {content}
      <div className="media-tile-actions">
        {onSelect && (
          <button type="button" onClick={onSelect}>
            Focar
          </button>
        )}
        <FullscreenButton targetRef={tileRef} />
      </div>
    </article>
  );
}

export function MediaRoomView({
  participants,
  userId,
  localMedia,
  remoteMedia,
  layout = 'stage',
  focusedPublicationId,
  onFocusPublication,
}: {
  participants: RoomParticipant[];
  userId: string;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
  layout?: 'focus' | 'grid' | 'stage';
  focusedPublicationId?: string | null;
  onFocusPublication?(publicationId: string): void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const media = useMemo<DisplayMedia[]>(
    () => [
      ...localMedia.map((item) => ({ ...item, local: true })),
      ...remoteMedia.map((item) => ({ ...item, local: false })),
    ],
    [localMedia, remoteMedia],
  );
  const videoMedia = media.filter((item) => item.publication.kind === 'video');
  const screenMedia = videoMedia.filter((item) => item.publication.source === 'screen-video');
  const cameraMedia = videoMedia.filter((item) => item.publication.source === 'camera');
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [screenAspectRatio, setScreenAspectRatio] = useState(16 / 9);

  useEffect(() => {
    if (!screenMedia.some((item) => item.publication.publicationId === selectedScreenId)) {
      setSelectedScreenId(screenMedia[0]?.publication.publicationId ?? null);
    }
  }, [screenMedia, selectedScreenId]);

  useEffect(() => {
    const selected = screenMedia.find(
      (item) => item.publication.publicationId === selectedScreenId,
    );
    setScreenAspectRatio(mediaTrackAspectRatio(selected?.stream.getVideoTracks()[0]) ?? 16 / 9);
  }, [screenMedia, selectedScreenId]);

  if (layout === 'focus') {
    const focusedMedia =
      videoMedia.find((item) => item.publication.publicationId === focusedPublicationId) ??
      videoMedia[0];
    return focusedMedia ? (
      <section className="floating-media-focus" aria-label="Transmissão em foco">
        <VideoTile media={focusedMedia} participants={participants} userId={userId} fitContainer />
      </section>
    ) : null;
  }

  if (layout === 'grid') {
    return (
      <section className="camera-grid floating-media-grid" aria-label="Transmissões assistidas">
        {videoMedia.map((item) => (
          <VideoTile
            key={item.publication.publicationId}
            media={item}
            participants={participants}
            userId={userId}
            fitContainer
            {...(videoMedia.length > 1 && onFocusPublication
              ? {
                  onSelect: () => onFocusPublication(item.publication.publicationId),
                }
              : {})}
          />
        ))}
      </section>
    );
  }

  if (screenMedia.length > 0) {
    const selected =
      screenMedia.find((item) => item.publication.publicationId === selectedScreenId) ??
      screenMedia[0];
    if (!selected) return null;
    return (
      <section className="screen-share-layout" aria-label="Compartilhamento de tela">
        <div
          className="screen-share-stage"
          ref={stageRef}
          style={{ aspectRatio: screenAspectRatio }}
        >
          <ScreenShareViewport streamId={selected.publication.publicationId}>
            <MediaVideo
              stream={selected.stream}
              muted={selected.local}
              label={`Tela de ${participantName(selected, participants, userId)}`}
              onAspectRatioChange={setScreenAspectRatio}
            />
          </ScreenShareViewport>
          <div className="screen-share-overlay">
            <span>
              {participantName(selected, participants, userId)} está compartilhando
              {media.some(
                (item) =>
                  item.publication.userId === selected.publication.userId &&
                  item.publication.source === 'screen-audio',
              )
                ? ' com áudio'
                : ''}
            </span>
            <FullscreenButton targetRef={stageRef} />
          </div>
        </div>
        {(screenMedia.length > 1 || cameraMedia.length > 0) && (
          <div className="media-filmstrip" aria-label="Outros vídeos">
            {[...screenMedia, ...cameraMedia]
              .filter(
                (item) => item.publication.publicationId !== selected.publication.publicationId,
              )
              .map((item) => (
                <VideoTile
                  key={item.publication.publicationId}
                  media={item}
                  participants={participants}
                  userId={userId}
                  compact
                  {...(item.publication.source === 'screen-video'
                    ? { onSelect: () => setSelectedScreenId(item.publication.publicationId) }
                    : {})}
                />
              ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="camera-grid" aria-label="Câmeras da sala">
      {cameraMedia.map((item) => (
        <VideoTile
          key={item.publication.publicationId}
          media={item}
          participants={participants}
          userId={userId}
        />
      ))}
      {participants
        .filter(
          (participant) =>
            !cameraMedia.some((item) => item.publication.userId === participant.userId),
        )
        .map((participant) => (
          <article className="media-tile media-placeholder" key={participant.userId}>
            <Avatar
              displayName={participant.displayName}
              state={participantState(participant)}
              size="large"
            />
            <span className="media-tile-label">
              {participant.displayName}
              {participant.userId === userId ? ' (você)' : ''}
            </span>
          </article>
        ))}
    </section>
  );
}

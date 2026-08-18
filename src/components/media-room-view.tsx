import { useEffect, useMemo, useRef, useState } from 'react';

import type { RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { Avatar } from './avatar';
import { MaximizeIcon } from './icons';
import { MediaVideo } from './media-video';

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
  onSelect,
}: {
  media: DisplayMedia;
  participants: RoomParticipant[];
  userId: string;
  compact?: boolean;
  onSelect?(): void;
}) {
  const tileRef = useRef<HTMLElement>(null);
  const name = participantName(media, participants, userId);
  const speaking = participants.some(
    (participant) => participant.userId === media.publication.userId && participant.speaking,
  );
  const tileClassName = `media-tile ${compact ? 'is-compact' : ''} ${
    media.local && media.publication.source === 'camera' ? 'is-local-camera' : ''
  } ${speaking ? 'is-speaking' : ''}`;
  const content = (
    <>
      <MediaVideo stream={media.stream} muted={media.local} label={`Vídeo de ${name}`} />
      <span className="media-tile-label">{name}</span>
    </>
  );
  return (
    <article className={tileClassName} ref={tileRef}>
      {content}
      <div className="media-tile-actions">
        {onSelect && (
          <button type="button" onClick={onSelect}>
            Focar
          </button>
        )}
        <button
          type="button"
          aria-label={`Exibir vídeo de ${name} em tela cheia`}
          onClick={() => void tileRef.current?.requestFullscreen()}
        >
          <MaximizeIcon aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

export function MediaRoomView({
  participants,
  userId,
  localMedia,
  remoteMedia,
}: {
  participants: RoomParticipant[];
  userId: string;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
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

  useEffect(() => {
    if (!screenMedia.some((item) => item.publication.publicationId === selectedScreenId)) {
      setSelectedScreenId(screenMedia[0]?.publication.publicationId ?? null);
    }
  }, [screenMedia, selectedScreenId]);

  if (screenMedia.length > 0) {
    const selected =
      screenMedia.find((item) => item.publication.publicationId === selectedScreenId) ??
      screenMedia[0];
    if (!selected) return null;
    return (
      <section className="screen-share-layout" aria-label="Compartilhamento de tela">
        <div className="screen-share-stage" ref={stageRef}>
          <MediaVideo
            stream={selected.stream}
            muted={selected.local}
            label={`Tela de ${participantName(selected, participants, userId)}`}
          />
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
            <button
              type="button"
              aria-label="Exibir compartilhamento em tela cheia"
              onClick={() => void stageRef.current?.requestFullscreen()}
            >
              <MaximizeIcon aria-hidden="true" />
            </button>
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
            <Avatar displayName={participant.displayName} size="large" />
            <span className="media-tile-label">
              {participant.displayName}
              {participant.userId === userId ? ' (você)' : ''}
            </span>
          </article>
        ))}
    </section>
  );
}

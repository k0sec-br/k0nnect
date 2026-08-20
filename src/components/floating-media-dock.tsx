import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { mediaTrackAspectRatio } from '../features/voice/video-layout';
import { IconButton } from './icon-button';
import { CloseIcon } from './icons';
import { MediaRoomView } from './media-room-view';

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export function FloatingMediaDock({
  title,
  participants,
  userId,
  localMedia,
  remoteMedia,
  onClose,
  onReturnToConversation,
}: {
  title: string;
  participants: RoomParticipant[];
  userId: string;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
  onClose(): void;
  onReturnToConversation(): void;
}) {
  const dockRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const videoMedia = [...localMedia, ...remoteMedia].filter(
    (media) => media.publication.kind === 'video',
  );
  const hasMedia = videoMedia.length > 0;
  const focusedMedia = videoMedia.at(-1);
  const mediaAspectRatio =
    mediaTrackAspectRatio(focusedMedia?.stream.getVideoTracks()[0]) ?? 16 / 9;
  const maximumDockWidth = Math.max(
    160,
    Math.min(896, viewport.width - 16, (viewport.height - 80) * mediaAspectRatio),
  );
  const minimumDockWidth = Math.min(288, maximumDockWidth);
  const dockStyle = {
    '--media-aspect-ratio': String(mediaAspectRatio),
    minWidth: minimumDockWidth,
    maxWidth: maximumDockWidth,
    ...(position ? { right: 'auto', bottom: 'auto', left: position.left, top: position.top } : {}),
  } as CSSProperties;

  useEffect(() => {
    const updateViewport = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  function startDragging(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    const bounds = dockRef.current?.getBoundingClientRect();
    if (!bounds) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: ReactPointerEvent<HTMLElement>) {
    const state = dragRef.current;
    const dock = dockRef.current;
    if (state?.pointerId !== event.pointerId || !dock) return;
    const bounds = dock.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(event.clientX - state.offsetX, window.innerWidth - bounds.width - 8),
      ),
      top: Math.max(
        8,
        Math.min(event.clientY - state.offsetY, window.innerHeight - bounds.height - 8),
      ),
    });
  }

  function stopDragging(event: ReactPointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <section
      ref={dockRef}
      className="floating-media-dock"
      style={dockStyle}
      aria-label={`Transmissões de ${title}`}
    >
      <header
        className="floating-media-header"
        onPointerDown={startDragging}
        onPointerMove={drag}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div className="floating-media-context">
          <strong>{title}</strong>
        </div>
        <div className="floating-media-actions">
          <button
            className="button ghost compact floating-media-return"
            type="button"
            onClick={onReturnToConversation}
          >
            Voltar
          </button>
          <IconButton label="Ocultar transmissões" onClick={onClose}>
            <CloseIcon aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      <div className="floating-media-content">
        {hasMedia ? (
          <MediaRoomView
            participants={participants}
            userId={userId}
            localMedia={localMedia}
            remoteMedia={remoteMedia}
            layout="focus"
            focusedPublicationId={focusedMedia?.publication.publicationId ?? null}
          />
        ) : (
          <p>Preparando transmissão…</p>
        )}
      </div>
    </section>
  );
}

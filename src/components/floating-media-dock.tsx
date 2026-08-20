import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import type { RoomParticipant } from '../../shared/protocol/room';
import type { MediaStreamView } from '../features/voice/use-voice-session';
import { IconButton } from './icon-button';
import { CloseIcon, MaximizeIcon, MinimizeIcon } from './icons';
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
  focusedConversation,
  onClose,
  onReturnToConversation,
}: {
  title: string;
  participants: RoomParticipant[];
  userId: string;
  localMedia: MediaStreamView[];
  remoteMedia: MediaStreamView[];
  focusedConversation: boolean;
  onClose(): void;
  onReturnToConversation(): void;
}) {
  const dockRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const hasMedia = localMedia.length + remoteMedia.length > 0;

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
      className={`floating-media-dock ${expanded ? 'is-expanded' : ''}`}
      style={
        position
          ? { right: 'auto', bottom: 'auto', left: position.left, top: position.top }
          : undefined
      }
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
          <small>{focusedConversation ? 'Conversa em foco' : 'Voltar à conversa'}</small>
        </div>
        <div>
          {!focusedConversation && (
            <button
              className="button ghost compact floating-media-return"
              type="button"
              onClick={onReturnToConversation}
            >
              Voltar à conversa
            </button>
          )}
          <IconButton
            label={expanded ? 'Reduzir transmissões' : 'Ampliar transmissões'}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <MinimizeIcon aria-hidden="true" /> : <MaximizeIcon aria-hidden="true" />}
          </IconButton>
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
            layout="grid"
          />
        ) : (
          <p>Preparando transmissão…</p>
        )}
      </div>
    </section>
  );
}

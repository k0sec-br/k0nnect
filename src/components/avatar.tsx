import type { RoomParticipant } from '../../shared/protocol/room';

export function getInitials(displayName: string): string {
  return displayName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

type PresenceState = 'online' | 'offline' | 'speaking' | 'muted' | 'deafened';

export function participantState(participant: RoomParticipant): PresenceState {
  if (participant.deafened) return 'deafened';
  if (participant.muted) return 'muted';
  if (participant.speaking) return 'speaking';
  return 'online';
}

export function Avatar({
  displayName,
  state = 'online',
  size = 'medium',
}: {
  displayName: string;
  state?: PresenceState;
  size?: 'small' | 'medium' | 'large';
}) {
  const stateLabel: Record<PresenceState, string> = {
    online: 'Online',
    offline: 'Offline',
    speaking: 'Falando',
    muted: 'Microfone desativado',
    deafened: 'Áudio desativado',
  };

  return (
    <span className={`avatar avatar-${size} avatar-${state}`} aria-hidden="true">
      {getInitials(displayName)}
      <span className="status-indicator" title={stateLabel[state]} />
    </span>
  );
}

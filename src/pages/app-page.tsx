import { useEffect, useState } from 'react';

import type { RoomView } from '../../shared/types/api';
import { AppShell } from '../components/app-shell';
import { AudioOnlyView } from '../components/audio-only-view';
import { FormMessage } from '../components/form-message';
import { IconButton } from '../components/icon-button';
import { MenuIcon, MicIcon, UsersIcon, VolumeIcon } from '../components/icons';
import { RemoteAudio } from '../components/remote-audio';
import { useAuth } from '../features/auth/auth-context';
import { useRoomSocket } from '../features/rooms/use-room-socket';
import { useVoiceSession } from '../features/voice/use-voice-session';
import { usePublicConfig } from '../hooks/use-public-config';
import { apiClient } from '../lib/api-client';
import { navigate } from '../lib/navigation';

export function AppPage() {
  const { logout, user } = useAuth();
  const config = usePublicConfig();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ rooms: RoomView[] }>('/api/rooms')
      .then((result) => setRoom(result.rooms[0] ?? null))
      .catch(() => setLoadError('Não foi possível carregar as salas agora.'));
  }, []);

  const socket = useRoomSocket(room?.id ?? null);
  const voice = useVoiceSession({
    roomId: room?.id ?? 'room_general',
    connectionId: socket.connectionId,
    participants: socket.participants.filter((participant) => participant.userId !== user?.id),
    updatePresence: socket.updatePresence,
    updateSpeaking: socket.updateSpeaking,
  });

  if (!user) return null;
  if (!room) {
    return (
      <main className="center-state">
        {loadError ? (
          <FormMessage message={loadError} />
        ) : (
          <span className="spinner large" aria-label="Carregando sala" />
        )}
      </main>
    );
  }

  const shellVoice = {
    status: voice.status,
    muted: voice.muted,
    deafened: voice.deafened,
    canJoin: Boolean(socket.connectionId && config?.realtimeEnabled),
    selectedDevice: voice.selectedDevice,
    devices: voice.devices,
    join: () => void voice.join(),
    leave: () => void voice.leave(),
    toggleMuted: voice.toggleMuted,
    toggleDeafened: voice.toggleDeafened,
    changeMicrophone: (deviceId: string) => void voice.changeMicrophone(deviceId),
  };

  return (
    <AppShell
      user={user}
      roomName={room.name}
      participants={socket.participants}
      connectionState={socket.connectionState}
      voice={shellVoice}
      channelsOpen={channelsOpen}
      membersOpen={membersOpen}
      onChannelsOpenChange={setChannelsOpen}
      onMembersOpenChange={setMembersOpen}
      onLogout={() => void logout().then(() => navigate('/login'))}
    >
      <div className="voice-room">
        <header className="main-header">
          <IconButton
            label="Mostrar canais"
            className="mobile-menu-button"
            aria-expanded={channelsOpen}
            onClick={() => setChannelsOpen(!channelsOpen)}
          >
            <MenuIcon aria-hidden="true" />
          </IconButton>
          <div className="main-header-title">
            <VolumeIcon aria-hidden="true" />
            <h1>{room.name}</h1>
          </div>
          <span className={`connection-status connection-${socket.connectionState}`} role="status">
            <i aria-hidden="true" />
            {socket.connectionState === 'connected'
              ? 'Conectado'
              : socket.connectionState === 'offline'
                ? 'Sem conexão'
                : 'Reconectando…'}
          </span>
          <IconButton
            label="Mostrar participantes"
            className="members-toggle"
            aria-expanded={membersOpen}
            onClick={() => setMembersOpen(!membersOpen)}
          >
            <UsersIcon aria-hidden="true" />
          </IconButton>
        </header>

        <div className="voice-room-content">
          {(socket.message || voice.error) && (
            <FormMessage message={voice.error || socket.message} />
          )}
          {!config?.realtimeEnabled && (
            <div className="inline-notice" role="status">
              Presença local ativa. Configure o Cloudflare Realtime para habilitar áudio neste
              ambiente.
            </div>
          )}
          <AudioOnlyView participants={socket.participants} userId={user.id} />
        </div>

        {voice.status === 'idle' && (
          <div className="desktop-join-bar">
            <button
              className="button primary"
              type="button"
              onClick={() => void voice.join()}
              disabled={!socket.connectionId || !config?.realtimeEnabled}
            >
              <MicIcon aria-hidden="true" /> Entrar na voz
            </button>
            <p>Ao entrar, seu microfone será solicitado pelo navegador.</p>
          </div>
        )}
        <div hidden aria-hidden="true">
          {voice.remoteStreams.map((remote) => (
            <RemoteAudio key={remote.id} stream={remote.stream} muted={voice.deafened} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

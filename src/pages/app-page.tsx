import { useEffect, useState } from 'react';

import type { RoomView } from '../../shared/types/api';
import { FormMessage } from '../components/form-message';
import { HeadphonesIcon, MicIcon, MicOffIcon, SettingsIcon, VolumeIcon } from '../components/icons';
import { RemoteAudio } from '../components/remote-audio';
import { useAuth } from '../features/auth/auth-context';
import { useRoomSocket } from '../features/rooms/use-room-socket';
import { useVoiceSession } from '../features/voice/use-voice-session';
import { usePublicConfig } from '../hooks/use-public-config';
import { apiClient } from '../lib/api-client';
import { handleInternalLink } from '../lib/navigation';

function participantInitials(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppPage() {
  const { user } = useAuth();
  const config = usePublicConfig();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [loadError, setLoadError] = useState('');

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

  if (!room) {
    return (
      <div className="center-state">
        {loadError ? (
          <FormMessage message={loadError} />
        ) : (
          <span className="spinner large" aria-label="Carregando sala" />
        )}
      </div>
    );
  }

  return (
    <div className="voice-room">
      <header className="room-header">
        <div>
          <span className="room-icon" aria-hidden="true">
            <VolumeIcon />
          </span>
          <div>
            <h1>{room.name}</h1>
            <p>Conversa por voz · sem gravação</p>
          </div>
        </div>
        <span className={`connection-badge ${socket.connectionState}`}>
          <span aria-hidden="true" />
          {socket.connectionState === 'connected'
            ? 'Conectado'
            : socket.connectionState === 'offline'
              ? 'Sem conexão'
              : 'Reconectando…'}
        </span>
      </header>

      {(socket.message || voice.error) && <FormMessage message={voice.error || socket.message} />}
      {!config?.realtimeEnabled && (
        <div className="local-banner" role="status">
          Presença local ativa. Configure o Cloudflare Realtime para habilitar áudio neste ambiente.
        </div>
      )}

      <section className="participants-section" aria-labelledby="participants-title">
        <div className="section-heading">
          <h2 id="participants-title">Na sala</h2>
          <span>{socket.participants.length} participantes</span>
        </div>
        <div className="participant-grid">
          {socket.participants.map((participant) => (
            <article
              className={`participant-card ${participant.speaking ? 'speaking' : ''}`}
              key={participant.userId}
            >
              <div className="participant-avatar">
                {participantInitials(participant.displayName)}
                {participant.speaking && (
                  <span className="speaking-wave" aria-label="Falando agora">
                    )))
                  </span>
                )}
              </div>
              <div className="participant-copy">
                <strong>
                  {participant.displayName} {participant.userId === user?.id && <span>(você)</span>}
                </strong>
                <span>{participant.speaking ? 'Falando agora' : 'Ouvindo'}</span>
              </div>
              <div className="participant-state">
                {participant.deafened && <HeadphonesIcon aria-label="Som desativado" />}
                {participant.muted && <MicOffIcon aria-label="Microfone desativado" />}
              </div>
            </article>
          ))}
          {socket.participants.length === 0 && (
            <div className="empty-room">
              <VolumeIcon aria-hidden="true" />
              <strong>A sala está tranquila</strong>
              <span>Você será o primeiro a chegar.</span>
            </div>
          )}
        </div>
      </section>

      <footer className="voice-controls" aria-label="Controles de voz">
        {voice.status === 'idle' ? (
          <button
            className="button primary join-button"
            type="button"
            onClick={() => void voice.join()}
            disabled={!socket.connectionId || !config?.realtimeEnabled}
          >
            <MicIcon aria-hidden="true" /> Entrar na voz
          </button>
        ) : (
          <>
            <button
              className={`control-button ${voice.muted ? 'active' : ''}`}
              type="button"
              onClick={voice.toggleMuted}
              aria-pressed={voice.muted}
            >
              {voice.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
              <span>{voice.muted ? 'Ativar microfone' : 'Silenciar'}</span>
            </button>
            <button
              className={`control-button ${voice.deafened ? 'active' : ''}`}
              type="button"
              onClick={voice.toggleDeafened}
              aria-pressed={voice.deafened}
            >
              <HeadphonesIcon aria-hidden="true" />
              <span>{voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}</span>
            </button>
            <label className="device-select">
              <span>Microfone</span>
              <select
                value={voice.selectedDevice}
                onChange={(event) => void voice.changeMicrophone(event.target.value)}
              >
                {voice.devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microfone ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="control-button danger"
              type="button"
              onClick={() => void voice.leave()}
            >
              <ExitIconLabel />
              <span>Desconectar</span>
            </button>
          </>
        )}
        <a className="control-button settings-link" href="/settings" onClick={handleInternalLink}>
          <SettingsIcon aria-hidden="true" />
          <span>Configurações</span>
        </a>
      </footer>
      <div hidden aria-hidden="true">
        {voice.remoteStreams.map((remote) => (
          <RemoteAudio key={remote.id} stream={remote.stream} muted={voice.deafened} />
        ))}
      </div>
    </div>
  );
}

function ExitIconLabel() {
  return (
    <span className="hangup-icon" aria-hidden="true">
      ×
    </span>
  );
}

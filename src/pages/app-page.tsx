import { useEffect, useState } from 'react';

import { AppShell } from '../components/app-shell';
import { AudioOnlyView } from '../components/audio-only-view';
import { FormMessage } from '../components/form-message';
import { IconButton } from '../components/icon-button';
import { MediaRoomView } from '../components/media-room-view';
import { MediaDebugPanel } from '../components/media-debug-panel';
import { MenuIcon, MicIcon, UsersIcon, VolumeIcon } from '../components/icons';
import { RemoteAudio } from '../components/remote-audio';
import { useAuth } from '../features/auth/auth-context';
import { useCall } from '../features/call/call-context';
import { useMediaQuery } from '../hooks/use-media-query';
import { navigate } from '../lib/navigation';

function connectionStatusLabel(state: ReturnType<typeof useCall>['connectionState']): string {
  if (state === 'connected') return 'Conectado';
  if (state === 'idle' || state === 'disconnected') return 'Sala conectada';
  if (state === 'connecting') return 'Conectando…';
  if (state === 'degraded') return 'Conexão instável';
  if (state === 'suspended') return 'Aguardando rede…';
  if (state === 'disconnecting') return 'Desconectando…';
  if (state === 'failed') return 'Não foi possível restabelecer a chamada';
  return 'Reconectando…';
}

export function AppPage() {
  const { logout, user } = useAuth();
  const { activateRoom, config, connectionState, loadError, room, socket, voice } = useCall();
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const membersAreOptional = useMediaQuery('(max-width: 1199px)');
  const mobileLayout = useMediaQuery('(max-width: 767px)');

  useEffect(() => {
    activateRoom();
  }, [activateRoom]);

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
    userMuted: voice.userMuted,
    deafened: voice.deafened,
    canJoin: Boolean(socket.connectionId && config?.realtimeEnabled),
    selectedMicrophone: voice.selectedMicrophone,
    microphones: voice.microphones,
    cameraState: voice.cameraState,
    cameras: voice.cameras,
    screenState: voice.screenState,
    supportsCamera: voice.supportsCamera,
    supportsScreenShare: voice.supportsScreenShare,
    join: () => void voice.join(),
    leave: () => void voice.leave(),
    toggleMuted: voice.toggleMuted,
    toggleDeafened: voice.toggleDeafened,
    changeMicrophone: (deviceId: string) => void voice.changeMicrophone(deviceId),
    toggleCamera: () =>
      void (voice.cameraState === 'active' ? voice.stopCamera() : voice.startCamera()),
    switchCamera: () => void voice.switchCamera(),
    toggleScreenShare: () =>
      void (voice.screenState === 'active' ? voice.stopScreenShare() : voice.startScreenShare()),
  };

  return (
    <AppShell
      user={user}
      roomName={room.name}
      participants={socket.participants}
      publications={socket.publications}
      connectionState={connectionState}
      voice={shellVoice}
      channelsOpen={channelsOpen}
      membersOpen={membersOpen}
      onChannelsOpenChange={setChannelsOpen}
      onMembersOpenChange={setMembersOpen}
      onLogout={() => void logout().then(() => navigate('/login'))}
    >
      <div className="voice-room">
        <header className="main-header">
          {mobileLayout && (
            <IconButton
              label="Mostrar canais"
              className="mobile-menu-button"
              aria-expanded={channelsOpen}
              onClick={() => setChannelsOpen(!channelsOpen)}
            >
              <MenuIcon aria-hidden="true" />
            </IconButton>
          )}
          <div className="main-header-title">
            <VolumeIcon aria-hidden="true" />
            <h1>{room.name}</h1>
          </div>
          <span className={`connection-status connection-${connectionState}`} role="status">
            <i aria-hidden="true" />
            {connectionStatusLabel(connectionState)}
          </span>
          {membersAreOptional && (
            <IconButton
              label={membersOpen ? 'Ocultar participantes' : 'Mostrar participantes'}
              className="members-toggle"
              aria-expanded={membersOpen}
              onClick={() => setMembersOpen(!membersOpen)}
            >
              <UsersIcon aria-hidden="true" />
            </IconButton>
          )}
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
          {[...voice.localMedia, ...voice.remoteMedia].some(
            (media) => media.publication.kind === 'video',
          ) ? (
            <MediaRoomView
              participants={socket.participants}
              userId={user.id}
              localMedia={voice.localMedia}
              remoteMedia={voice.remoteMedia}
            />
          ) : (
            <AudioOnlyView participants={socket.participants} userId={user.id} />
          )}
          {import.meta.env.DEV && (
            <MediaDebugPanel
              callState={connectionState}
              connectionEpoch={socket.connectionIdentity()?.connectionEpoch ?? null}
              health={voice.debugHealth}
              lastRecoveryReason={voice.lastRecoveryReason}
              networkOnline={navigator.onLine}
              recoveryAttempts={voice.recoveryAttempts}
              socketState={socket.connectionState}
              stats={voice.debugStats}
            />
          )}
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
          {voice.remoteMedia
            .filter((remote) => remote.publication.kind === 'audio')
            .map((remote) => (
              <RemoteAudio
                key={remote.publication.publicationId}
                stream={remote.stream}
                muted={voice.deafened}
              />
            ))}
        </div>
      </div>
    </AppShell>
  );
}

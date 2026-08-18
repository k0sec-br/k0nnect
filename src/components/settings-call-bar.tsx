import { useCall } from '../features/call/call-context';
import { handleInternalLink } from '../lib/navigation';
import { IconButton } from './icon-button';
import { ExitIcon, HeadphonesIcon, HeadphonesOffIcon, MicIcon, MicOffIcon } from './icons';

export function SettingsCallBar() {
  const { room, voice } = useCall();
  if (voice.status === 'idle') return null;

  const microphoneLabel = voice.deafened
    ? voice.userMuted
      ? 'Ativar microfone ao reativar áudio'
      : 'Desativar microfone ao reativar áudio'
    : voice.userMuted
      ? 'Ativar microfone'
      : 'Desativar microfone';

  return (
    <aside className="settings-call-bar" aria-label="Chamada ativa">
      <div className="settings-call-status">
        <span>Voz conectada</span>
        <strong>{room?.name ?? 'Sala de voz'}</strong>
      </div>
      <div className="settings-call-controls">
        <a className="button secondary" href="/app" onClick={handleInternalLink}>
          Voltar
        </a>
        <IconButton
          label={microphoneLabel}
          className={voice.muted ? 'is-active' : ''}
          aria-pressed={voice.muted}
          onClick={voice.toggleMuted}
        >
          {voice.muted ? <MicOffIcon aria-hidden="true" /> : <MicIcon aria-hidden="true" />}
        </IconButton>
        <IconButton
          label={voice.deafened ? 'Ativar áudio' : 'Desativar áudio'}
          className={voice.deafened ? 'is-active' : ''}
          aria-pressed={voice.deafened}
          onClick={voice.toggleDeafened}
        >
          {voice.deafened ? (
            <HeadphonesOffIcon aria-hidden="true" />
          ) : (
            <HeadphonesIcon aria-hidden="true" />
          )}
        </IconButton>
        <IconButton label="Desconectar" tone="danger" onClick={() => void voice.leave()}>
          <ExitIcon aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  );
}

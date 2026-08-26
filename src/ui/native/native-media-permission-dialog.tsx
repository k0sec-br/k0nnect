import { useEffect, useRef, useState } from 'react';

import { CameraIcon, MicIcon, ScreenShareIcon } from '../../components/icons';
import {
  subscribeToNativeMediaPermission,
  type NativeMediaPermissionKind,
  type NativeMediaPermissionRequest,
} from '../../core/native/native-media-permissions';

const PERMISSION_CONTENT: Record<
  NativeMediaPermissionKind,
  { eyebrow: string; title: string; description: string; detail: string; action: string }
> = {
  microphone: {
    eyebrow: 'ÁUDIO DA CHAMADA',
    title: 'Use seu microfone no k0nnect',
    description: 'Seu áudio é capturado somente enquanto você participa de uma chamada.',
    detail:
      'O sistema pode solicitar a autorização uma vez. Ela pode ser alterada nas configurações de privacidade.',
    action: 'Continuar',
  },
  camera: {
    eyebrow: 'VÍDEO DA CHAMADA',
    title: 'Use sua câmera no k0nnect',
    description: 'Sua câmera permanece desligada até você ativá-la em uma chamada ou prévia.',
    detail:
      'O sistema pode solicitar a autorização uma vez. Ela pode ser alterada nas configurações de privacidade.',
    action: 'Continuar',
  },
  screen: {
    eyebrow: 'COMPARTILHAMENTO',
    title: 'Escolha o que compartilhar',
    description: 'O sistema mostrará as telas e janelas disponíveis para você escolher.',
    detail:
      'O k0nnect recebe somente a fonte escolhida e apenas enquanto o compartilhamento estiver ativo.',
    action: 'Escolher tela',
  },
};

function PermissionIcon({ kind }: { kind: NativeMediaPermissionKind }) {
  const props = { 'aria-hidden': true, width: 28, height: 28 };
  if (kind === 'microphone') return <MicIcon {...props} />;
  if (kind === 'camera') return <CameraIcon {...props} />;
  return <ScreenShareIcon {...props} />;
}

export function NativeMediaPermissionDialog() {
  const [request, setRequest] = useState<NativeMediaPermissionRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      subscribeToNativeMediaPermission((nextRequest) => {
        setRequest(nextRequest);
        setBusy(false);
      }),
    [],
  );

  useEffect(() => {
    if (!request) return;
    continueButtonRef.current?.focus();
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      request.cancel();
    };
    window.addEventListener('keydown', cancelOnEscape);
    return () => window.removeEventListener('keydown', cancelOnEscape);
  }, [busy, request]);

  if (!request) return null;
  const content = PERMISSION_CONTENT[request.kind];

  return (
    <div className="modal-backdrop native-media-permission-backdrop" role="presentation">
      <section
        className="native-media-permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-media-permission-title"
        aria-describedby="native-media-permission-description"
      >
        <div className="native-media-permission-icon">
          <PermissionIcon kind={request.kind} />
        </div>
        <div className="native-media-permission-copy">
          <span className="eyebrow">{content.eyebrow}</span>
          <h2 id="native-media-permission-title">{content.title}</h2>
          <p id="native-media-permission-description">{content.description}</p>
          <p className="native-media-permission-detail">{content.detail}</p>
        </div>
        <div className="native-media-permission-actions">
          <button
            className="button ghost"
            type="button"
            disabled={busy}
            onClick={() => request.cancel()}
          >
            Agora não
          </button>
          <button
            ref={continueButtonRef}
            className="button primary"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              request.approve();
            }}
          >
            {busy ? 'Aguardando o sistema…' : content.action}
          </button>
        </div>
      </section>
    </div>
  );
}

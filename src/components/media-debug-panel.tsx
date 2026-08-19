import type { CallConnectionState } from '../features/call/connection-supervisor';
import type { MediaStatsSnapshot } from '../features/voice/media-stats';

function metric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${Math.round(value)}${suffix}`;
}

export function MediaDebugPanel({
  callState,
  connectionEpoch,
  health,
  lastRecoveryReason,
  networkOnline,
  recoveryAttempts,
  socketState,
  stats,
}: {
  callState: CallConnectionState;
  connectionEpoch: number | null;
  health: {
    activePublications: string[];
    activeSubscriptions: number;
    camera: string;
    cameraSettings: MediaTrackSettings | null;
    connectionState: string;
    iceConnectionState: string;
    iceGatheringState: string;
    microphone: string;
    screen: string;
    sessionId: string;
    signalingState: string;
  };
  lastRecoveryReason: string;
  networkOnline: boolean;
  recoveryAttempts: number;
  socketState: string;
  stats: MediaStatsSnapshot | null;
}) {
  return (
    <details className="media-debug-panel">
      <summary>Diagnóstico WebRTC local</summary>
      <dl>
        <div>
          <dt>Call</dt>
          <dd>{callState}</dd>
        </div>
        <div>
          <dt>Socket</dt>
          <dd>{socketState}</dd>
        </div>
        <div>
          <dt>Peer / ICE</dt>
          <dd>
            {health.connectionState} / {health.iceConnectionState}
          </dd>
        </div>
        <div>
          <dt>Sinalização</dt>
          <dd>
            {health.signalingState} · ICE gathering {health.iceGatheringState}
          </dd>
        </div>
        <div>
          <dt>Sessão</dt>
          <dd>
            {health.sessionId} · epoch {connectionEpoch ?? '—'}
          </dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>
            {document.visibilityState} · {networkOnline ? 'online' : 'offline'}
          </dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>
            {recoveryAttempts} · {lastRecoveryReason || '—'}
          </dd>
        </div>
        <div>
          <dt>Publicações</dt>
          <dd>{health.activePublications.join(', ') || '—'}</dd>
        </div>
        <div>
          <dt>Subscriptions</dt>
          <dd>{health.activeSubscriptions}</dd>
        </div>
        <div>
          <dt>Tracks</dt>
          <dd>
            mic {health.microphone} · câmera {health.camera} · tela {health.screen}
          </dd>
        </div>
        <div>
          <dt>Câmera</dt>
          <dd>
            {health.cameraSettings?.facingMode ?? '—'} · {health.cameraSettings?.width ?? '—'}×
            {health.cameraSettings?.height ?? '—'}
          </dd>
        </div>
        <div>
          <dt>RTT</dt>
          <dd>{metric(stats?.roundTripTimeMs ?? null, ' ms')}</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{metric(stats?.jitterMs ?? null, ' ms')}</dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd>{metric(stats?.bitrateKbps ?? null, ' kbps')}</dd>
        </div>
        <div>
          <dt>Pacotes</dt>
          <dd>
            ↑ {stats?.packetsSent ?? 0} · ↓ {stats?.packetsReceived ?? 0} · perdidos{' '}
            {stats?.packetsLost ?? 0}
          </dd>
        </div>
        <div>
          <dt>Caminho</dt>
          <dd>{stats?.connectionPath ?? 'unknown'}</dd>
        </div>
      </dl>
    </details>
  );
}

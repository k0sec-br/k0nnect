import type { MediaStatsSnapshot } from '../features/voice/media-stats';

function metric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${Math.round(value)}${suffix}`;
}

export function MediaDebugPanel({ stats }: { stats: MediaStatsSnapshot }) {
  return (
    <details className="media-debug-panel">
      <summary>Diagnóstico WebRTC local</summary>
      <dl>
        <div>
          <dt>RTT</dt>
          <dd>{metric(stats.roundTripTimeMs, ' ms')}</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{metric(stats.jitterMs, ' ms')}</dd>
        </div>
        <div>
          <dt>Bitrate</dt>
          <dd>{metric(stats.bitrateKbps, ' kbps')}</dd>
        </div>
        <div>
          <dt>Pacotes perdidos</dt>
          <dd>{stats.packetsLost}</dd>
        </div>
        <div>
          <dt>Pacotes recebidos</dt>
          <dd>{stats.packetsReceived}</dd>
        </div>
        <div>
          <dt>Pacotes enviados</dt>
          <dd>{stats.packetsSent}</dd>
        </div>
        <div>
          <dt>FPS</dt>
          <dd>{metric(stats.framesPerSecond)}</dd>
        </div>
        <div>
          <dt>Frames descartados</dt>
          <dd>{stats.framesDropped}</dd>
        </div>
        <div>
          <dt>Caminho</dt>
          <dd>{stats.connectionPath}</dd>
        </div>
        <div>
          <dt>Codecs</dt>
          <dd>{stats.codecs.join(', ') || '—'}</dd>
        </div>
      </dl>
    </details>
  );
}

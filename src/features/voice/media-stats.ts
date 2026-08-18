export interface MediaStatsSnapshot {
  timestamp: number;
  roundTripTimeMs: number | null;
  jitterMs: number | null;
  packetsLost: number;
  packetsReceived: number;
  packetsSent: number;
  bytesReceived: number;
  bytesSent: number;
  bitrateKbps: number | null;
  framesPerSecond: number | null;
  framesDropped: number;
  codecs: string[];
  connectionPath: 'direct' | 'relay' | 'unknown';
}

interface StatsRecord {
  type?: string;
  id?: string;
  timestamp?: number;
  currentRoundTripTime?: number;
  jitter?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetsSent?: number;
  bytesReceived?: number;
  bytesSent?: number;
  framesPerSecond?: number;
  framesDropped?: number;
  mimeType?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
}

export class MediaStatsCollector {
  private timer: number | null = null;
  private previousBytes = 0;
  private previousTimestamp = 0;

  constructor(
    private readonly getStats: () => Promise<RTCStatsReport>,
    private readonly onSnapshot: (snapshot: MediaStatsSnapshot) => void,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    void this.collect();
    this.timer = window.setInterval(() => void this.collect(), 2_000);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.previousBytes = 0;
    this.previousTimestamp = 0;
  }

  private async collect(): Promise<void> {
    let report: RTCStatsReport;
    try {
      report = await this.getStats();
    } catch {
      return;
    }
    const records = new Map<string, StatsRecord>();
    report.forEach((value: unknown, key: string) => records.set(key, value as StatsRecord));

    let roundTripTimeMs: number | null = null;
    let jitterMs: number | null = null;
    let packetsLost = 0;
    let packetsReceived = 0;
    let packetsSent = 0;
    let bytesReceived = 0;
    let bytesSent = 0;
    let framesPerSecond: number | null = null;
    let framesDropped = 0;
    let connectionPath: MediaStatsSnapshot['connectionPath'] = 'unknown';
    const codecs = new Set<string>();

    for (const record of records.values()) {
      if (record.type === 'inbound-rtp') {
        jitterMs = Math.max(jitterMs ?? 0, (record.jitter ?? 0) * 1_000);
        packetsLost += record.packetsLost ?? 0;
        packetsReceived += record.packetsReceived ?? 0;
        bytesReceived += record.bytesReceived ?? 0;
        framesPerSecond = Math.max(framesPerSecond ?? 0, record.framesPerSecond ?? 0);
        framesDropped += record.framesDropped ?? 0;
      }
      if (record.type === 'outbound-rtp') {
        packetsSent += record.packetsSent ?? 0;
        bytesSent += record.bytesSent ?? 0;
        framesPerSecond = Math.max(framesPerSecond ?? 0, record.framesPerSecond ?? 0);
      }
      if (record.type === 'codec' && record.mimeType) codecs.add(record.mimeType);
      if (record.type === 'candidate-pair' && record.currentRoundTripTime !== undefined) {
        roundTripTimeMs = record.currentRoundTripTime * 1_000;
        const localCandidate = record.localCandidateId
          ? records.get(record.localCandidateId)
          : undefined;
        const remoteCandidate = record.remoteCandidateId
          ? records.get(record.remoteCandidateId)
          : undefined;
        connectionPath =
          localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay'
            ? 'relay'
            : 'direct';
      }
    }

    const timestamp = Date.now();
    const totalBytes = bytesReceived + bytesSent;
    const elapsedSeconds = (timestamp - this.previousTimestamp) / 1_000;
    const bitrateKbps =
      this.previousTimestamp > 0 && elapsedSeconds > 0
        ? ((totalBytes - this.previousBytes) * 8) / elapsedSeconds / 1_000
        : null;
    this.previousBytes = totalBytes;
    this.previousTimestamp = timestamp;
    this.onSnapshot({
      timestamp,
      roundTripTimeMs,
      jitterMs,
      packetsLost,
      packetsReceived,
      packetsSent,
      bytesReceived,
      bytesSent,
      bitrateKbps,
      framesPerSecond,
      framesDropped,
      codecs: [...codecs],
      connectionPath,
    });
  }
}

export type CallConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'suspended'
  | 'recovering'
  | 'disconnecting'
  | 'disconnected'
  | 'failed';

export type RecoveryReason =
  | 'initial-connect'
  | 'socket-disconnected'
  | 'peer-disconnected'
  | 'peer-failed'
  | 'ice-disconnected'
  | 'ice-failed'
  | 'network-online'
  | 'control-operation-pending'
  | 'visibility-restored'
  | 'page-resumed'
  | 'recovery-retry';

export interface ConnectionHealth {
  active: boolean;
  iceState: RTCIceConnectionState | 'unavailable';
  networkOnline: boolean;
  peerState: RTCPeerConnectionState | 'unavailable';
  socketState: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  visibility: DocumentVisibilityState;
  voiceConnected: boolean;
  voiceExpected: boolean;
}

export interface RecoveryContext {
  attempt: number;
  generation: number;
  reason: RecoveryReason;
}

interface SupervisorOptions {
  cancelTimer?(timer: number): void;
  gracePeriodMs?: number;
  onStateChange(state: CallConnectionState): void;
  random?(): number;
  recover(context: RecoveryContext): Promise<boolean>;
  scheduleTimer?(callback: () => void, delay: number): number;
}

const MAX_BACKOFF_MS = 30_000;

export function recoveryBackoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(250 * 2 ** Math.max(0, attempt), MAX_BACKOFF_MS);
  return base + Math.floor(random() * Math.min(1_000, base * 0.25));
}

export function deriveCallConnectionState(health: ConnectionHealth): CallConnectionState {
  if (!health.active) return 'idle';
  if (!health.networkOnline) return 'suspended';
  if (health.socketState !== 'connected') {
    return health.voiceConnected && health.peerState === 'connected' ? 'degraded' : 'reconnecting';
  }
  if (!health.voiceExpected) return 'connected';
  if (!health.voiceConnected) return 'connecting';
  if (health.peerState === 'failed' || health.iceState === 'failed') return 'reconnecting';
  if (health.peerState === 'disconnected' || health.iceState === 'disconnected') return 'degraded';
  return 'connected';
}

export class ConnectionSupervisor {
  private activeRecovery: Promise<void> | null = null;
  private attempt = 0;
  private generation = 0;
  private health: ConnectionHealth = {
    active: false,
    iceState: 'unavailable',
    networkOnline: true,
    peerState: 'unavailable',
    socketState: 'disconnected',
    visibility: 'visible',
    voiceConnected: false,
    voiceExpected: false,
  };
  private pendingReason: RecoveryReason | null = null;
  private timer: number | null = null;
  private userRequestedDisconnect = false;

  private readonly cancelTimer: (timer: number) => void;
  private readonly gracePeriodMs: number;
  private readonly onStateChange: (state: CallConnectionState) => void;
  private readonly random: () => number;
  private readonly recover: (context: RecoveryContext) => Promise<boolean>;
  private readonly scheduleTimer: (callback: () => void, delay: number) => number;

  constructor(options: SupervisorOptions) {
    this.cancelTimer = options.cancelTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.gracePeriodMs = options.gracePeriodMs ?? 1_500;
    this.onStateChange = options.onStateChange;
    this.random = options.random ?? Math.random;
    this.recover = options.recover;
    this.scheduleTimer =
      options.scheduleTimer ??
      ((callback, delay) => globalThis.setTimeout(callback, delay) as unknown as number);
  }

  updateHealth(next: Partial<ConnectionHealth>): void {
    this.health = { ...this.health, ...next };
    if (!this.health.active || this.userRequestedDisconnect) return;
    this.onStateChange(deriveCallConnectionState(this.health));
  }

  requestRecovery(reason: RecoveryReason, immediate = false): void {
    if (!this.health.active || this.userRequestedDisconnect) return;
    this.pendingReason = reason;
    if (this.activeRecovery || this.timer !== null) return;
    const transient = reason === 'peer-disconnected' || reason === 'ice-disconnected';
    this.scheduleRecovery(immediate ? 0 : transient ? this.gracePeriodMs : 250);
  }

  markHealthy(): void {
    this.attempt = 0;
    this.pendingReason = null;
    this.onStateChange(deriveCallConnectionState(this.health));
  }

  disconnect(): void {
    this.userRequestedDisconnect = true;
    this.generation += 1;
    this.activeRecovery = null;
    this.pendingReason = null;
    if (this.timer !== null) {
      this.cancelTimer(this.timer);
      this.timer = null;
    }
    this.onStateChange('disconnecting');
  }

  disconnected(): void {
    this.onStateChange('disconnected');
  }

  resume(): void {
    this.userRequestedDisconnect = false;
    this.generation += 1;
    this.attempt = 0;
    this.onStateChange(deriveCallConnectionState(this.health));
  }

  dispose(): void {
    this.disconnect();
  }

  private scheduleRecovery(delay: number): void {
    const generation = this.generation;
    this.timer = this.scheduleTimer(() => {
      this.timer = null;
      if (generation !== this.generation || this.userRequestedDisconnect) return;
      this.activeRecovery = this.runRecovery(generation);
    }, delay);
  }

  private async runRecovery(generation: number): Promise<void> {
    const reason = this.pendingReason ?? 'recovery-retry';
    const silentRecovery = reason === 'control-operation-pending';
    this.pendingReason = null;
    const currentState = deriveCallConnectionState(this.health);
    if (!silentRecovery && currentState !== 'connected') {
      this.onStateChange(this.attempt === 0 ? 'reconnecting' : 'recovering');
    }
    const healthy = await this.recover({ attempt: this.attempt, generation, reason }).catch(
      () => false,
    );
    this.activeRecovery = null;
    if (generation !== this.generation || this.userRequestedDisconnect) return;
    if (healthy) {
      const pendingReason = this.pendingReason;
      this.markHealthy();
      if (pendingReason) {
        this.pendingReason = pendingReason;
        this.scheduleRecovery(0);
      }
      return;
    }
    this.attempt += 1;
    if (!silentRecovery) {
      this.onStateChange(this.attempt >= 6 ? 'failed' : 'recovering');
    }
    this.pendingReason ??= reason;
    this.scheduleRecovery(recoveryBackoffMs(this.attempt, this.random));
  }
}

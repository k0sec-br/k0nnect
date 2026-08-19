import { describe, expect, it, vi } from 'vitest';

import {
  ConnectionSupervisor,
  deriveCallConnectionState,
  recoveryBackoffMs,
  type CallConnectionState,
} from '../../src/features/call/connection-supervisor';

describe('ConnectionSupervisor', () => {
  it('distingue control plane degradado de mídia desconectada', () => {
    expect(
      deriveCallConnectionState({
        active: true,
        iceState: 'connected',
        networkOnline: true,
        peerState: 'connected',
        socketState: 'disconnected',
        visibility: 'visible',
        voiceConnected: true,
        voiceExpected: true,
      }),
    ).toBe('degraded');
    expect(
      deriveCallConnectionState({
        active: true,
        iceState: 'failed',
        networkOnline: true,
        peerState: 'failed',
        socketState: 'connected',
        visibility: 'visible',
        voiceConnected: true,
        voiceExpected: true,
      }),
    ).toBe('reconnecting');
  });

  it('aplica backoff exponencial limitado com jitter', () => {
    expect(recoveryBackoffMs(0, () => 0)).toBe(250);
    expect(recoveryBackoffMs(1, () => 0)).toBe(500);
    expect(recoveryBackoffMs(4, () => 0)).toBe(4_000);
    expect(recoveryBackoffMs(20, () => 0)).toBe(30_000);
    expect(recoveryBackoffMs(1, () => 1)).toBe(625);
  });

  it('deduplica sinais e mantém um único recovery ativo', async () => {
    vi.useFakeTimers();
    const recover = vi.fn(() => Promise.resolve(true));
    const states: CallConnectionState[] = [];
    const supervisor = new ConnectionSupervisor({
      onStateChange: (state) => states.push(state),
      recover,
    });
    supervisor.updateHealth({ active: true });
    supervisor.requestRecovery('socket-disconnected');
    supervisor.requestRecovery('network-online', true);
    await vi.advanceTimersByTimeAsync(250);
    expect(recover).toHaveBeenCalledOnce();
    expect(states).toContain('reconnecting');
    vi.useRealTimers();
  });

  it('ignora recovery atrasado depois de disconnect explícito', async () => {
    vi.useFakeTimers();
    let finishRecovery: ((healthy: boolean) => void) | undefined;
    const recover = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRecovery = resolve;
        }),
    );
    const states: CallConnectionState[] = [];
    const supervisor = new ConnectionSupervisor({
      onStateChange: (state) => states.push(state),
      recover,
    });
    supervisor.updateHealth({ active: true });
    supervisor.requestRecovery('peer-failed', true);
    await vi.advanceTimersByTimeAsync(0);
    supervisor.disconnect();
    finishRecovery?.(true);
    await Promise.resolve();
    expect(states.at(-1)).toBe('disconnecting');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('permite uma nova geração depois de cancelar recovery em andamento', async () => {
    vi.useFakeTimers();
    let finishOldRecovery: ((healthy: boolean) => void) | undefined;
    const recover = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishOldRecovery = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    const supervisor = new ConnectionSupervisor({ onStateChange: () => undefined, recover });
    supervisor.updateHealth({ active: true });
    supervisor.requestRecovery('peer-failed', true);
    await vi.advanceTimersByTimeAsync(0);
    supervisor.disconnect();
    supervisor.resume();
    supervisor.requestRecovery('network-online', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(2);
    finishOldRecovery?.(true);
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('reconcilia imediatamente quando a visibilidade retorna', async () => {
    vi.useFakeTimers();
    const recover = vi.fn(() => Promise.resolve(true));
    const supervisor = new ConnectionSupervisor({ onStateChange: () => undefined, recover });
    supervisor.updateHealth({ active: true, visibility: 'visible' });
    supervisor.requestRecovery('visibility-restored', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'visibility-restored' }),
    );
    vi.useRealTimers();
  });

  it('mantém recovery de cleanup intencional fora do estado global de erro', async () => {
    vi.useFakeTimers();
    const states: CallConnectionState[] = [];
    const supervisor = new ConnectionSupervisor({
      onStateChange: (state) => states.push(state),
      recover: () => Promise.resolve(false),
      random: () => 0,
    });
    supervisor.updateHealth({
      active: true,
      iceState: 'connected',
      peerState: 'connected',
      socketState: 'connected',
      voiceConnected: true,
      voiceExpected: true,
    });
    supervisor.requestRecovery('control-operation-pending', true);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toBe('connected');
    supervisor.disconnect();
    vi.useRealTimers();
  });
});

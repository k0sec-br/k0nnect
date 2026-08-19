import { useEffect, useRef, useState } from 'react';

import type { useServerRealtime } from '../rooms/use-server-realtime';
import type { useVoiceSession } from '../voice/use-voice-session';
import {
  ConnectionSupervisor,
  type CallConnectionState,
  type ConnectionHealth,
  type RecoveryReason,
} from './connection-supervisor';

type RoomSocket = ReturnType<typeof useServerRealtime>;
type VoiceSession = ReturnType<typeof useVoiceSession>;

function socketHealthState(state: RoomSocket['connectionState']): ConnectionHealth['socketState'] {
  if (state === 'connected') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'reconnecting') return 'reconnecting';
  return 'disconnected';
}

function recoveryReason(
  status: VoiceSession['status'],
  snapshot: VoiceSession['connectionSnapshot'],
  reconciliationNeeded: boolean,
): RecoveryReason | null {
  if (reconciliationNeeded) return 'control-operation-pending';
  if (snapshot?.iceConnectionState === 'failed') return 'ice-failed';
  if (snapshot?.connectionState === 'failed') return 'peer-failed';
  if (snapshot?.iceConnectionState === 'disconnected') return 'ice-disconnected';
  if (snapshot?.connectionState === 'disconnected') return 'peer-disconnected';
  if (status === 'reconnecting') return 'peer-failed';
  return null;
}

export function useCallConnectionSupervisor({
  active,
  socket,
  voice,
}: {
  active: boolean;
  socket: RoomSocket;
  voice: VoiceSession;
}) {
  const socketRef = useRef(socket);
  const voiceRef = useRef(voice);
  socketRef.current = socket;
  voiceRef.current = voice;
  const [state, setState] = useState<CallConnectionState>('idle');
  const supervisorRef = useRef<ConnectionSupervisor | null>(null);
  supervisorRef.current ??= new ConnectionSupervisor({
    onStateChange: setState,
    recover: async ({ reason }) => {
      const currentSocket = socketRef.current;
      const socketHealthy = await currentSocket.reconcile();
      if (!socketHealthy) return false;
      const currentVoice = voiceRef.current;
      if (currentVoice.status === 'idle') return true;
      return currentVoice.reconcile(reason);
    },
  });
  const supervisor = supervisorRef.current;

  useEffect(() => {
    supervisor.updateHealth({
      active,
      iceState: voice.connectionSnapshot?.iceConnectionState ?? 'unavailable',
      networkOnline: navigator.onLine,
      peerState: voice.connectionSnapshot?.connectionState ?? 'unavailable',
      socketState: socketHealthState(socket.connectionState),
      visibility: document.visibilityState,
      voiceConnected: voice.status !== 'idle' && voice.status !== 'joining',
      voiceExpected: voice.status !== 'idle',
    });
    if (!active) return;
    if (socket.connectionState === 'disconnected') {
      supervisor.requestRecovery('socket-disconnected');
    }
    const mediaReason = recoveryReason(
      voice.status,
      voice.connectionSnapshot,
      voice.reconciliationNeeded,
    );
    if (mediaReason) supervisor.requestRecovery(mediaReason);
  }, [
    active,
    socket.connectionState,
    supervisor,
    voice.connectionSnapshot,
    voice.reconciliationNeeded,
    voice.status,
  ]);

  useEffect(() => {
    if (!active) return;
    supervisor.resume();
    const reconcileLifecycle = (reason: RecoveryReason) => {
      supervisor.updateHealth({
        networkOnline: navigator.onLine,
        visibility: document.visibilityState,
      });
      supervisor.requestRecovery(reason, true);
    };
    const handleVisibility = () => {
      supervisor.updateHealth({ visibility: document.visibilityState });
      if (document.visibilityState === 'visible') {
        reconcileLifecycle('visibility-restored');
      }
    };
    const handleOnline = () => reconcileLifecycle('network-online');
    const handleOffline = () => supervisor.updateHealth({ networkOnline: false });
    const handleResume = () => reconcileLifecycle('page-resumed');
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('resume', handleResume);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('resume', handleResume);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [active, supervisor]);

  useEffect(() => () => supervisor.dispose(), [supervisor]);

  return {
    disconnect: () => supervisor.disconnect(),
    disconnected: () => supervisor.disconnected(),
    resume: () => supervisor.resume(),
    state,
  };
}

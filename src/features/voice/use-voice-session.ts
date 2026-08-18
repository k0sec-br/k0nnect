import { useCallback, useEffect, useRef, useState } from 'react';

import type { RoomParticipant } from '../../../shared/protocol/room';
import { mediaErrorMessage } from './media-errors';
import { RealtimeAudioClient } from './realtime-audio-client';
import { startSpeakingDetector } from './speaking-detector';

export interface RemoteAudioStream {
  id: string;
  stream: MediaStream;
}

export function useVoiceSession({
  roomId,
  connectionId,
  participants,
  updatePresence,
  updateSpeaking,
}: {
  roomId: string;
  connectionId: string | null;
  participants: RoomParticipant[];
  updatePresence(muted: boolean, deafened: boolean): void;
  updateSpeaking(speaking: boolean): void;
}) {
  const clientRef = useRef<RealtimeAudioClient | null>(null);
  const detectorCleanupRef = useRef<(() => void) | null>(null);
  const activeConnectionIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const startClientRef = useRef<(connectionId: string, reconnecting?: boolean) => Promise<void>>(
    () => Promise.resolve(),
  );
  const selectedDeviceRef = useRef('');
  const [status, setStatus] = useState<'connected' | 'idle' | 'joining' | 'reconnecting'>('idle');
  const [error, setError] = useState('');
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [remoteStreams, setRemoteStreams] = useState<RemoteAudioStream[]>([]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const availableDevices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    );
    setDevices(availableDevices);
    setSelectedDevice((current) =>
      current.length > 0 ? current : (availableDevices[0]?.deviceId ?? ''),
    );
  }, []);

  useEffect(() => {
    void refreshDevices();
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshDevices]);

  const attachDetector = useCallback(
    (track: MediaStreamTrack) => {
      detectorCleanupRef.current?.();
      detectorCleanupRef.current = startSpeakingDetector(track, updateSpeaking);
    },
    [updateSpeaking],
  );

  const startClient = useCallback(
    async (targetConnectionId: string, reconnecting = false) => {
      setStatus(reconnecting ? 'reconnecting' : 'joining');
      setError('');
      const client = new RealtimeAudioClient(
        roomId,
        targetConnectionId,
        (track) => {
          const stream = new MediaStream([track]);
          setRemoteStreams((current) => [
            ...current.filter((item) => item.id !== track.id),
            { id: track.id, stream },
          ]);
          track.addEventListener(
            'ended',
            () => setRemoteStreams((current) => current.filter((item) => item.id !== track.id)),
            { once: true },
          );
        },
        (connectionState) => {
          if (connectionState === 'connected') {
            reconnectAttemptRef.current = 0;
            setStatus('connected');
            setError('');
          }
          if (connectionState === 'failed') {
            setStatus('reconnecting');
            setError('Sua conexão de voz foi interrompida. Estamos tentando reconectar.');
            reconnectAttemptRef.current += 1;
            if (reconnectAttemptRef.current > 5 || reconnectTimerRef.current !== null) return;
            const delay = Math.min(1_000 * 2 ** (reconnectAttemptRef.current - 1), 15_000);
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              const failedClient = clientRef.current;
              clientRef.current = null;
              detectorCleanupRef.current?.();
              detectorCleanupRef.current = null;
              void failedClient?.stop().finally(() => {
                if (activeConnectionIdRef.current === targetConnectionId) {
                  void startClientRef.current(targetConnectionId, true);
                }
              });
            }, delay);
          }
        },
      );
      clientRef.current = client;
      activeConnectionIdRef.current = targetConnectionId;
      try {
        const track = await client.start(
          selectedDeviceRef.current.length > 0 ? selectedDeviceRef.current : undefined,
        );
        client.setMuted(muted);
        attachDetector(track);
        await refreshDevices();
        reconnectAttemptRef.current = 0;
        setStatus('connected');
      } catch (caught) {
        await client.stop();
        if (clientRef.current === client) clientRef.current = null;
        setStatus('idle');
        setError(mediaErrorMessage(caught));
      }
    },
    [attachDetector, muted, refreshDevices, roomId],
  );
  useEffect(() => {
    startClientRef.current = startClient;
  }, [startClient]);

  const join = useCallback(async () => {
    if (!connectionId || status !== 'idle') return;
    await startClient(connectionId);
  }, [connectionId, startClient, status]);

  const leave = useCallback(async () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    detectorCleanupRef.current?.();
    detectorCleanupRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    activeConnectionIdRef.current = null;
    setRemoteStreams([]);
    setStatus('idle');
    setMutedState(false);
    setDeafenedState(false);
    updatePresence(false, false);
    if (client) await client.stop();
  }, [updatePresence]);

  useEffect(() => {
    if (
      connectionId &&
      activeConnectionIdRef.current &&
      connectionId !== activeConnectionIdRef.current &&
      clientRef.current
    ) {
      const previousClient = clientRef.current;
      detectorCleanupRef.current?.();
      detectorCleanupRef.current = null;
      clientRef.current = null;
      void previousClient.stop().then(() => startClient(connectionId, true));
    }
  }, [connectionId, startClient]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || status !== 'connected') return;
    for (const participant of participants) {
      if (participant.realtimeSessionId && participant.audioTrackName) {
        void client
          .subscribe(participant.realtimeSessionId, participant.audioTrackName)
          .catch((caught) => {
            setError(mediaErrorMessage(caught));
          });
      }
    }
  }, [participants, status]);

  useEffect(
    () => () => {
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      detectorCleanupRef.current?.();
      if (clientRef.current) void clientRef.current.stop();
    },
    [],
  );

  const toggleMuted = useCallback(() => {
    const nextMuted = !muted;
    setMutedState(nextMuted);
    clientRef.current?.setMuted(nextMuted);
    updatePresence(nextMuted, deafened);
  }, [deafened, muted, updatePresence]);

  const toggleDeafened = useCallback(() => {
    const nextDeafened = !deafened;
    const nextMuted = nextDeafened ? true : muted;
    setDeafenedState(nextDeafened);
    setMutedState(nextMuted);
    clientRef.current?.setMuted(nextMuted);
    updatePresence(nextMuted, nextDeafened);
  }, [deafened, muted, updatePresence]);

  const changeMicrophone = useCallback(
    async (deviceId: string) => {
      selectedDeviceRef.current = deviceId;
      setSelectedDevice(deviceId);
      if (!clientRef.current) return;
      try {
        const track = await clientRef.current.changeMicrophone(deviceId);
        attachDetector(track);
      } catch (caught) {
        setError(mediaErrorMessage(caught));
      }
    },
    [attachDetector],
  );

  return {
    changeMicrophone,
    deafened,
    devices,
    error,
    join,
    leave,
    muted,
    remoteStreams,
    selectedDevice,
    status,
    toggleDeafened,
    toggleMuted,
  };
}

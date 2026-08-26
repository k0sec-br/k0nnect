import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaEndReason, MediaPublication } from '../../../shared/protocol/room';
import { CallConflictError } from '../rooms/use-server-realtime';
import { mediaDevicePreferences } from './media-device-preferences';
import { CameraManager, ScreenShareManager } from './media-capture-managers';
import { mediaErrorMessage } from './media-errors';
import { MediaStatsCollector, type MediaStatsSnapshot } from './media-stats';
import {
  MediaSessionManager,
  type MediaConnectionSnapshot,
  type RemoteMediaTrack,
} from './media-session-manager';
import { startSpeakingDetector } from './speaking-detector';
import {
  effectiveMuted,
  INITIAL_VOICE_CONTROL_STATE,
  reduceVoiceControlState,
  type VoiceControlAction,
} from './voice-control-state';

export type TrackLifecycleState =
  | 'idle'
  | 'requesting-permission'
  | 'starting'
  | 'publishing'
  | 'active'
  | 'switching'
  | 'stopping'
  | 'error';

export interface MediaStreamView {
  publication: MediaPublication;
  stream: MediaStream;
}

const SUBSCRIPTION_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

export function subscriptionRetryDelayMs(attempt: number): number {
  return SUBSCRIPTION_RETRY_DELAYS_MS[
    Math.min(attempt, SUBSCRIPTION_RETRY_DELAYS_MS.length - 1)
  ]!;
}

export function isExpectedMediaEnd(reason: MediaEndReason): boolean {
  return [
    'user_stop',
    'track_ended',
    'publisher_left',
    'publication_replaced',
    'session_rebuilt',
  ].includes(reason);
}

export function useVoiceSession({
  roomId,
  connectionId,
  publications,
  joinCall,
  leaveCall,
  updatePresence,
  updateSpeaking,
}: {
  roomId: string;
  connectionId: string | null;
  publications: MediaPublication[];
  joinCall(channelId: string, takeover?: boolean): Promise<void>;
  leaveCall(): Promise<void>;
  updatePresence(muted: boolean, deafened: boolean): void;
  updateSpeaking(speaking: boolean): void;
}) {
  const clientRef = useRef<MediaSessionManager | null>(null);
  const detectorCleanupRef = useRef<(() => void) | null>(null);
  const activeConnectionIdRef = useRef<string | null>(null);
  const startClientRef = useRef<
    (
      target: string,
      recovering?: boolean,
      existingMicrophone?: MediaStreamTrack,
      targetRoomId?: string,
    ) => Promise<boolean>
  >(() => Promise.resolve(false));
  const selectedMicrophoneRef = useRef(mediaDevicePreferences.microphone());
  const selectedCameraRef = useRef(mediaDevicePreferences.camera());
  const subscribedPublicationIdsRef = useRef(new Set<string>());
  const screenStoppingRef = useRef(false);
  const cameraBusyRef = useRef(false);
  const screenBusyRef = useRef(false);
  const cameraGenerationRef = useRef(0);
  const screenGenerationRef = useRef(0);
  const cameraManagerRef = useRef<CameraManager | null>(null);
  const screenShareManagerRef = useRef<ScreenShareManager | null>(null);
  const statsCollectorRef = useRef<MediaStatsCollector | null>(null);
  const voiceControlsRef = useRef(INITIAL_VOICE_CONTROL_STATE);
  const microphoneTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraWantedRef = useRef(false);
  const screenWantedRef = useRef(false);
  const userRequestedDisconnectRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const recoveryOperationRef = useRef<Promise<boolean> | null>(null);
  const pendingPublicationClosuresRef = useRef(new Map<string, MediaEndReason>());
  const sessionGenerationRef = useRef(0);
  const statusRef = useRef<'connected' | 'idle' | 'joining' | 'reconnecting' | 'recovering'>('idle');
  const subscriptionRetryAttemptRef = useRef(0);
  const subscriptionRetryTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState<
    'connected' | 'idle' | 'joining' | 'reconnecting' | 'recovering'
  >('idle');
  const [error, setError] = useState('');
  const [voiceControls, setVoiceControls] = useState(INITIAL_VOICE_CONTROL_STATE);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState(selectedMicrophoneRef.current);
  const [selectedCamera, setSelectedCamera] = useState(selectedCameraRef.current);
  const [remoteMedia, setRemoteMedia] = useState<MediaStreamView[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaStreamView[]>([]);
  const [cameraState, setCameraState] = useState<TrackLifecycleState>('idle');
  const [screenState, setScreenState] = useState<TrackLifecycleState>('idle');
  const [debugStats, setDebugStats] = useState<MediaStatsSnapshot | null>(null);
  const [connectionSnapshot, setConnectionSnapshot] = useState<MediaConnectionSnapshot | null>(
    null,
  );
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [lastRecoveryReason, setLastRecoveryReason] = useState('');
  const [reconciliationNeeded, setReconciliationNeeded] = useState(false);
  const [callConflictChannelId, setCallConflictChannelId] = useState<string | null>(null);
  const [subscriptionRetryVersion, setSubscriptionRetryVersion] = useState(0);
  statusRef.current = status;

  const clearSubscriptionRetry = useCallback(() => {
    if (subscriptionRetryTimerRef.current !== null) {
      window.clearTimeout(subscriptionRetryTimerRef.current);
      subscriptionRetryTimerRef.current = null;
    }
    subscriptionRetryAttemptRef.current = 0;
  }, []);

  const scheduleSubscriptionRetry = useCallback(() => {
    if (subscriptionRetryTimerRef.current !== null) return;
    const delay = subscriptionRetryDelayMs(subscriptionRetryAttemptRef.current);
    subscriptionRetryAttemptRef.current += 1;
    subscriptionRetryTimerRef.current = window.setTimeout(() => {
      subscriptionRetryTimerRef.current = null;
      setSubscriptionRetryVersion((version) => version + 1);
    }, delay);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const availableMicrophones = devices.filter((device) => device.kind === 'audioinput');
    const availableCameras = devices.filter((device) => device.kind === 'videoinput');
    setMicrophones(availableMicrophones);
    setCameras(availableCameras);
    setSelectedMicrophone((current) => {
      const next = availableMicrophones.some((device) => device.deviceId === current)
        ? current
        : (availableMicrophones[0]?.deviceId ?? '');
      selectedMicrophoneRef.current = next;
      return next;
    });
    setSelectedCamera((current) => {
      const next = availableCameras.some((device) => device.deviceId === current)
        ? current
        : (availableCameras[0]?.deviceId ?? '');
      selectedCameraRef.current = next;
      return next;
    });
    const activeCameraDeviceId = cameraManagerRef.current?.currentTrack()?.getSettings().deviceId;
    if (
      activeCameraDeviceId &&
      !availableCameras.some((device) => device.deviceId === activeCameraDeviceId)
    ) {
      cameraManagerRef.current?.stop();
      setCameraState('idle');
      setLocalMedia((current) => current.filter((item) => item.publication.source !== 'camera'));
      setError('Sua câmera foi desconectada. O áudio continua conectado.');
      void clientRef.current?.closePublication('camera', 'device_removed').catch(() => undefined);
    }
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

  const removeRemoteMedia = useCallback((publicationId: string) => {
    subscribedPublicationIdsRef.current.delete(publicationId);
    setRemoteMedia((current) =>
      current.filter((media) => media.publication.publicationId !== publicationId),
    );
  }, []);

  const startClient = useCallback(
    async (
      targetConnectionId: string,
      recovering = false,
      existingMicrophone?: MediaStreamTrack,
      targetRoomId = roomId,
    ): Promise<boolean> => {
      const generation = sessionGenerationRef.current;
      setStatus(recovering ? 'recovering' : 'joining');
      setError('');
      const client = new MediaSessionManager(
        targetRoomId,
        targetConnectionId,
        (media: RemoteMediaTrack) => {
          setRemoteMedia((current) => [
            ...current.filter(
              (item) => item.publication.publicationId !== media.publication.publicationId,
            ),
            { publication: media.publication, stream: media.stream },
          ]);
        },
        removeRemoteMedia,
        (snapshot) => {
          if (clientRef.current !== client || generation !== sessionGenerationRef.current) return;
          setConnectionSnapshot(snapshot);
          if (snapshot.connectionState === 'connected') {
            setStatus('connected');
            setError('');
          }
          if (snapshot.connectionState === 'failed' || snapshot.iceConnectionState === 'failed') {
            setStatus('reconnecting');
          }
        },
      );
      clientRef.current = client;
      activeConnectionIdRef.current = targetConnectionId;
      try {
        const track = await client.start(
          selectedMicrophoneRef.current || undefined,
          existingMicrophone,
        );
        if (generation !== sessionGenerationRef.current || userRequestedDisconnectRef.current) {
          await client.detachForRecovery();
          return false;
        }
        client.setMuted(effectiveMuted(voiceControlsRef.current));
        microphoneTrackRef.current = track;
        attachDetector(track);
        await refreshDevices();
        setStatus('connected');
        if (import.meta.env.DEV) {
          statsCollectorRef.current?.stop();
          statsCollectorRef.current = new MediaStatsCollector(
            () => client.getStats(),
            setDebugStats,
          );
          statsCollectorRef.current.start();
        }
        return true;
      } catch (caught) {
        await client.stop();
        if (clientRef.current === client) clientRef.current = null;
        setStatus(recovering ? 'reconnecting' : 'idle');
        if (!recovering) setError(mediaErrorMessage(caught));
        return false;
      }
    },
    [attachDetector, refreshDevices, removeRemoteMedia, roomId],
  );

  useEffect(() => {
    startClientRef.current = startClient;
  }, [startClient]);

  const join = useCallback(
    async (takeover = false, targetRoomId = roomId) => {
      if (!connectionId || statusRef.current !== 'idle' || joinInFlightRef.current) return;
      joinInFlightRef.current = true;
      userRequestedDisconnectRef.current = false;
      sessionGenerationRef.current += 1;
      statusRef.current = 'joining';
      setStatus('joining');
      setError('');
      setCallConflictChannelId(null);
      try {
        await joinCall(targetRoomId, takeover);
        const started = await startClient(connectionId, false, undefined, targetRoomId);
        if (!started) {
          joinInFlightRef.current = false;
          await leaveCall().catch(() => undefined);
        }
      } catch (caught) {
        joinInFlightRef.current = false;
        statusRef.current = 'idle';
        setStatus('idle');
        if (caught instanceof CallConflictError) {
          setCallConflictChannelId(caught.channelId);
          setError('');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Não foi possível entrar na chamada.');
      }
    },
    [connectionId, joinCall, leaveCall, roomId, startClient],
  );

  const leave = useCallback(async () => {
    userRequestedDisconnectRef.current = true;
    joinInFlightRef.current = false;
    sessionGenerationRef.current += 1;
    recoveryOperationRef.current = null;
    statsCollectorRef.current?.stop();
    statsCollectorRef.current = null;
    setDebugStats(null);
    setConnectionSnapshot(null);
    setRecoveryAttempts(0);
    setLastRecoveryReason('');
    setReconciliationNeeded(false);
    setCallConflictChannelId(null);
    setError('');
    detectorCleanupRef.current?.();
    detectorCleanupRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    activeConnectionIdRef.current = null;
    microphoneTrackRef.current = null;
    subscribedPublicationIdsRef.current.clear();
    clearSubscriptionRetry();
    setRemoteMedia([]);
    setLocalMedia([]);
    setCameraState('idle');
    setScreenState('idle');
    cameraManagerRef.current?.stop();
    screenShareManagerRef.current?.stop();
    cameraWantedRef.current = false;
    screenWantedRef.current = false;
    pendingPublicationClosuresRef.current.clear();
    statusRef.current = 'idle';
    setStatus('idle');
    voiceControlsRef.current = INITIAL_VOICE_CONTROL_STATE;
    setVoiceControls(INITIAL_VOICE_CONTROL_STATE);
    await Promise.all([client?.stop(), leaveCall().catch(() => undefined)]);
  }, [clearSubscriptionRetry, leaveCall]);

  const switchCall = useCallback(
    async (targetRoomId: string) => {
      if (statusRef.current !== 'idle') await leave();
      await join(false, targetRoomId);
    },
    [join, leave],
  );

  useEffect(() => {
    if (!connectionId && clientRef.current) void leave();
  }, [connectionId, leave]);

  useEffect(() => {
    if (
      connectionId &&
      activeConnectionIdRef.current &&
      connectionId !== activeConnectionIdRef.current &&
      clientRef.current
    ) {
      setStatus('reconnecting');
    }
  }, [connectionId]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || status !== 'connected') return;
    const availableIds = new Set(publications.map((publication) => publication.publicationId));
    for (const publicationId of subscribedPublicationIdsRef.current) {
      if (!availableIds.has(publicationId)) {
        removeRemoteMedia(publicationId);
        void client.unsubscribe(publicationId).catch(() => undefined);
      }
    }
    const sourcePriority = { microphone: 0, 'screen-audio': 1, 'screen-video': 2, camera: 3 };
    const pending = publications
      .filter((publication) => !subscribedPublicationIdsRef.current.has(publication.publicationId))
      .sort((left, right) => sourcePriority[left.source] - sourcePriority[right.source]);
    if (pending.length > 0 && subscriptionRetryTimerRef.current !== null) return;
    for (const publication of pending) {
      subscribedPublicationIdsRef.current.add(publication.publicationId);
    }
    if (pending.length > 0) {
      void client
        .subscribeMany(pending)
        .then(() => clearSubscriptionRetry())
        .catch((caught) => {
          for (const publication of pending) {
            subscribedPublicationIdsRef.current.delete(publication.publicationId);
          }
          setError(mediaErrorMessage(caught));
          scheduleSubscriptionRetry();
        });
    } else {
      clearSubscriptionRetry();
    }
  }, [
    clearSubscriptionRetry,
    publications,
    removeRemoteMedia,
    scheduleSubscriptionRetry,
    status,
    subscriptionRetryVersion,
  ]);

  useEffect(
    () => () => {
      userRequestedDisconnectRef.current = true;
      sessionGenerationRef.current += 1;
      detectorCleanupRef.current?.();
      statsCollectorRef.current?.stop();
      if (subscriptionRetryTimerRef.current !== null) {
        window.clearTimeout(subscriptionRetryTimerRef.current);
      }
      if (clientRef.current) void clientRef.current.stop();
    },
    [],
  );

  const applyVoiceControl = useCallback(
    (action: VoiceControlAction) => {
      const next = reduceVoiceControlState(voiceControlsRef.current, action);
      voiceControlsRef.current = next;
      setVoiceControls(next);
      const nextEffectiveMuted = effectiveMuted(next);
      clientRef.current?.setMuted(nextEffectiveMuted);
      updatePresence(nextEffectiveMuted, next.deafened);
    },
    [updatePresence],
  );

  const toggleMuted = useCallback(
    () => applyVoiceControl({ type: 'toggle-user-muted' }),
    [applyVoiceControl],
  );

  const toggleDeafened = useCallback(
    () => applyVoiceControl({ type: 'toggle-deafened' }),
    [applyVoiceControl],
  );

  const changeMicrophone = useCallback(
    async (deviceId: string) => {
      const client = clientRef.current;
      if (!client) {
        selectedMicrophoneRef.current = deviceId;
        setSelectedMicrophone(deviceId);
        mediaDevicePreferences.setMicrophone(deviceId);
        return;
      }
      try {
        const track = await client.changeMicrophone(deviceId);
        microphoneTrackRef.current = track;
        client.setMuted(effectiveMuted(voiceControlsRef.current));
        attachDetector(track);
        selectedMicrophoneRef.current = deviceId;
        setSelectedMicrophone(deviceId);
        mediaDevicePreferences.setMicrophone(deviceId);
        setError('');
      } catch {
        setError('Não foi possível usar este microfone. O dispositivo anterior continua ativo.');
      }
    },
    [attachDetector],
  );

  const startCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client || status !== 'connected' || cameraState !== 'idle' || cameraBusyRef.current)
      return;
    cameraBusyRef.current = true;
    cameraWantedRef.current = true;
    const generation = cameraGenerationRef.current;
    const sessionGeneration = sessionGenerationRef.current;
    setCameraState('requesting-permission');
    setError('');
    let track: MediaStreamTrack | undefined;
    try {
      cameraManagerRef.current ??= new CameraManager();
      const cameraStream = await cameraManagerRef.current.start(
        selectedCameraRef.current || undefined,
      );
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (generation !== cameraGenerationRef.current) {
        cameraManagerRef.current.stop();
        return;
      }
      track = cameraStream.getVideoTracks()[0];
      if (!track) throw new DOMException('Câmera indisponível', 'NotFoundError');
      track.contentHint = 'motion';
      setCameraState('publishing');
      const publication = await client.publishTrack(track, cameraStream, 'camera');
      if (sessionGeneration !== sessionGenerationRef.current) return;
      if (generation !== cameraGenerationRef.current || track.readyState === 'ended') {
        await client.closePublication('camera', 'error').catch(() => undefined);
        cameraManagerRef.current.stop();
        setCameraState('idle');
        return;
      }
      setLocalMedia((current) => [
        ...current.filter((item) => item.publication.source !== 'camera'),
        { publication, stream: new MediaStream([track!]) },
      ]);
      setCameraState('active');
      await refreshDevices();
    } catch (caught) {
      if (sessionGeneration !== sessionGenerationRef.current) return;
      cameraWantedRef.current = false;
      cameraManagerRef.current?.stop();
      setCameraState('error');
      setError(mediaErrorMessage(caught, 'câmera'));
      setCameraState('idle');
    } finally {
      cameraBusyRef.current = false;
    }
  }, [cameraState, refreshDevices, status]);

  const stopCamera = useCallback(async () => {
    if (cameraState === 'idle' || cameraState === 'stopping') return;
    cameraGenerationRef.current += 1;
    cameraWantedRef.current = false;
    const client = clientRef.current;
    const publicationId = client?.localPublication('camera')?.publicationId;
    cameraManagerRef.current?.stop();
    setLocalMedia((current) => current.filter((item) => item.publication.source !== 'camera'));
    setCameraState('stopping');
    if (!client) {
      setCameraState('idle');
      return;
    }
    try {
      await client.closePublication('camera', 'user_stop');
      if (publicationId) pendingPublicationClosuresRef.current.delete(publicationId);
      setReconciliationNeeded(pendingPublicationClosuresRef.current.size > 0);
      setCameraState('idle');
    } catch {
      if (publicationId) {
        pendingPublicationClosuresRef.current.set(publicationId, 'user_stop');
        setReconciliationNeeded(true);
      }
      setCameraState('idle');
    }
  }, [cameraState]);

  const changeCamera = useCallback(
    async (deviceId: string) => {
      const client = clientRef.current;
      if (!client || cameraState !== 'active') {
        selectedCameraRef.current = deviceId;
        setSelectedCamera(deviceId);
        mediaDevicePreferences.setCamera(deviceId);
        return;
      }
      if (cameraBusyRef.current) return;
      cameraBusyRef.current = true;
      const operation = cameraGenerationRef.current + 1;
      cameraGenerationRef.current = operation;
      const sessionGeneration = sessionGenerationRef.current;
      const currentFacingMode = cameraManagerRef.current?.currentTrack()?.getSettings().facingMode;
      const preferredFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      setCameraState('switching');
      try {
        cameraManagerRef.current ??= new CameraManager();
        const stream = await cameraManagerRef.current.replace(
          deviceId,
          (replacement) => client.replaceLocalTrack('camera', replacement),
          preferredFacingMode,
        );
        const replacement = stream.getVideoTracks()[0];
        if (!replacement) throw new DOMException('Câmera indisponível', 'NotFoundError');
        if (sessionGeneration !== sessionGenerationRef.current) return;
        if (operation !== cameraGenerationRef.current || userRequestedDisconnectRef.current) {
          replacement.stop();
          return;
        }
        setLocalMedia((current) =>
          current.map((item) =>
            item.publication.source === 'camera'
              ? { ...item, stream: new MediaStream([replacement]) }
              : item,
          ),
        );
        const activeDeviceId = replacement.getSettings().deviceId ?? deviceId;
        selectedCameraRef.current = activeDeviceId;
        setSelectedCamera(activeDeviceId);
        mediaDevicePreferences.setCamera(activeDeviceId);
        setError('');
        setCameraState('active');
      } catch {
        if (
          sessionGeneration !== sessionGenerationRef.current ||
          userRequestedDisconnectRef.current
        ) {
          return;
        }
        setError('Não foi possível usar esta câmera. O dispositivo anterior continua ativo.');
        setCameraState(cameraManagerRef.current?.currentTrack() ? 'active' : 'idle');
      } finally {
        cameraBusyRef.current = false;
      }
    },
    [cameraState],
  );

  const switchCamera = useCallback(async () => {
    if (cameras.length < 2) return;
    const currentDeviceId =
      cameraManagerRef.current?.currentTrack()?.getSettings().deviceId ?? selectedCameraRef.current;
    const currentIndex = cameras.findIndex((device) => device.deviceId === currentDeviceId);
    const nextCamera = cameras[(currentIndex + 1 + cameras.length) % cameras.length];
    if (nextCamera) await changeCamera(nextCamera.deviceId);
  }, [cameras, changeCamera]);

  const stopScreenShare = useCallback(async (reason: MediaEndReason = 'user_stop') => {
    if (screenStoppingRef.current) return;
    screenStoppingRef.current = true;
    screenGenerationRef.current += 1;
    screenWantedRef.current = false;
    const client = clientRef.current;
    const publicationId = client?.localPublication('screen-video')?.publicationId;
    setLocalMedia((current) =>
      current.filter(
        (item) =>
          item.publication.source !== 'screen-video' && item.publication.source !== 'screen-audio',
      ),
    );
    screenShareManagerRef.current?.stop();
    setScreenState('stopping');
    if (!client) {
      setScreenState('idle');
      screenStoppingRef.current = false;
      return;
    }
    try {
      await client.closePublication('screen-video', reason);
      if (publicationId) pendingPublicationClosuresRef.current.delete(publicationId);
      setReconciliationNeeded(pendingPublicationClosuresRef.current.size > 0);
    } catch {
      if (publicationId) {
        pendingPublicationClosuresRef.current.set(publicationId, reason);
        setReconciliationNeeded(true);
      }
      if (!isExpectedMediaEnd(reason)) {
        setError('O compartilhamento de tela foi interrompido.');
      }
    } finally {
      setScreenState('idle');
      screenStoppingRef.current = false;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    const client = clientRef.current;
    if (!client || status !== 'connected' || screenState !== 'idle' || screenBusyRef.current)
      return;
    screenBusyRef.current = true;
    screenWantedRef.current = true;
    const generation = screenGenerationRef.current;
    const sessionGeneration = sessionGenerationRef.current;
    setScreenState('requesting-permission');
    setError('');
    let stream: MediaStream | undefined;
    try {
      screenShareManagerRef.current ??= new ScreenShareManager();
      stream = await screenShareManagerRef.current.start();
      if (
        generation !== screenGenerationRef.current ||
        sessionGeneration !== sessionGenerationRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new DOMException('Tela indisponível', 'NotFoundError');
      videoTrack.contentHint = 'detail';
      setScreenState('publishing');
      const audioTrack = stream.getAudioTracks()[0];
      const published = await client.publishTracks([
        { track: videoTrack, stream, source: 'screen-video' },
        ...(audioTrack ? [{ track: audioTrack, stream, source: 'screen-audio' as const }] : []),
      ]);
      const videoPublication = published.find(
        (publication) => publication.source === 'screen-video',
      );
      if (!videoPublication) throw new DOMException('Tela indisponível', 'InvalidStateError');
      if (
        generation !== screenGenerationRef.current ||
        sessionGeneration !== sessionGenerationRef.current ||
        videoTrack.readyState === 'ended'
      ) {
        screenWantedRef.current = false;
        await client.closePublication('screen-video', 'error').catch(() => undefined);
        setScreenState('idle');
        return;
      }
      setLocalMedia((current) => [
        ...current,
        { publication: videoPublication, stream: new MediaStream([videoTrack]) },
      ]);
      videoTrack.addEventListener('ended', () => void stopScreenShare('track_ended'), {
        once: true,
      });
      if (
        audioTrack &&
        generation === screenGenerationRef.current &&
        sessionGeneration === sessionGenerationRef.current
      ) {
        const audioPublication = published.find(
          (publication) => publication.source === 'screen-audio',
        );
        if (!audioPublication) {
          throw new DOMException('Áudio da tela indisponível', 'InvalidStateError');
        }
        if (
          generation !== screenGenerationRef.current ||
          sessionGeneration !== sessionGenerationRef.current
        ) {
          await client.closePublication('screen-audio', 'error').catch(() => undefined);
          return;
        }
        setLocalMedia((current) => [
          ...current,
          { publication: audioPublication, stream: new MediaStream([audioTrack]) },
        ]);
      }
      setScreenState('active');
    } catch (caught) {
      if (sessionGeneration !== sessionGenerationRef.current) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      screenWantedRef.current = false;
      stream?.getTracks().forEach((track) => track.stop());
      screenShareManagerRef.current?.stop();
      await client.closePublication('screen-video', 'error').catch(() => undefined);
      setLocalMedia((current) =>
        current.filter(
          (item) =>
            item.publication.source !== 'screen-video' &&
            item.publication.source !== 'screen-audio',
        ),
      );
      setScreenState('error');
      setError(mediaErrorMessage(caught, 'compartilhamento'));
      setScreenState('idle');
    } finally {
      screenBusyRef.current = false;
    }
  }, [screenState, status, stopScreenShare]);

  const reconcile = useCallback(
    async (reason: string): Promise<boolean> => {
      if (userRequestedDisconnectRef.current || status === 'idle') return true;
      if (recoveryOperationRef.current) return recoveryOperationRef.current;

      const operation = (async () => {
        const currentClient = clientRef.current;
        const currentMicrophone = microphoneTrackRef.current;
        const connectionMatches = activeConnectionIdRef.current === connectionId;
        const snapshot = (() => {
          try {
            return currentClient?.connectionSnapshot() ?? null;
          } catch {
            return null;
          }
        })();
        const peerHealthy =
          snapshot?.connectionState === 'connected' &&
          (snapshot.iceConnectionState === 'connected' ||
            snapshot.iceConnectionState === 'completed');
        const microphoneHealthy =
          currentMicrophone !== null && currentMicrophone.readyState !== 'ended';
        const cameraTrack = cameraManagerRef.current?.currentStream()?.getVideoTracks()[0];
        const cameraHealthy =
          !cameraWantedRef.current ||
          (cameraTrack !== undefined && cameraTrack.readyState !== 'ended');
        const screenTrack = screenShareManagerRef.current?.currentStream()?.getVideoTracks()[0];
        const screenHealthy =
          !screenWantedRef.current ||
          (screenTrack !== undefined && screenTrack.readyState !== 'ended');
        const pendingClosures = [...pendingPublicationClosuresRef.current];
        if (currentClient && connectionMatches && pendingClosures.length > 0) {
          try {
            for (const [publicationId, endReason] of pendingClosures) {
              await currentClient.retryClosePublication(publicationId, endReason);
              pendingPublicationClosuresRef.current.delete(publicationId);
            }
            setReconciliationNeeded(false);
          } catch {
            return false;
          }
        }
        if (
          currentClient &&
          connectionMatches &&
          peerHealthy &&
          microphoneHealthy &&
          cameraHealthy &&
          screenHealthy
        ) {
          try {
            if (!currentClient.localTrack('microphone') && currentMicrophone) {
              await currentClient.publishTrack(
                currentMicrophone,
                new MediaStream([currentMicrophone]),
                'microphone',
                false,
              );
            }
            if (cameraWantedRef.current && cameraTrack && !currentClient.localTrack('camera')) {
              const publication = await currentClient.publishTrack(
                cameraTrack,
                new MediaStream([cameraTrack]),
                'camera',
                false,
              );
              setLocalMedia((current) => [
                ...current.filter((item) => item.publication.source !== 'camera'),
                { publication, stream: new MediaStream([cameraTrack]) },
              ]);
            }
            if (
              screenWantedRef.current &&
              screenTrack &&
              !currentClient.localTrack('screen-video')
            ) {
              const screenStream = screenShareManagerRef.current?.currentStream();
              if (!screenStream) throw new DOMException('Tela indisponível', 'NotFoundError');
              const screenAudioTrack = screenStream.getAudioTracks()[0];
              const missingScreenTracks = [
                { track: screenTrack, stream: screenStream, source: 'screen-video' as const },
                ...(screenAudioTrack &&
                screenAudioTrack.readyState !== 'ended' &&
                !currentClient.localTrack('screen-audio')
                  ? [
                      {
                        track: screenAudioTrack,
                        stream: screenStream,
                        source: 'screen-audio' as const,
                      },
                    ]
                  : []),
              ];
              const screenPublications = await currentClient.publishTracks(
                missingScreenTracks,
                false,
              );
              setLocalMedia((current) => [
                ...current.filter(
                  (item) =>
                    !screenPublications.some(
                      (publication) => publication.source === item.publication.source,
                    ),
                ),
                ...screenPublications.map((publication, index) => ({
                  publication,
                  stream: new MediaStream([missingScreenTracks[index]!.track]),
                })),
              ]);
            } else {
              const screenStream = screenShareManagerRef.current?.currentStream();
              const screenAudioTrack = screenStream?.getAudioTracks()[0];
              if (
                screenWantedRef.current &&
                screenStream &&
                screenAudioTrack &&
                screenAudioTrack.readyState !== 'ended' &&
                !currentClient.localTrack('screen-audio')
              ) {
                const audioPublication = await currentClient.publishTrack(
                  screenAudioTrack,
                  screenStream,
                  'screen-audio',
                  false,
                );
                setLocalMedia((current) => [
                  ...current.filter((item) => item.publication.source !== 'screen-audio'),
                  { publication: audioPublication, stream: new MediaStream([screenAudioTrack]) },
                ]);
              }
            }
            setConnectionSnapshot(snapshot);
            setStatus('connected');
            return true;
          } catch {
            // A failed isolated repair falls through to an authoritative session rebuild.
          }
        }
        if (!connectionId) return false;

        const generation = sessionGenerationRef.current + 1;
        sessionGenerationRef.current = generation;
        setRecoveryAttempts((current) => current + 1);
        setLastRecoveryReason(reason);
        setStatus('recovering');
        detectorCleanupRef.current?.();
        detectorCleanupRef.current = null;
        statsCollectorRef.current?.stop();
        statsCollectorRef.current = null;
        subscribedPublicationIdsRef.current.clear();
        setRemoteMedia([]);
        if (currentClient) await currentClient.detachForRecovery();
        if (clientRef.current === currentClient) clientRef.current = null;

        const microphone =
          currentMicrophone && currentMicrophone.readyState !== 'ended'
            ? currentMicrophone
            : undefined;
        const started = await startClientRef.current(connectionId, true, microphone);
        if (!started || generation !== sessionGenerationRef.current) return false;
        pendingPublicationClosuresRef.current.clear();
        setReconciliationNeeded(false);
        const recoveredClient = clientRef.current;
        if (!recoveredClient) return false;

        if (cameraWantedRef.current) {
          try {
            cameraManagerRef.current ??= new CameraManager();
            const cameraStream = await cameraManagerRef.current.start(
              selectedCameraRef.current || undefined,
            );
            const cameraTrack = cameraStream.getVideoTracks()[0];
            if (!cameraTrack || cameraTrack.readyState === 'ended') {
              throw new DOMException('Câmera indisponível', 'NotFoundError');
            }
            const publication = await recoveredClient.publishTrack(
              cameraTrack,
              cameraStream,
              'camera',
              false,
            );
            setLocalMedia((current) => [
              ...current.filter((item) => item.publication.source !== 'camera'),
              { publication, stream: new MediaStream([cameraTrack]) },
            ]);
            setCameraState('active');
          } catch {
            cameraWantedRef.current = false;
            cameraManagerRef.current?.stop();
            setCameraState('idle');
            setLocalMedia((current) =>
              current.filter((item) => item.publication.source !== 'camera'),
            );
            setError('A câmera foi interrompida. A chamada de voz foi restabelecida.');
          }
        }

        if (screenWantedRef.current) {
          const screenStream = screenShareManagerRef.current?.currentStream();
          const screenTrack = screenStream?.getVideoTracks()[0];
          if (screenStream && screenTrack && screenTrack.readyState !== 'ended') {
            try {
              const audioTrack = screenStream.getAudioTracks()[0];
              const recoveredScreenTracks = [
                { track: screenTrack, stream: screenStream, source: 'screen-video' as const },
                ...(audioTrack && audioTrack.readyState !== 'ended'
                  ? [
                      {
                        track: audioTrack,
                        stream: screenStream,
                        source: 'screen-audio' as const,
                      },
                    ]
                  : []),
              ];
              const publications = await recoveredClient.publishTracks(
                recoveredScreenTracks,
                false,
              );
              const recoveredScreenMedia: MediaStreamView[] = publications.map(
                (publication, index) => ({
                  publication,
                  stream: new MediaStream([recoveredScreenTracks[index]!.track]),
                }),
              );
              setLocalMedia((current) => [
                ...current.filter(
                  (item) =>
                    item.publication.source !== 'screen-video' &&
                    item.publication.source !== 'screen-audio',
                ),
                ...recoveredScreenMedia,
              ]);
              setScreenState('active');
            } catch {
              screenWantedRef.current = false;
              screenShareManagerRef.current?.stop();
              setScreenState('idle');
            }
          } else {
            screenWantedRef.current = false;
            screenShareManagerRef.current?.stop();
            setScreenState('idle');
            setLocalMedia((current) =>
              current.filter(
                (item) =>
                  item.publication.source !== 'screen-video' &&
                  item.publication.source !== 'screen-audio',
              ),
            );
          }
        }

        setStatus('connected');
        return true;
      })();
      recoveryOperationRef.current = operation;
      try {
        return await operation;
      } finally {
        if (recoveryOperationRef.current === operation) recoveryOperationRef.current = null;
      }
    },
    [connectionId, status],
  );

  return {
    callConflict: callConflictChannelId !== null,
    callConflictChannelId,
    cameraState,
    cameras,
    changeCamera,
    changeMicrophone,
    deafened: voiceControls.deafened,
    debugStats,
    debugHealth: {
      activePublications: clientRef.current?.localPublicationSources() ?? [],
      activeSubscriptions: clientRef.current?.remotePublicationCount() ?? 0,
      camera: cameraManagerRef.current?.currentTrack()?.readyState ?? 'absent',
      cameraSettings: cameraManagerRef.current?.currentTrack()?.getSettings() ?? null,
      connectionState: connectionSnapshot?.connectionState ?? 'unavailable',
      iceConnectionState: connectionSnapshot?.iceConnectionState ?? 'unavailable',
      iceGatheringState: connectionSnapshot?.iceGatheringState ?? 'unavailable',
      microphone: microphoneTrackRef.current?.readyState ?? 'absent',
      screen:
        screenShareManagerRef.current?.currentStream()?.getVideoTracks()[0]?.readyState ?? 'absent',
      sessionId: clientRef.current?.maskedSessionId() ?? '—',
      signalingState: connectionSnapshot?.signalingState ?? 'unavailable',
    },
    connectionSnapshot,
    error,
    join,
    switchCall,
    takeoverCall: () => join(true, callConflictChannelId ?? roomId),
    leave,
    localMedia,
    lastRecoveryReason,
    microphones,
    muted: effectiveMuted(voiceControls),
    remoteMedia,
    reconcile,
    reconciliationNeeded,
    recoveryAttempts,
    screenState,
    selectedCamera,
    selectedMicrophone,
    startCamera,
    startScreenShare,
    status,
    stopCamera,
    stopScreenShare,
    switchCamera,
    supportsCamera: Boolean(navigator.mediaDevices?.getUserMedia),
    supportsScreenShare: Boolean(navigator.mediaDevices?.getDisplayMedia),
    toggleDeafened,
    toggleMuted,
    userMuted: voiceControls.userMuted,
  };
}

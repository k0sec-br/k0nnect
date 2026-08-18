import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaPublication } from '../../../shared/protocol/room';
import { mediaDevicePreferences } from './media-device-preferences';
import { CameraManager, ScreenShareManager } from './media-capture-managers';
import { mediaErrorMessage } from './media-errors';
import { MediaStatsCollector, type MediaStatsSnapshot } from './media-stats';
import { MediaSessionManager, type RemoteMediaTrack } from './media-session-manager';
import { startSpeakingDetector } from './speaking-detector';

export type TrackLifecycleState =
  'idle' | 'requesting-permission' | 'starting' | 'publishing' | 'active' | 'stopping' | 'error';

export interface MediaStreamView {
  publication: MediaPublication;
  stream: MediaStream;
}

export function useVoiceSession({
  roomId,
  connectionId,
  publications,
  updatePresence,
  updateSpeaking,
}: {
  roomId: string;
  connectionId: string | null;
  publications: MediaPublication[];
  updatePresence(muted: boolean, deafened: boolean): void;
  updateSpeaking(speaking: boolean): void;
}) {
  const clientRef = useRef<MediaSessionManager | null>(null);
  const detectorCleanupRef = useRef<(() => void) | null>(null);
  const activeConnectionIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const startClientRef = useRef<(target: string, reconnecting?: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
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

  const [status, setStatus] = useState<'connected' | 'idle' | 'joining' | 'reconnecting'>('idle');
  const [error, setError] = useState('');
  const [muted, setMutedState] = useState(false);
  const [deafened, setDeafenedState] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState(selectedMicrophoneRef.current);
  const [selectedCamera, setSelectedCamera] = useState(selectedCameraRef.current);
  const [remoteMedia, setRemoteMedia] = useState<MediaStreamView[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaStreamView[]>([]);
  const [cameraState, setCameraState] = useState<TrackLifecycleState>('idle');
  const [screenState, setScreenState] = useState<TrackLifecycleState>('idle');
  const [debugStats, setDebugStats] = useState<MediaStatsSnapshot | null>(null);

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
      void clientRef.current?.closePublication('camera').catch(() => undefined);
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
    async (targetConnectionId: string, reconnecting = false) => {
      setStatus(reconnecting ? 'reconnecting' : 'joining');
      setError('');
      const client = new MediaSessionManager(
        roomId,
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
        (connectionState) => {
          if (connectionState === 'connected') {
            reconnectAttemptRef.current = 0;
            setStatus('connected');
            setError('');
          }
          if (connectionState === 'failed') {
            setStatus('reconnecting');
            setError('Sua conexão de mídia foi interrompida. Estamos tentando reconectar.');
            reconnectAttemptRef.current += 1;
            if (reconnectAttemptRef.current > 5 || reconnectTimerRef.current !== null) return;
            const delay = Math.min(1_000 * 2 ** (reconnectAttemptRef.current - 1), 15_000);
            reconnectTimerRef.current = window.setTimeout(() => {
              reconnectTimerRef.current = null;
              const failedClient = clientRef.current;
              clientRef.current = null;
              detectorCleanupRef.current?.();
              detectorCleanupRef.current = null;
              setLocalMedia([]);
              setRemoteMedia([]);
              setCameraState('idle');
              setScreenState('idle');
              subscribedPublicationIdsRef.current.clear();
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
        const track = await client.start(selectedMicrophoneRef.current || undefined);
        client.setMuted(muted);
        attachDetector(track);
        await refreshDevices();
        reconnectAttemptRef.current = 0;
        setStatus('connected');
        if (import.meta.env.DEV) {
          statsCollectorRef.current?.stop();
          statsCollectorRef.current = new MediaStatsCollector(
            () => client.getStats(),
            setDebugStats,
          );
          statsCollectorRef.current.start();
        }
      } catch (caught) {
        await client.stop();
        if (clientRef.current === client) clientRef.current = null;
        setStatus('idle');
        setError(mediaErrorMessage(caught));
      }
    },
    [attachDetector, muted, refreshDevices, removeRemoteMedia, roomId],
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
    statsCollectorRef.current?.stop();
    statsCollectorRef.current = null;
    setDebugStats(null);
    detectorCleanupRef.current?.();
    detectorCleanupRef.current = null;
    const client = clientRef.current;
    clientRef.current = null;
    activeConnectionIdRef.current = null;
    subscribedPublicationIdsRef.current.clear();
    setRemoteMedia([]);
    setLocalMedia([]);
    setCameraState('idle');
    setScreenState('idle');
    cameraManagerRef.current?.stop();
    screenShareManagerRef.current?.stop();
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
      subscribedPublicationIdsRef.current.clear();
      setLocalMedia([]);
      setRemoteMedia([]);
      setCameraState('idle');
      setScreenState('idle');
      void previousClient.stop().then(() => startClient(connectionId, true));
    }
  }, [connectionId, startClient]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || status !== 'connected') return;
    const availableIds = new Set(publications.map((publication) => publication.publicationId));
    for (const publicationId of subscribedPublicationIdsRef.current) {
      if (!availableIds.has(publicationId)) {
        void client.unsubscribe(publicationId).catch(() => removeRemoteMedia(publicationId));
      }
    }
    for (const publication of publications) {
      if (subscribedPublicationIdsRef.current.has(publication.publicationId)) continue;
      subscribedPublicationIdsRef.current.add(publication.publicationId);
      void client.subscribe(publication).catch((caught) => {
        subscribedPublicationIdsRef.current.delete(publication.publicationId);
        setError(mediaErrorMessage(caught));
      });
    }
  }, [publications, removeRemoteMedia, status]);

  useEffect(
    () => () => {
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      detectorCleanupRef.current?.();
      statsCollectorRef.current?.stop();
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
      selectedMicrophoneRef.current = deviceId;
      setSelectedMicrophone(deviceId);
      mediaDevicePreferences.setMicrophone(deviceId);
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

  const startCamera = useCallback(async () => {
    const client = clientRef.current;
    if (!client || status !== 'connected' || cameraState !== 'idle' || cameraBusyRef.current)
      return;
    cameraBusyRef.current = true;
    const generation = cameraGenerationRef.current;
    setCameraState('requesting-permission');
    setError('');
    let track: MediaStreamTrack | undefined;
    try {
      cameraManagerRef.current ??= new CameraManager();
      const cameraStream = await cameraManagerRef.current.start(
        selectedCameraRef.current || undefined,
      );
      if (generation !== cameraGenerationRef.current) {
        cameraManagerRef.current.stop();
        return;
      }
      track = cameraStream.getVideoTracks()[0];
      if (!track) throw new DOMException('Câmera indisponível', 'NotFoundError');
      track.contentHint = 'motion';
      setCameraState('publishing');
      const publication = await client.publishTrack(track, cameraStream, 'camera');
      if (generation !== cameraGenerationRef.current || track.readyState === 'ended') {
        await client.closePublication('camera').catch(() => undefined);
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
      track?.stop();
      setCameraState('error');
      setError(mediaErrorMessage(caught, 'câmera'));
      setCameraState('idle');
    } finally {
      cameraBusyRef.current = false;
    }
  }, [cameraState, refreshDevices, status]);

  const stopCamera = useCallback(async () => {
    if (!clientRef.current || cameraState === 'idle' || cameraState === 'stopping') return;
    cameraGenerationRef.current += 1;
    cameraManagerRef.current?.stop();
    setCameraState('stopping');
    try {
      await clientRef.current.closePublication('camera');
      setLocalMedia((current) => current.filter((item) => item.publication.source !== 'camera'));
      setCameraState('idle');
    } catch (caught) {
      setCameraState('error');
      setError(mediaErrorMessage(caught, 'câmera'));
    }
  }, [cameraState]);

  const changeCamera = useCallback(
    async (deviceId: string) => {
      selectedCameraRef.current = deviceId;
      setSelectedCamera(deviceId);
      mediaDevicePreferences.setCamera(deviceId);
      if (!clientRef.current || cameraState !== 'active') return;
      try {
        cameraManagerRef.current ??= new CameraManager();
        const stream = await cameraManagerRef.current.replace(deviceId);
        const replacement = stream.getVideoTracks()[0];
        if (!replacement) throw new DOMException('Câmera indisponível', 'NotFoundError');
        await clientRef.current.replaceLocalTrack('camera', replacement);
        setLocalMedia((current) =>
          current.map((item) =>
            item.publication.source === 'camera'
              ? { ...item, stream: new MediaStream([replacement]) }
              : item,
          ),
        );
      } catch (caught) {
        setError(mediaErrorMessage(caught, 'câmera'));
      }
    },
    [cameraState],
  );

  const stopScreenShare = useCallback(async () => {
    if (!clientRef.current || screenStoppingRef.current) return;
    screenStoppingRef.current = true;
    screenGenerationRef.current += 1;
    screenShareManagerRef.current?.stop();
    setScreenState('stopping');
    try {
      await clientRef.current.closePublication('screen-audio').catch(() => undefined);
      await clientRef.current.closePublication('screen-video');
      setLocalMedia((current) =>
        current.filter(
          (item) =>
            item.publication.source !== 'screen-video' &&
            item.publication.source !== 'screen-audio',
        ),
      );
      setScreenState('idle');
    } catch (caught) {
      setScreenState('error');
      setError(mediaErrorMessage(caught, 'compartilhamento'));
    } finally {
      screenStoppingRef.current = false;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    const client = clientRef.current;
    if (!client || status !== 'connected' || screenState !== 'idle' || screenBusyRef.current)
      return;
    screenBusyRef.current = true;
    const generation = screenGenerationRef.current;
    setScreenState('requesting-permission');
    setError('');
    let stream: MediaStream | undefined;
    try {
      screenShareManagerRef.current ??= new ScreenShareManager();
      stream = await screenShareManagerRef.current.start();
      if (generation !== screenGenerationRef.current) return;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new DOMException('Tela indisponível', 'NotFoundError');
      videoTrack.contentHint = 'detail';
      setScreenState('publishing');
      const videoPublication = await client.publishTrack(videoTrack, stream, 'screen-video');
      if (generation !== screenGenerationRef.current || videoTrack.readyState === 'ended') {
        await client.closePublication('screen-video').catch(() => undefined);
        setScreenState('idle');
        return;
      }
      setLocalMedia((current) => [
        ...current,
        { publication: videoPublication, stream: new MediaStream([videoTrack]) },
      ]);
      videoTrack.addEventListener('ended', () => void stopScreenShare(), { once: true });
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && generation === screenGenerationRef.current) {
        const audioPublication = await client.publishTrack(audioTrack, stream, 'screen-audio');
        if (generation !== screenGenerationRef.current) {
          await client.closePublication('screen-audio').catch(() => undefined);
          return;
        }
        setLocalMedia((current) => [
          ...current,
          { publication: audioPublication, stream: new MediaStream([audioTrack]) },
        ]);
      }
      setScreenState('active');
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop());
      screenShareManagerRef.current?.stop();
      await client.closePublication('screen-audio').catch(() => undefined);
      await client.closePublication('screen-video').catch(() => undefined);
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

  return {
    cameraState,
    cameras,
    changeCamera,
    changeMicrophone,
    deafened,
    debugStats,
    error,
    join,
    leave,
    localMedia,
    microphones,
    muted,
    remoteMedia,
    screenState,
    selectedCamera,
    selectedMicrophone,
    startCamera,
    startScreenShare,
    status,
    stopCamera,
    stopScreenShare,
    supportsCamera: Boolean(navigator.mediaDevices?.getUserMedia),
    supportsScreenShare: Boolean(navigator.mediaDevices?.getDisplayMedia),
    toggleDeafened,
    toggleMuted,
  };
}

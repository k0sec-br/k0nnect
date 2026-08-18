import { apiClient } from '../../lib/api-client';

interface SessionDescriptionResponse {
  sessionDescription: RTCSessionDescriptionInit;
  tracks: { trackName: string; mid?: string }[];
}

export class RealtimeAudioClient {
  private peerConnection: RTCPeerConnection | null = null;
  private localTrack: MediaStreamTrack | null = null;
  private sessionId: string | null = null;
  private publishedTrackName: string | null = null;
  private subscriptions = new Set<string>();
  private negotiation = Promise.resolve();

  constructor(
    private readonly roomId: string,
    private readonly connectionId: string,
    private readonly onRemoteTrack: (track: MediaStreamTrack) => void,
    private readonly onConnectionChange: (state: RTCPeerConnectionState) => void,
  ) {}

  async start(deviceId?: string): Promise<MediaStreamTrack> {
    const turn = await apiClient.post<{ iceServers: RTCIceServer[] }>('/api/realtime/session', {
      action: 'turn',
      roomId: this.roomId,
      connectionId: this.connectionId,
    });
    const peerConnection = new RTCPeerConnection({
      iceServers: turn.iceServers,
      bundlePolicy: 'max-bundle',
    });
    this.peerConnection = peerConnection;
    peerConnection.addEventListener('track', (event) => this.onRemoteTrack(event.track));
    peerConnection.addEventListener('connectionstatechange', () => {
      this.onConnectionChange(peerConnection.connectionState);
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new DOMException('Microfone indisponível', 'NotFoundError');
    this.localTrack = track;
    peerConnection.addTrack(track, stream);

    const session = await apiClient.post<{ sessionId: string }>('/api/realtime/session', {
      action: 'create',
      roomId: this.roomId,
      connectionId: this.connectionId,
    });
    this.sessionId = session.sessionId;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const published = await apiClient.post<SessionDescriptionResponse>('/api/realtime/session', {
      action: 'publish',
      roomId: this.roomId,
      connectionId: this.connectionId,
      sessionId: session.sessionId,
      sessionDescription: { type: 'offer', sdp: offer.sdp },
    });
    await peerConnection.setRemoteDescription(published.sessionDescription);
    this.publishedTrackName = published.tracks[0]?.trackName ?? null;
    return track;
  }

  async subscribe(remoteSessionId: string, remoteTrackName: string): Promise<void> {
    const subscriptionKey = `${remoteSessionId}:${remoteTrackName}`;
    if (this.subscriptions.has(subscriptionKey)) return;
    this.subscriptions.add(subscriptionKey);
    const task = this.negotiation.then(async () => {
      if (!this.peerConnection || !this.sessionId) return;
      const response = await apiClient.post<SessionDescriptionResponse>('/api/realtime/session', {
        action: 'subscribe',
        roomId: this.roomId,
        connectionId: this.connectionId,
        sessionId: this.sessionId,
        remoteSessionId,
        remoteTrackName,
      });
      await this.peerConnection.setRemoteDescription(response.sessionDescription);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      await apiClient.post('/api/realtime/session', {
        action: 'renegotiate',
        roomId: this.roomId,
        connectionId: this.connectionId,
        sessionId: this.sessionId,
        sessionDescription: { type: 'answer', sdp: answer.sdp },
      });
    });
    this.negotiation = task.catch(() => undefined);
    try {
      await task;
    } catch (error) {
      this.subscriptions.delete(subscriptionKey);
      throw error;
    }
  }

  setMuted(muted: boolean): void {
    if (this.localTrack) this.localTrack.enabled = !muted;
  }

  async changeMicrophone(deviceId: string): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const replacement = stream.getAudioTracks()[0];
    if (!replacement) throw new DOMException('Microfone indisponível', 'NotFoundError');
    const sender = this.peerConnection
      ?.getSenders()
      .find((candidate) => candidate.track === this.localTrack);
    if (!sender) {
      replacement.stop();
      throw new DOMException('Conexão indisponível', 'InvalidStateError');
    }
    await sender.replaceTrack(replacement);
    this.localTrack?.stop();
    this.localTrack = replacement;
    return replacement;
  }

  async stop(): Promise<void> {
    const sessionId = this.sessionId;
    const trackName = this.publishedTrackName;
    this.localTrack?.stop();
    this.peerConnection?.getReceivers().forEach((receiver) => receiver.track.stop());
    this.peerConnection?.close();
    this.localTrack = null;
    this.peerConnection = null;
    this.sessionId = null;
    this.publishedTrackName = null;
    this.subscriptions.clear();
    if (sessionId && trackName) {
      try {
        await apiClient.post('/api/realtime/session', {
          action: 'close',
          roomId: this.roomId,
          connectionId: this.connectionId,
          sessionId,
          trackName,
        });
      } catch {
        // The media connection is already closed locally; server-side tracks expire automatically.
      }
    }
  }
}

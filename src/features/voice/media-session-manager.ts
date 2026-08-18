import type { MediaPublication, MediaSource } from '../../../shared/protocol/room';
import { apiClient } from '../../lib/api-client';
import { NegotiationQueue } from './negotiation-queue';

interface PublishResponse {
  publication: MediaPublication;
  sessionDescription?: RTCSessionDescriptionInit;
}

interface SubscribeResponse {
  publication: MediaPublication;
  mid: string;
  sessionDescription: RTCSessionDescriptionInit;
}

interface CloseResponse {
  sessionDescription?: RTCSessionDescriptionInit;
  requiresImmediateRenegotiation: boolean;
}

interface LocalPublication {
  publication: MediaPublication;
  sender: RTCRtpSender;
  transceiver: RTCRtpTransceiver;
  track: MediaStreamTrack;
}

export interface RemoteMediaTrack {
  publication: MediaPublication;
  stream: MediaStream;
  track: MediaStreamTrack;
}

const VIDEO_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'a', maxBitrate: 2_500_000, scaleResolutionDownBy: 1 },
  { rid: 'b', maxBitrate: 900_000, scaleResolutionDownBy: 2 },
  { rid: 'c', maxBitrate: 250_000, scaleResolutionDownBy: 4 },
];

export class MediaSessionManager {
  private peerConnection: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private readonly localPublications = new Map<MediaSource, LocalPublication>();
  private readonly remotePublications = new Map<string, RemoteMediaTrack>();
  private readonly remotePublicationByMid = new Map<string, MediaPublication>();
  private readonly negotiationQueue = new NegotiationQueue();

  constructor(
    private readonly roomId: string,
    private readonly connectionId: string,
    private readonly onRemoteTrack: (media: RemoteMediaTrack) => void,
    private readonly onRemoteTrackRemoved: (publicationId: string) => void,
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
    peerConnection.addEventListener('track', (event) => {
      const mid = event.transceiver.mid;
      const publication = mid ? this.remotePublicationByMid.get(mid) : undefined;
      if (!publication) return;
      const stream = new MediaStream([event.track]);
      const media = { publication, stream, track: event.track };
      this.remotePublications.set(publication.publicationId, media);
      this.onRemoteTrack(media);
      event.track.addEventListener(
        'ended',
        () => {
          this.remotePublications.delete(publication.publicationId);
          this.onRemoteTrackRemoved(publication.publicationId);
        },
        { once: true },
      );
    });
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

    const session = await apiClient.post<{ sessionId: string }>('/api/realtime/session', {
      action: 'create',
      roomId: this.roomId,
      connectionId: this.connectionId,
    });
    this.sessionId = session.sessionId;
    try {
      await this.publishTrack(track, stream, 'microphone');
    } catch (error) {
      track.stop();
      throw error;
    }
    return track;
  }

  publishTrack(
    track: MediaStreamTrack,
    stream: MediaStream,
    source: MediaSource,
  ): Promise<MediaPublication> {
    return this.negotiationQueue.enqueue(async () => {
      const peerConnection = this.requirePeerConnection();
      const sessionId = this.requireSessionId();
      if (this.localPublications.has(source)) {
        throw new DOMException('Esta mídia já está publicada', 'InvalidStateError');
      }
      const transceiver = peerConnection.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
        ...(source === 'camera' ? { sendEncodings: VIDEO_ENCODINGS } : {}),
      });
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        if (!offer.sdp) throw new DOMException('SDP indisponível', 'InvalidStateError');
        const mid = transceiver.mid;
        if (!mid) throw new DOMException('Faixa sem identificador', 'InvalidStateError');
        const response = await apiClient.post<PublishResponse>('/api/realtime/session', {
          action: 'publish',
          roomId: this.roomId,
          connectionId: this.connectionId,
          sessionId,
          source,
          mid,
          sessionDescription: { type: 'offer', sdp: offer.sdp },
        });
        if (response.sessionDescription) {
          await peerConnection.setRemoteDescription(response.sessionDescription);
        }
        this.localPublications.set(source, {
          publication: response.publication,
          sender: transceiver.sender,
          transceiver,
          track,
        });
        return response.publication;
      } catch (error) {
        transceiver.sender.replaceTrack(null).catch(() => undefined);
        track.stop();
        throw error;
      }
    });
  }

  subscribe(publication: MediaPublication): Promise<void> {
    if (this.remotePublications.has(publication.publicationId)) return Promise.resolve();
    return this.negotiationQueue.enqueue(async () => {
      if (this.remotePublicationByMidHas(publication.publicationId)) return;
      const peerConnection = this.requirePeerConnection();
      const sessionId = this.requireSessionId();
      const response = await apiClient.post<SubscribeResponse>('/api/realtime/session', {
        action: 'subscribe',
        roomId: this.roomId,
        connectionId: this.connectionId,
        sessionId,
        publicationId: publication.publicationId,
        ...(publication.source === 'camera' ? { preferredRid: 'b' } : {}),
      });
      this.remotePublicationByMid.set(response.mid, response.publication);
      try {
        await peerConnection.setRemoteDescription(response.sessionDescription);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        if (!answer.sdp) throw new DOMException('SDP indisponível', 'InvalidStateError');
        await apiClient.post('/api/realtime/session', {
          action: 'renegotiate',
          roomId: this.roomId,
          connectionId: this.connectionId,
          sessionId,
          sessionDescription: { type: 'answer', sdp: answer.sdp },
        });
      } catch (error) {
        this.remotePublicationByMid.delete(response.mid);
        throw error;
      }
    });
  }

  unsubscribe(publicationId: string): Promise<void> {
    return this.negotiationQueue.enqueue(async () => {
      const mid = this.findRemoteMid(publicationId);
      if (!mid) return;
      const response = await apiClient.post<CloseResponse>('/api/realtime/session', {
        action: 'unsubscribe',
        roomId: this.roomId,
        connectionId: this.connectionId,
        sessionId: this.requireSessionId(),
        publicationId,
      });
      await this.applyServerOffer(response.sessionDescription);
      this.remotePublicationByMid.delete(mid);
      this.remotePublications.get(publicationId)?.track.stop();
      this.remotePublications.delete(publicationId);
      this.onRemoteTrackRemoved(publicationId);
    });
  }

  setMuted(muted: boolean): void {
    const microphone = this.localPublications.get('microphone');
    if (microphone) microphone.track.enabled = !muted;
  }

  async replaceLocalTrack(source: MediaSource, replacement: MediaStreamTrack): Promise<void> {
    const publication = this.localPublications.get(source);
    if (!publication) {
      replacement.stop();
      throw new DOMException('Mídia indisponível', 'InvalidStateError');
    }
    await publication.sender.replaceTrack(replacement);
    publication.track.stop();
    publication.track = replacement;
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
    await this.replaceLocalTrack('microphone', replacement);
    return replacement;
  }

  closePublication(source: MediaSource): Promise<void> {
    return this.negotiationQueue.enqueue(async () => {
      const publication = this.localPublications.get(source);
      if (!publication) return;
      try {
        const response = await apiClient.post<CloseResponse>('/api/realtime/session', {
          action: 'close',
          roomId: this.roomId,
          connectionId: this.connectionId,
          sessionId: this.requireSessionId(),
          publicationId: publication.publication.publicationId,
        });
        await this.applyServerOffer(response.sessionDescription);
      } finally {
        await publication.sender.replaceTrack(null).catch(() => undefined);
        publication.track.stop();
        this.localPublications.delete(source);
      }
    });
  }

  async stop(): Promise<void> {
    const sources = [...this.localPublications.keys()];
    for (const source of sources) {
      await this.closePublication(source).catch(() => undefined);
    }
    for (const media of this.remotePublications.values()) media.track.stop();
    this.remotePublications.clear();
    this.remotePublicationByMid.clear();
    this.peerConnection?.close();
    this.peerConnection = null;
    this.sessionId = null;
  }

  getStats(): Promise<RTCStatsReport> {
    return this.requirePeerConnection().getStats();
  }

  private async applyServerOffer(description?: RTCSessionDescriptionInit): Promise<void> {
    if (description?.type !== 'offer') return;
    const peerConnection = this.requirePeerConnection();
    await peerConnection.setRemoteDescription(description);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    if (!answer.sdp) throw new DOMException('SDP indisponível', 'InvalidStateError');
    await apiClient.post('/api/realtime/session', {
      action: 'renegotiate',
      roomId: this.roomId,
      connectionId: this.connectionId,
      sessionId: this.requireSessionId(),
      sessionDescription: { type: 'answer', sdp: answer.sdp },
    });
  }

  private findRemoteMid(publicationId: string): string | undefined {
    for (const [mid, publication] of this.remotePublicationByMid) {
      if (publication.publicationId === publicationId) return mid;
    }
    return undefined;
  }

  private remotePublicationByMidHas(publicationId: string): boolean {
    return [...this.remotePublicationByMid.values()].some(
      (publication) => publication.publicationId === publicationId,
    );
  }

  private requirePeerConnection(): RTCPeerConnection {
    if (!this.peerConnection) throw new DOMException('Conexão indisponível', 'InvalidStateError');
    return this.peerConnection;
  }

  private requireSessionId(): string {
    if (!this.sessionId) throw new DOMException('Sessão indisponível', 'InvalidStateError');
    return this.sessionId;
  }
}

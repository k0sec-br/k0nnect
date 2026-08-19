import { cameraConstraints } from './media-device-preferences';

export class CameraManager {
  private activeStream: MediaStream | null = null;
  private startOperation: Promise<MediaStream> | null = null;
  private generation = 0;

  constructor(private readonly mediaDevices: MediaDevices = navigator.mediaDevices) {}

  start(deviceId?: string): Promise<MediaStream> {
    const activeStream = this.activeStream;
    if (activeStream && activeStream.getVideoTracks()[0]?.readyState !== 'ended') {
      return Promise.resolve(activeStream);
    }
    this.activeStream = null;
    if (this.startOperation) return this.startOperation;
    const generation = this.generation;
    this.startOperation = this.mediaDevices
      .getUserMedia({ audio: false, video: cameraConstraints(deviceId) })
      .then((stream) => {
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          throw new DOMException('Inicialização cancelada', 'AbortError');
        }
        if (!stream.getVideoTracks()[0]) {
          stream.getTracks().forEach((track) => track.stop());
          throw new DOMException('Câmera indisponível', 'NotFoundError');
        }
        this.activeStream = stream;
        return stream;
      })
      .finally(() => {
        this.startOperation = null;
      });
    return this.startOperation;
  }

  async replace(
    deviceId: string,
    applyReplacement: (track: MediaStreamTrack) => Promise<void>,
    facingMode?: 'environment' | 'user',
  ): Promise<MediaStream> {
    const generation = this.generation;
    let nextStream: MediaStream;
    try {
      nextStream = await this.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(deviceId),
      });
    } catch (error) {
      if (!facingMode || (error instanceof DOMException && error.name === 'NotAllowedError')) {
        throw error;
      }
      nextStream = await this.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(undefined, facingMode),
      });
    }
    if (generation !== this.generation) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Troca cancelada', 'AbortError');
    }
    const nextTrack = nextStream.getVideoTracks()[0];
    if (!nextTrack) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Câmera indisponível', 'NotFoundError');
    }
    try {
      await applyReplacement(nextTrack);
    } catch (error) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    if (generation !== this.generation) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Troca cancelada', 'AbortError');
    }
    const previous = this.activeStream;
    this.activeStream = nextStream;
    previous?.getTracks().forEach((track) => track.stop());
    return nextStream;
  }

  stop(): void {
    this.generation += 1;
    this.activeStream?.getTracks().forEach((track) => track.stop());
    this.activeStream = null;
  }

  currentTrack(): MediaStreamTrack | undefined {
    return this.activeStream?.getVideoTracks()[0];
  }

  currentStream(): MediaStream | null {
    return this.activeStream;
  }
}

export class ScreenShareManager {
  private activeStream: MediaStream | null = null;
  private startOperation: Promise<MediaStream> | null = null;
  private generation = 0;

  constructor(private readonly mediaDevices: MediaDevices = navigator.mediaDevices) {}

  start(): Promise<MediaStream> {
    if (this.activeStream) return Promise.resolve(this.activeStream);
    if (this.startOperation) return this.startOperation;
    const generation = this.generation;
    this.startOperation = this.mediaDevices
      .getDisplayMedia({ video: true, audio: true })
      .then((stream) => {
        if (generation !== this.generation) {
          stream.getTracks().forEach((track) => track.stop());
          throw new DOMException('Inicialização cancelada', 'AbortError');
        }
        if (!stream.getVideoTracks()[0]) {
          stream.getTracks().forEach((track) => track.stop());
          throw new DOMException('Tela indisponível', 'NotFoundError');
        }
        this.activeStream = stream;
        return stream;
      })
      .finally(() => {
        this.startOperation = null;
      });
    return this.startOperation;
  }

  stop(): void {
    this.generation += 1;
    this.activeStream?.getTracks().forEach((track) => track.stop());
    this.activeStream = null;
  }

  currentStream(): MediaStream | null {
    return this.activeStream;
  }
}

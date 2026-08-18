export interface ManagedMediaTrack {
  readonly kind: 'audio' | 'screen' | 'video';
  readonly mediaStreamTrack: MediaStreamTrack;
  stop(): void;
}

export interface AudioTrack extends ManagedMediaTrack {
  readonly kind: 'audio';
  setMuted(muted: boolean): void;
}

export interface VideoTrack extends ManagedMediaTrack {
  readonly kind: 'video';
}

export interface ScreenTrack extends ManagedMediaTrack {
  readonly kind: 'screen';
}

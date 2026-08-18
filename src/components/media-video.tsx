import { useEffect, useRef, useState } from 'react';

import { mediaTrackAspectRatio } from '../features/voice/video-layout';

export function MediaVideo({
  stream,
  muted,
  label,
  mirrored = false,
  onAspectRatioChange,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
  mirrored?: boolean;
  onAspectRatioChange?(aspectRatio: number): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const updateAspectRatio = () => {
      const intrinsicAspectRatio =
        video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
      const trackAspectRatio = mediaTrackAspectRatio(stream.getVideoTracks()[0]);
      const aspectRatio = intrinsicAspectRatio ?? trackAspectRatio;
      if (aspectRatio && Number.isFinite(aspectRatio)) onAspectRatioChange?.(aspectRatio);
    };
    video.srcObject = stream;
    updateAspectRatio();
    video.addEventListener('loadedmetadata', updateAspectRatio);
    video.addEventListener('resize', updateAspectRatio);
    void video.play().then(
      () => setPlaybackBlocked(false),
      () => setPlaybackBlocked(true),
    );
    return () => {
      video.removeEventListener('loadedmetadata', updateAspectRatio);
      video.removeEventListener('resize', updateAspectRatio);
      video.srcObject = null;
    };
  }, [onAspectRatioChange, stream]);

  return (
    <div className="media-video">
      <video
        ref={videoRef}
        className={mirrored ? 'is-mirrored' : undefined}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
      />
      {playbackBlocked && (
        <button
          type="button"
          onClick={() =>
            void videoRef.current?.play().then(
              () => setPlaybackBlocked(false),
              () => undefined,
            )
          }
        >
          Reproduzir vídeo
        </button>
      )}
    </div>
  );
}

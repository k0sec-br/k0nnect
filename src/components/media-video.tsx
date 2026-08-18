import { useEffect, useRef, useState } from 'react';

export function MediaVideo({
  stream,
  muted,
  label,
}: {
  stream: MediaStream;
  muted: boolean;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().then(
      () => setPlaybackBlocked(false),
      () => setPlaybackBlocked(true),
    );
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="media-video">
      <video ref={videoRef} autoPlay playsInline muted={muted} aria-label={label} />
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

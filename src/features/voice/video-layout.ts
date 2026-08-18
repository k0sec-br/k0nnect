export function mediaTrackAspectRatio(track?: MediaStreamTrack): number | null {
  const settings = track?.getSettings();
  if (!settings?.width || !settings.height) return null;
  return settings.width / settings.height;
}

export function shouldMirrorLocalCamera(track?: MediaStreamTrack): boolean {
  return track?.getSettings().facingMode !== 'environment';
}

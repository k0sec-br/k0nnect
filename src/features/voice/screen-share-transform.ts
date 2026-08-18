export interface ScreenShareTransform {
  scale: number;
  x: number;
  y: number;
}

export const INITIAL_SCREEN_SHARE_TRANSFORM: ScreenShareTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export function clampZoom(scale: number, minimum = 1, maximum = 4): number {
  return Math.min(maximum, Math.max(minimum, scale));
}

export function clampScreenShareTransform(
  transform: ScreenShareTransform,
  viewportWidth: number,
  viewportHeight: number,
): ScreenShareTransform {
  const scale = clampZoom(transform.scale);
  if (scale === 1) return INITIAL_SCREEN_SHARE_TRANSFORM;
  const maximumX = Math.max(0, (viewportWidth * (scale - 1)) / 2);
  const maximumY = Math.max(0, (viewportHeight * (scale - 1)) / 2);
  return {
    scale,
    x: Math.min(maximumX, Math.max(-maximumX, transform.x)),
    y: Math.min(maximumY, Math.max(-maximumY, transform.y)),
  };
}

const MICROPHONE_STORAGE_KEY = 'k0nnect.media.microphone';
const CAMERA_STORAGE_KEY = 'k0nnect.media.camera';

function readPreference(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writePreference(key: string, deviceId: string): void {
  try {
    window.localStorage.setItem(key, deviceId);
  } catch {
    // Device preferences are optional and remain session-only when storage is unavailable.
  }
}

export const mediaDevicePreferences = {
  microphone(): string {
    return readPreference(MICROPHONE_STORAGE_KEY);
  },
  camera(): string {
    return readPreference(CAMERA_STORAGE_KEY);
  },
  setMicrophone(deviceId: string): void {
    writePreference(MICROPHONE_STORAGE_KEY, deviceId);
  },
  setCamera(deviceId: string): void {
    writePreference(CAMERA_STORAGE_KEY, deviceId);
  },
};

export function cameraConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

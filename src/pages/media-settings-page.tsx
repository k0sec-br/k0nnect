import { useCallback, useEffect, useState } from 'react';

import { MediaVideo } from '../components/media-video';
import { SettingsLayout } from '../components/settings-layout';
import {
  cameraConstraints,
  mediaDevicePreferences,
} from '../features/voice/media-device-preferences';
import { mediaErrorMessage } from '../features/voice/media-errors';

export function MediaSettingsPage() {
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState(mediaDevicePreferences.microphone());
  const [cameraId, setCameraId] = useState(mediaDevicePreferences.camera());
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');

  const refreshDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const nextMicrophones = devices.filter((device) => device.kind === 'audioinput');
    const nextCameras = devices.filter((device) => device.kind === 'videoinput');
    setMicrophones(nextMicrophones);
    setCameras(nextCameras);
    setMicrophoneId((current) =>
      current.length > 0 ? current : (nextMicrophones[0]?.deviceId ?? ''),
    );
    setCameraId((current) => (current.length > 0 ? current : (nextCameras[0]?.deviceId ?? '')));
  }, []);

  useEffect(() => {
    void refreshDevices();
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshDevices]);

  useEffect(
    () => () => {
      preview?.getTracks().forEach((track) => track.stop());
    },
    [preview],
  );

  const stopPreview = useCallback(() => {
    setPreview((current) => {
      current?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const startPreview = useCallback(async () => {
    stopPreview();
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraConstraints(cameraId || undefined),
      });
      setPreview(stream);
      await refreshDevices();
    } catch (caught) {
      setError(mediaErrorMessage(caught, 'câmera'));
    }
  }, [cameraId, refreshDevices, stopPreview]);

  return (
    <SettingsLayout active="media">
      <section className="settings-card" aria-labelledby="voice-video-title">
        <h2 id="voice-video-title">Voz e vídeo</h2>
        <p>Escolha os dispositivos usados ao entrar em uma chamada.</p>
        <div className="media-settings-fields">
          <label>
            Microfone
            <select
              value={microphoneId}
              onChange={(event) => {
                setMicrophoneId(event.target.value);
                mediaDevicePreferences.setMicrophone(event.target.value);
              }}
            >
              {microphones.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microfone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Câmera
            <select
              value={cameraId}
              onChange={(event) => {
                setCameraId(event.target.value);
                mediaDevicePreferences.setCamera(event.target.value);
                stopPreview();
              }}
            >
              {cameras.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Câmera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="camera-preview">
          {preview ? (
            <MediaVideo stream={preview} muted label="Prévia da câmera" />
          ) : (
            <div className="camera-preview-placeholder">
              A prévia permanece desligada até você iniciar.
            </div>
          )}
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button
            className="button secondary"
            type="button"
            onClick={preview ? stopPreview : startPreview}
          >
            {preview ? 'Parar prévia' : 'Iniciar prévia'}
          </button>
        </div>
      </section>
    </SettingsLayout>
  );
}

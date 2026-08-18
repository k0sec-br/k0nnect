import { useCallback, useEffect, useState } from 'react';

import { DeviceSelect } from '../components/device-select';
import { MediaVideo } from '../components/media-video';
import { SettingsLayout } from '../components/settings-layout';
import { useCall } from '../features/call/call-context';
import { cameraConstraints } from '../features/voice/media-device-preferences';
import { mediaErrorMessage } from '../features/voice/media-errors';

export function MediaSettingsPage() {
  const { voice } = useCall();
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const activeCamera = voice.localMedia.find(
    (media) => media.publication.source === 'camera',
  )?.stream;
  const displayedPreview = activeCamera ?? preview;

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
        video: cameraConstraints(voice.selectedCamera || undefined),
      });
      setPreview(stream);
    } catch (caught) {
      setError(mediaErrorMessage(caught, 'câmera'));
    }
  }, [stopPreview, voice.selectedCamera]);

  return (
    <SettingsLayout active="media">
      <section className="settings-section" aria-labelledby="voice-video-title">
        <header className="settings-section-header">
          <span className="eyebrow">Dispositivos</span>
          <h2 id="voice-video-title">Voz e vídeo</h2>
          <p>Escolha os dispositivos usados na chamada e nas próximas conexões.</p>
        </header>
        <div className="media-settings-fields">
          <DeviceSelect
            devices={voice.microphones}
            emptyLabel="Nenhum microfone disponível"
            fallbackLabel="Microfone"
            label="Microfone"
            value={voice.selectedMicrophone}
            onChange={(deviceId) => void voice.changeMicrophone(deviceId)}
          />
          <DeviceSelect
            devices={voice.cameras}
            emptyLabel="Nenhuma câmera disponível"
            fallbackLabel="Câmera"
            label="Câmera"
            value={voice.selectedCamera}
            onChange={(deviceId) => {
              stopPreview();
              void voice.changeCamera(deviceId);
            }}
          />
        </div>
        <div className="camera-preview">
          {displayedPreview ? (
            <MediaVideo stream={displayedPreview} muted label="Prévia da câmera" />
          ) : (
            <div className="camera-preview-placeholder">
              A prévia permanece desligada até você iniciar.
            </div>
          )}
        </div>
        {(error || voice.error) && (
          <p className="field-error" role="alert">
            {error || voice.error}
          </p>
        )}
        <div className="settings-actions">
          {!activeCamera && (
            <button
              className="button secondary"
              type="button"
              onClick={preview ? stopPreview : startPreview}
            >
              {preview ? 'Parar prévia' : 'Iniciar prévia'}
            </button>
          )}
        </div>
      </section>
    </SettingsLayout>
  );
}

import { useEffect, useState } from 'react';

import { requestNativeNotificationPermission } from '../../core/native/native-notifications';
import {
  notificationContentVisible,
  notificationsMuted,
  setNotificationContentVisible,
  setNotificationsMuted,
} from '../../core/native/native-preferences';

export function NativeNotificationSettings() {
  const [muted, setMuted] = useState(notificationsMuted);
  const [showContent, setShowContent] = useState(notificationContentVisible);
  const [permissionMessage, setPermissionMessage] = useState('');

  useEffect(() => {
    const refresh = () => {
      setMuted(notificationsMuted());
      setShowContent(notificationContentVisible());
    };
    window.addEventListener('k0nnect:native-preferences-changed', refresh);
    return () => window.removeEventListener('k0nnect:native-preferences-changed', refresh);
  }, []);

  return (
    <section className="settings-section" aria-labelledby="native-notifications-title">
      <header className="settings-section-header">
        <span className="eyebrow">Aplicativo</span>
        <h2 id="native-notifications-title">Notificações</h2>
        <p>Controle o que aparece nas notificações do sistema.</p>
      </header>
      <div className="native-setting-list">
        <label className="native-setting-row">
          <span>
            <strong>Receber notificações</strong>
            <small>Mostra novas mensagens quando o k0nnect está em segundo plano.</small>
          </span>
          <input
            type="checkbox"
            checked={!muted}
            onChange={async (event) => {
              const enabled = event.target.checked;
              if (enabled && !(await requestNativeNotificationPermission())) {
                setPermissionMessage('Permita notificações nas configurações do sistema.');
                return;
              }
              setPermissionMessage('');
              setNotificationsMuted(!enabled);
              setMuted(!enabled);
            }}
          />
        </label>
        <label className="native-setting-row">
          <span>
            <strong>Mostrar conteúdo das mensagens nas notificações</strong>
            <small>Desative para ocultar trechos das mensagens na tela do sistema.</small>
          </span>
          <input
            type="checkbox"
            checked={showContent}
            disabled={muted}
            onChange={(event) => {
              setNotificationContentVisible(event.target.checked);
              setShowContent(event.target.checked);
            }}
          />
        </label>
      </div>
      {permissionMessage && (
        <p className="field-error" role="status">
          {permissionMessage}
        </p>
      )}
    </section>
  );
}

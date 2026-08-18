import { SettingsLayout } from '../components/settings-layout';
import { Avatar } from '../components/avatar';
import { ShieldIcon } from '../components/icons';
import { useAuth } from '../features/auth/auth-context';

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Administrador',
  member: 'Membro',
} as const;

export function SettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <SettingsLayout active="account">
      <section className="settings-section" aria-labelledby="account-title">
        <header className="settings-section-header">
          <span className="eyebrow">Perfil</span>
          <h2 id="account-title">Minha conta</h2>
        </header>
        <div className="account-identity">
          <Avatar displayName={user.displayName} size="large" showStatus={false} />
          <div className="account-identity-copy">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
            <span className="account-role">{ROLE_LABELS[user.role]}</span>
          </div>
        </div>
      </section>
      <section className="settings-section privacy-section" aria-labelledby="privacy-title">
        <ShieldIcon aria-hidden="true" />
        <div>
          <span className="eyebrow">Privacidade</span>
          <h2 id="privacy-title">Identidade mínima</h2>
          <p>O k0nnect não exige email, telefone ou nome real.</p>
        </div>
      </section>
    </SettingsLayout>
  );
}

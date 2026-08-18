import { SettingsLayout } from '../components/settings-layout';
import { useAuth } from '../features/auth/auth-context';
import { AdminInvites } from '../features/invites/admin-invites';

export function SettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <SettingsLayout active="account">
      <section className="settings-card" aria-labelledby="account-title">
        <p className="eyebrow">Perfil mínimo</p>
        <h2 id="account-title">Minha conta</h2>
        <dl className="account-details">
          <div>
            <dt>Nome de exibição</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Usuário</dt>
            <dd>@{user.username}</dd>
          </div>
          <div>
            <dt>Função</dt>
            <dd>
              {user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Administrador' : 'Membro'}
            </dd>
          </div>
        </dl>
        <p className="privacy-copy">O k0nnect não exige email, telefone ou nome real.</p>
      </section>
      {user.role !== 'member' && <AdminInvites user={user} />}
    </SettingsLayout>
  );
}

import { useCallback, useEffect, useState } from 'react';

import type { InviteView, SessionUser } from '../../../shared/types/api';
import { AsyncButton } from '../../components/async-button';
import { FormMessage } from '../../components/form-message';
import { apiClient, UserFacingError } from '../../lib/api-client';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}

const STATUS_LABELS: Record<InviteView['status'], string> = {
  available: 'Disponível',
  expired: 'Expirado',
  revoked: 'Revogado',
  used: 'Usado',
};

export function AdminInvites({ user }: { user: SessionUser }) {
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState('');

  const loadInvites = useCallback(async () => {
    try {
      const result = await apiClient.get<{ invites: InviteView[] }>('/api/admin/invites');
      setInvites(result.invites);
    } catch (caught) {
      setError(
        caught instanceof UserFacingError
          ? caught.message
          : 'Não foi possível carregar os convites.',
      );
    }
  }, []);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const create = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.post<{ invite: InviteView; url: string }>(
        '/api/admin/invites',
        {
          role,
        },
      );
      setNewInviteUrl(result.url);
      setInvites((current) => [result.invite, ...current]);
    } catch (caught) {
      setError(
        caught instanceof UserFacingError ? caught.message : 'Não foi possível criar o convite.',
      );
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (inviteId: string) => {
    try {
      await apiClient.delete(`/api/admin/invites/${encodeURIComponent(inviteId)}`);
      setInvites((current) =>
        current.map((invite) =>
          invite.id === inviteId ? { ...invite, status: 'revoked' } : invite,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof UserFacingError ? caught.message : 'Não foi possível revogar o convite.',
      );
    }
  };

  const copyInvite = async () => {
    if (!newInviteUrl) return;
    try {
      await navigator.clipboard.writeText(newInviteUrl);
      setCopyMessage('Link copiado. Envie-o por um canal seguro.');
    } catch {
      setCopyMessage('Selecione e copie o link manualmente.');
    }
  };

  return (
    <section className="settings-card" aria-labelledby="invites-title">
      <div className="settings-card-header">
        <div>
          <p className="eyebrow">Administração</p>
          <h2 id="invites-title">Convites</h2>
          <p>Links expiram em 72 horas e podem ser usados apenas uma vez.</p>
        </div>
      </div>
      <div className="invite-create-row">
        <label>
          Função concedida
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as 'admin' | 'member')}
          >
            <option value="member">Membro</option>
            {user.role === 'owner' && <option value="admin">Administrador</option>}
          </select>
        </label>
        <AsyncButton
          className="button primary"
          type="button"
          loading={loading}
          onClick={() => void create()}
        >
          Gerar convite
        </AsyncButton>
      </div>
      {error && <FormMessage message={error} />}
      {newInviteUrl && (
        <div className="invite-reveal" role="dialog" aria-labelledby="new-invite-title">
          <div>
            <strong id="new-invite-title">Convite pronto</strong>
            <span>Ele não poderá ser recuperado depois que este quadro for fechado.</span>
          </div>
          <input readOnly value={newInviteUrl} aria-label="Link de convite" />
          {copyMessage && <FormMessage message={copyMessage} tone="success" />}
          <div className="button-row">
            <button className="button secondary" type="button" onClick={() => void copyInvite()}>
              Copiar link
            </button>
            <button className="button ghost" type="button" onClick={() => setNewInviteUrl(null)}>
              Fechar e esquecer
            </button>
          </div>
        </div>
      )}
      <div className="invite-list">
        {invites.map((invite) => (
          <article key={invite.id}>
            <div>
              <strong>{invite.role === 'admin' ? 'Administrador' : 'Membro'}</strong>
              <span>
                Criado em {formatDate(invite.createdAt)} · expira em {formatDate(invite.expiresAt)}
              </span>
            </div>
            <span className={`status-chip ${invite.status}`}>{STATUS_LABELS[invite.status]}</span>
            {invite.status === 'available' && (
              <button
                className="text-button danger-text"
                type="button"
                onClick={() => void revoke(invite.id)}
              >
                Revogar
              </button>
            )}
          </article>
        ))}
        {invites.length === 0 && <p className="empty-copy">Nenhum convite criado ainda.</p>}
      </div>
    </section>
  );
}

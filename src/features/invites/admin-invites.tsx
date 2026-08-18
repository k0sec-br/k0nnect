import { useCallback, useEffect, useRef, useState } from 'react';

import type { InviteView, SessionUser } from '../../../shared/types/api';
import { AsyncButton } from '../../components/async-button';
import { FormMessage } from '../../components/form-message';
import { CopyIcon } from '../../components/icons';
import { apiClient, UserFacingError } from '../../lib/api-client';

interface RevealedInvite {
  expiresAt: string;
  url: string;
}

const STATUS_LABELS: Record<InviteView['status'], string> = {
  available: 'Ativo',
  expired: 'Expirado',
  revoked: 'Revogado',
  used: 'Usado',
};

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatRelativeDate(value: string): string {
  const differenceSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1_000);
  const relativeTime = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const intervals: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of intervals) {
    if (Math.abs(differenceSeconds) >= seconds) {
      return relativeTime.format(Math.round(differenceSeconds / seconds), unit);
    }
  }
  return relativeTime.format(differenceSeconds, 'second');
}

function inviteMetadata(invite: InviteView): string {
  const created = `Criado ${formatRelativeDate(invite.createdAt)}`;
  if (invite.status === 'available') {
    return `${created} · expira ${formatRelativeDate(invite.expiresAt)}`;
  }
  if (invite.status === 'expired') {
    return `${created} · expirou ${formatRelativeDate(invite.expiresAt)}`;
  }
  return `${created} · ${invite.status === 'used' ? 'utilizado' : 'revogado'}`;
}

export function AdminInvites({ user }: { user: SessionUser }) {
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [revealedInvite, setRevealedInvite] = useState<RevealedInvite | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const inviteLinkRef = useRef<HTMLInputElement>(null);
  const cancelRevokeRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (revealedInvite) {
      inviteLinkRef.current?.focus();
      inviteLinkRef.current?.select();
    }
  }, [revealedInvite]);

  useEffect(() => {
    if (revokeTargetId) cancelRevokeRef.current?.focus();
  }, [revokeTargetId]);

  const create = async () => {
    setLoading(true);
    setError('');
    setCopyMessage('');
    try {
      const result = await apiClient.post<{ invite: InviteView; url: string }>(
        '/api/admin/invites',
        { role },
      );
      setRevealedInvite({ url: result.url, expiresAt: result.invite.expiresAt });
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
    setRevokingId(inviteId);
    setError('');
    try {
      await apiClient.delete(`/api/admin/invites/${encodeURIComponent(inviteId)}`);
      setInvites((current) =>
        current.map((invite) =>
          invite.id === inviteId ? { ...invite, status: 'revoked' } : invite,
        ),
      );
      setRevokeTargetId(null);
    } catch (caught) {
      setError(
        caught instanceof UserFacingError ? caught.message : 'Não foi possível revogar o convite.',
      );
    } finally {
      setRevokingId(null);
    }
  };

  const copyInvite = async () => {
    if (!revealedInvite) return;
    try {
      await navigator.clipboard.writeText(revealedInvite.url);
      setCopyMessage('Link copiado. Envie-o por um canal seguro.');
    } catch {
      inviteLinkRef.current?.select();
      setCopyMessage('Selecione e copie o link manualmente.');
    }
  };

  return (
    <section className="settings-section invite-settings" aria-labelledby="invites-title">
      <header className="settings-section-header">
        <span className="eyebrow">Administração</span>
        <h2 id="invites-title">Convites</h2>
        <p>Gere e gerencie acessos ao k0nnect.</p>
      </header>

      <div className="invite-create">
        <div>
          <h3>Novo convite</h3>
          <p>Os convites expiram em 72 horas e só podem ser utilizados uma vez.</p>
        </div>
        <div className="invite-create-row">
          <label>
            Função
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
      </div>

      {error && <FormMessage message={error} />}

      {revealedInvite && (
        <section className="invite-reveal" aria-labelledby="new-invite-title" aria-live="polite">
          <div className="invite-reveal-heading">
            <div>
              <span className="eyebrow">Exibição única</span>
              <h3 id="new-invite-title">Convite criado</h3>
            </div>
            <button className="text-button" type="button" onClick={() => setRevealedInvite(null)}>
              Fechar
            </button>
          </div>
          <p>Este link será exibido apenas agora.</p>
          <div className="invite-link-row">
            <input
              ref={inviteLinkRef}
              readOnly
              value={revealedInvite.url}
              aria-label="Link de convite"
            />
            <button className="button secondary" type="button" onClick={() => void copyInvite()}>
              <CopyIcon aria-hidden="true" /> Copiar link
            </button>
          </div>
          <p className="invite-expiration">Expira em {formatDateTime(revealedInvite.expiresAt)}.</p>
          {copyMessage && <FormMessage message={copyMessage} tone="success" />}
        </section>
      )}

      <div className="invite-list-section">
        <div className="invite-list-heading">
          <h3>Convites recentes</h3>
          <span>{invites.length}</span>
        </div>
        <div className="invite-list" aria-live="polite">
          {invites.map((invite) => (
            <article className="invite-list-item" key={invite.id}>
              <div className="invite-list-copy">
                <strong>{invite.role === 'admin' ? 'Administrador' : 'Membro'}</strong>
                <span title={`Criado em ${formatDateTime(invite.createdAt)}`}>
                  {inviteMetadata(invite)}
                </span>
              </div>
              <div className="invite-list-actions">
                <span
                  className={`status-chip invite-status ${invite.status}`}
                  aria-label={`Status: ${STATUS_LABELS[invite.status]}`}
                >
                  {STATUS_LABELS[invite.status]}
                </span>
                {invite.status === 'available' && (
                  <button
                    className="text-button danger-text"
                    type="button"
                    aria-label={`Revogar convite de ${invite.role === 'admin' ? 'administrador' : 'membro'}`}
                    onClick={() => setRevokeTargetId(invite.id)}
                  >
                    Revogar
                  </button>
                )}
              </div>
              {revokeTargetId === invite.id && (
                <div
                  className="invite-revoke-confirmation"
                  role="alertdialog"
                  aria-labelledby={`revoke-title-${invite.id}`}
                  aria-describedby={`revoke-description-${invite.id}`}
                  data-settings-dialog
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setRevokeTargetId(null);
                    }
                  }}
                >
                  <div>
                    <strong id={`revoke-title-${invite.id}`}>Revogar este convite?</strong>
                    <span id={`revoke-description-${invite.id}`}>
                      O link deixará de funcionar imediatamente.
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      ref={cancelRevokeRef}
                      className="button ghost"
                      type="button"
                      onClick={() => setRevokeTargetId(null)}
                    >
                      Cancelar
                    </button>
                    <AsyncButton
                      className="button danger-outline"
                      type="button"
                      loading={revokingId === invite.id}
                      onClick={() => void revoke(invite.id)}
                    >
                      Revogar convite
                    </AsyncButton>
                  </div>
                </div>
              )}
            </article>
          ))}
          {invites.length === 0 && <p className="empty-copy">Nenhum convite criado ainda.</p>}
        </div>
      </div>
    </section>
  );
}

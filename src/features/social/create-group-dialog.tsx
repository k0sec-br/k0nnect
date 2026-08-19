import { useEffect, useState, type FormEvent } from 'react';

import type { FriendView, SocialStateView } from '../../../shared/types/api';
import { FormMessage } from '../../components/form-message';
import { apiClient } from '../../lib/api-client';

export function CreateGroupDialog({
  friends,
  onClose,
  onCreated,
}: {
  friends: FriendView[];
  onClose(): void;
  onCreated(conversationId: string, social: SocialStateView): void;
}) {
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.post<{ id: string; social: SocialStateView }>(
        '/api/social/groups',
        { name: name.trim(), memberIds },
      );
      onCreated(result.id, result.social);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar o grupo.');
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="social-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
      >
        <header>
          <div>
            <span className="eyebrow">NOVO GRUPO</span>
            <h2 id="create-group-title">Criar grupo privado</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label htmlFor="group-name">Nome</label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={1}
            maxLength={40}
            required
            autoFocus
          />
          <fieldset>
            <legend>Amigos — até 19</legend>
            <div className="group-friend-list">
              {friends.length === 0 ? (
                <p className="empty-copy">Adicione amigos antes de convidá-los.</p>
              ) : (
                friends.map((friend) => (
                  <label key={friend.id}>
                    <input
                      type="checkbox"
                      checked={memberIds.includes(friend.id)}
                      disabled={!memberIds.includes(friend.id) && memberIds.length >= 19}
                      onChange={(event) =>
                        setMemberIds((current) =>
                          event.target.checked
                            ? [...current, friend.id]
                            : current.filter((id) => id !== friend.id),
                        )
                      }
                    />
                    <span>
                      {friend.displayName}
                      <small>@{friend.username}</small>
                    </span>
                  </label>
                ))
              )}
            </div>
          </fieldset>
          {error && <FormMessage message={error} />}
          <footer>
            <button className="button ghost" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Criando…' : 'Criar grupo'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

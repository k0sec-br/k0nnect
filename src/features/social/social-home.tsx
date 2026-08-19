import { useState, type FormEvent } from 'react';

import type {
  FriendRequestView,
  FriendView,
  SocialStateView,
  SocialUserView,
} from '../../../shared/types/api';
import { Avatar } from '../../components/avatar';
import { FormMessage } from '../../components/form-message';
import { apiClient } from '../../lib/api-client';

interface SocialHomeProps {
  friends: FriendView[];
  requests: FriendRequestView[];
  onlineUserIds: string[];
  onChanged(state: SocialStateView): void;
  onMessage(friend: FriendView): void;
}

export function SocialHome({
  friends,
  requests,
  onlineUserIds,
  onChanged,
  onMessage,
}: SocialHomeProps) {
  const [username, setUsername] = useState('');
  const [foundUser, setFoundUser] = useState<SocialUserView | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const incoming = requests.filter((request) => request.direction === 'incoming');
  const outgoing = requests.filter((request) => request.direction === 'outgoing');
  const onlineIds = new Set(onlineUserIds);
  const orderedFriends = [...friends].sort(
    (left, right) => Number(onlineIds.has(right.id)) - Number(onlineIds.has(left.id)),
  );

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const result = await apiClient.get<{ user: SocialUserView }>(
        `/api/social/users/${encodeURIComponent(username.trim().replace(/^@/u, ''))}`,
      );
      setFoundUser(result.user);
    } catch (error) {
      setFoundUser(null);
      setFeedback(error instanceof Error ? error.message : 'Usuário não encontrado.');
    } finally {
      setBusy(false);
    }
  }

  async function mutate(action: () => Promise<{ social: SocialStateView }>, message: string) {
    setBusy(true);
    setFeedback('');
    try {
      const result = await action();
      setFoundUser(null);
      setUsername('');
      setFeedback(message);
      onChanged(result.social);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="social-home" aria-labelledby="friends-title">
      <header className="social-page-header">
        <div>
          <span className="eyebrow">K0NNECT // SOCIAL</span>
          <h1 id="friends-title">Amigos</h1>
          <p>Encontre pessoas pelo usuário exato e converse com quem você conhece.</p>
        </div>
      </header>

      <form className="friend-search" onSubmit={search}>
        <label htmlFor="friend-username">Adicionar amigo</label>
        <div>
          <input
            id="friend-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="@usuario"
            minLength={3}
            maxLength={25}
            required
          />
          <button className="button secondary" type="submit" disabled={busy}>
            Buscar
          </button>
        </div>
      </form>

      {foundUser && (
        <div className="social-user-result">
          <Avatar displayName={foundUser.displayName} />
          <span>
            <strong>{foundUser.displayName}</strong>
            <small>@{foundUser.username}</small>
          </span>
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={() =>
              void mutate(
                () =>
                  apiClient.post<{ social: SocialStateView }>('/api/social/friends', {
                    username: foundUser.username,
                  }),
                'Solicitação enviada.',
              )
            }
          >
            Adicionar
          </button>
        </div>
      )}
      {feedback && <FormMessage message={feedback} tone="success" />}

      {incoming.length > 0 && (
        <section className="social-list-section">
          <h2>Solicitações recebidas</h2>
          {incoming.map((request) => (
            <div className="social-row" key={request.id}>
              <Avatar displayName={request.displayName} />
              <span>
                <strong>{request.displayName}</strong>
                <small>@{request.username}</small>
              </span>
              <div>
                <button
                  className="button primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        apiClient.post<{ social: SocialStateView }>(
                          `/api/social/friends/${request.id}/accept`,
                        ),
                      'Amizade aceita.',
                    )
                  }
                >
                  Aceitar
                </button>
                <button
                  className="button ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        apiClient.delete<{ social: SocialStateView }>(
                          `/api/social/friends/${request.id}`,
                        ),
                      'Solicitação recusada.',
                    )
                  }
                >
                  Recusar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="social-list-section">
        <h2>Amigos — {friends.length}</h2>
        {friends.length === 0 ? (
          <p className="empty-copy">Nenhum amigo adicionado ainda.</p>
        ) : (
          orderedFriends.map((friend) => (
            <div className="social-row" key={friend.id}>
              <Avatar
                displayName={friend.displayName}
                state={onlineIds.has(friend.id) ? 'online' : 'offline'}
              />
              <span>
                <strong>{friend.displayName}</strong>
                <small>@{friend.username}</small>
                <small>{onlineIds.has(friend.id) ? 'Online' : 'Offline'}</small>
              </span>
              <div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onMessage(friend)}
                >
                  Mensagem
                </button>
                <button
                  className="button ghost danger-text"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      () =>
                        apiClient.delete<{ social: SocialStateView }>(
                          `/api/social/friends/${friend.id}`,
                        ),
                      'Amizade removida.',
                    )
                  }
                >
                  Remover
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="social-list-section">
          <h2>Solicitações enviadas</h2>
          {outgoing.map((request) => (
            <div className="social-row" key={request.id}>
              <Avatar displayName={request.displayName} />
              <span>
                <strong>{request.displayName}</strong>
                <small>@{request.username}</small>
              </span>
              <button
                className="button ghost"
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      apiClient.delete<{ social: SocialStateView }>(
                        `/api/social/friends/${request.id}`,
                      ),
                    'Solicitação cancelada.',
                  )
                }
              >
                Cancelar
              </button>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

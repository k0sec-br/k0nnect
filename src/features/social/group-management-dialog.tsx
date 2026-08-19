import { useEffect, useState, type FormEvent } from 'react';

import type { ConversationSummary, FriendView, SocialStateView } from '../../../shared/types/api';
import { FormMessage } from '../../components/form-message';
import { apiClient } from '../../lib/api-client';

interface GroupManagementDialogProps {
  conversation: ConversationSummary;
  currentUserId: string;
  friends: FriendView[];
  onClose(): void;
  onChanged(state: SocialStateView): void;
  onLeft(): void;
}

export function GroupManagementDialog(props: GroupManagementDialogProps) {
  const onClose = props.onClose;
  const [name, setName] = useState(props.conversation.name);
  const [friendId, setFriendId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const isOwner = props.conversation.ownerUserId === props.currentUserId;
  const addableFriends = props.friends.filter(
    (friend) => !props.conversation.members.some((member) => member.id === friend.id),
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  async function mutate(
    action: () => Promise<{ social: SocialStateView }>,
    message: string,
  ): Promise<boolean> {
    setBusy(true);
    setFeedback('');
    try {
      const result = await action();
      setFeedback(message);
      props.onChanged(result.social);
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    await mutate(
      () =>
        apiClient.post<{ social: SocialStateView }>(
          `/api/social/groups/${props.conversation.id}/rename`,
          {
            name: name.trim(),
          },
        ),
      'Nome atualizado.',
    );
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="social-dialog group-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
      >
        <header>
          <div>
            <span className="eyebrow">GRUPO PRIVADO</span>
            <h2 id="group-settings-title">Configurar {props.conversation.name}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Fechar" onClick={props.onClose}>
            ×
          </button>
        </header>

        {isOwner && (
          <form onSubmit={(event) => void rename(event)}>
            <label htmlFor="rename-group">Nome do grupo</label>
            <div className="inline-social-form">
              <input
                id="rename-group"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={1}
                maxLength={40}
                required
              />
              <button className="button secondary" type="submit" disabled={busy || !name.trim()}>
                Salvar
              </button>
            </div>
          </form>
        )}

        <section className="dialog-section">
          <h3>Membros — {props.conversation.members.length}/20</h3>
          {props.conversation.members.map((member) => (
            <div className="dialog-member-row" key={member.id}>
              <span>
                <strong>{member.displayName}</strong>
                <small>@{member.username}</small>
              </span>
              {member.id === props.conversation.ownerUserId ? (
                <small>Owner</small>
              ) : isOwner ? (
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          apiClient.post<{ social: SocialStateView }>(
                            `/api/social/groups/${props.conversation.id}/transfer`,
                            { newOwnerId: member.id },
                          ),
                        'Propriedade transferida.',
                      )
                    }
                  >
                    Tornar owner
                  </button>
                  <button
                    className="danger-text"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          apiClient.delete<{ social: SocialStateView }>(
                            `/api/social/groups/${props.conversation.id}/members/${member.id}`,
                          ),
                        'Membro removido.',
                      )
                    }
                  >
                    Remover
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </section>

        {isOwner && addableFriends.length > 0 && props.conversation.members.length < 20 && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!friendId) return;
              void mutate(
                () =>
                  apiClient.post<{ social: SocialStateView }>(
                    `/api/social/groups/${props.conversation.id}/members`,
                    { userId: friendId },
                  ),
                'Membro adicionado.',
              ).then((changed) => {
                if (changed) setFriendId('');
              });
            }}
          >
            <label htmlFor="add-group-member">Adicionar amigo</label>
            <div className="inline-social-form">
              <select
                id="add-group-member"
                value={friendId}
                onChange={(event) => setFriendId(event.target.value)}
                required
              >
                <option value="">Selecione</option>
                {addableFriends.map((friend) => (
                  <option value={friend.id} key={friend.id}>
                    {friend.displayName} (@{friend.username})
                  </option>
                ))}
              </select>
              <button className="button secondary" type="submit" disabled={busy || !friendId}>
                Adicionar
              </button>
            </div>
          </form>
        )}

        {feedback && <FormMessage message={feedback} tone="success" />}
        <footer>
          {isOwner ? (
            <button
              className="button danger"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Apagar este grupo e todo o histórico de mensagens?')) return;
                void mutate(
                  () =>
                    apiClient.delete<{ social: SocialStateView }>(
                      `/api/social/groups/${props.conversation.id}`,
                    ),
                  'Grupo apagado.',
                ).then((changed) => {
                  if (changed) props.onLeft();
                });
              }}
            >
              Apagar grupo
            </button>
          ) : (
            <button
              className="button danger"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Sair deste grupo?')) return;
                void mutate(
                  () =>
                    apiClient.post<{ social: SocialStateView }>(
                      `/api/social/groups/${props.conversation.id}/leave`,
                    ),
                  'Você saiu do grupo.',
                ).then((changed) => {
                  if (changed) props.onLeft();
                });
              }}
            >
              Sair do grupo
            </button>
          )}
          <button className="button ghost" type="button" onClick={props.onClose}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}

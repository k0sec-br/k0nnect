let inviteToken: string | undefined;

export function setInviteToken(token: string): void {
  inviteToken = token;
}

export function consumeInviteToken(): string {
  if (inviteToken !== undefined) return inviteToken;

  inviteToken = window.location.hash.slice(1);
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
  return inviteToken;
}

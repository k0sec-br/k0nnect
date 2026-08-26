import { setInviteToken } from '../../features/auth/invite-memory';
import { navigate } from '../../lib/navigation';
import { isTauriApp } from '../platform/app-platform';

const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
export const NATIVE_CONVERSATION_EVENT = 'k0nnect:native-conversation';

let pendingConversationId: string | null = null;

export type NativeDeepLinkTarget =
  { type: 'conversation'; conversationId: string } | { type: 'invite'; token: string };

export function consumePendingNativeConversation(): string | null {
  const conversationId = pendingConversationId;
  pendingConversationId = null;
  return conversationId;
}

export function openNativeConversation(conversationId: string): boolean {
  if (!RESOURCE_ID_PATTERN.test(conversationId)) return false;
  pendingConversationId = conversationId;
  window.dispatchEvent(
    new CustomEvent<string>(NATIVE_CONVERSATION_EVENT, { detail: conversationId }),
  );
  navigate('/app');
  return true;
}

export function parseNativeDeepLink(rawUrl: string): NativeDeepLinkTarget | null {
  if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e')) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const customScheme = url.protocol === 'k0nnect:';
  const officialWebLink = url.protocol === 'https:' && url.origin === 'https://connect.k0sec.org';
  if (!customScheme && !officialWebLink) return null;

  const route = customScheme ? url.hostname : url.pathname.split('/')[1];
  const routeValue = customScheme
    ? url.pathname.replace(/^\//u, '')
    : url.pathname.split('/').slice(2).join('/');

  if (route === 'invite') {
    const token = routeValue || url.hash.slice(1);
    return INVITE_TOKEN_PATTERN.test(token) ? { type: 'invite', token } : null;
  }

  if (route === 'dm' && RESOURCE_ID_PATTERN.test(routeValue)) {
    return { type: 'conversation', conversationId: routeValue };
  }
  return null;
}

function applyDeepLink(rawUrl: string): void {
  const target = parseNativeDeepLink(rawUrl);
  if (!target) return;
  if (target.type === 'conversation') {
    openNativeConversation(target.conversationId);
    return;
  }
  setInviteToken(target.token);
  navigate('/invite');
}

export async function startNativeDeepLinkListener(): Promise<() => void> {
  if (!isTauriApp()) return () => undefined;

  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const currentUrls = await getCurrent();
  currentUrls?.forEach(applyDeepLink);
  return onOpenUrl((urls) => urls.forEach(applyDeepLink));
}

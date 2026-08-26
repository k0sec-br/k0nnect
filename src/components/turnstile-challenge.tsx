import { useEffect, useRef } from 'react';

import { isTauriApp } from '../core/platform/app-platform';

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileChallengeProps {
  siteKey: string;
  action: 'login' | 'recover' | 'register';
  onToken(token: string): void;
}

function WebTurnstileChallenge({ siteKey, action, onToken }: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let active = true;
    const render = () => {
      if (!active || !containerRef.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: 'dark',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT}"]`,
    );
    if (existingScript) {
      if (window.turnstile) render();
      else existingScript.addEventListener('load', render, { once: true });
    } else {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', render, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      active = false;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action, onToken, siteKey]);

  return (
    <div className="turnstile-slot" ref={containerRef} aria-label="Verificação de segurança" />
  );
}

function NativeTurnstileChallenge({ action, onToken }: TurnstileChallengeProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const receiveToken = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== 'https://connect.k0sec.org' ||
        event.source !== frameRef.current?.contentWindow ||
        !event.data ||
        typeof event.data !== 'object'
      ) {
        return;
      }
      const payload = event.data as { action?: unknown; source?: unknown; token?: unknown };
      if (
        payload.source === 'k0nnect-turnstile' &&
        payload.action === action &&
        typeof payload.token === 'string'
      ) {
        onToken(payload.token);
      }
    };
    window.addEventListener('message', receiveToken);
    return () => window.removeEventListener('message', receiveToken);
  }, [action, onToken]);

  const parentOrigin = encodeURIComponent(window.location.origin);
  return (
    <iframe
      ref={frameRef}
      className="turnstile-native-frame"
      src={`https://connect.k0sec.org/native/turnstile?action=${action}&parentOrigin=${parentOrigin}`}
      title="Verificação de segurança"
      sandbox="allow-forms allow-same-origin allow-scripts"
    />
  );
}

export function TurnstileChallenge(props: TurnstileChallengeProps) {
  return isTauriApp() ? (
    <NativeTurnstileChallenge {...props} />
  ) : (
    <WebTurnstileChallenge {...props} />
  );
}

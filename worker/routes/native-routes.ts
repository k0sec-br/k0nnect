import { Hono } from 'hono';

import type { AppBindings } from '../app-types';

const TURNSTILE_ACTIONS = new Set(['login', 'recover', 'register']);

function nativeAssetHeaders(contentType: string, cacheControl: string): Record<string, string> {
  return {
    'Cache-Control': cacheControl,
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

export const nativeRoutes = new Hono<AppBindings>();

nativeRoutes.get('/turnstile', (context) => {
  const action = context.req.query('action');
  const siteKey = context.env.TURNSTILE_SITE_KEY;
  if (!action || !TURNSTILE_ACTIONS.has(action) || !/^[A-Za-z0-9_-]{1,128}$/u.test(siteKey)) {
    return context.body(null, 404);
  }
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="turnstile-site-key" content="${siteKey}">
    <meta name="turnstile-action" content="${action}">
    <title>Verificação de segurança do k0nnect</title>
    <link rel="stylesheet" href="/native/turnstile.css">
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
    <script src="/native/turnstile.js" defer></script>
  </head>
  <body>
    <main>
      <h1>Verificação de segurança</h1>
      <div id="turnstile-container" aria-live="polite"></div>
    </main>
  </body>
</html>`;
  return context.body(html, 200, {
    ...nativeAssetHeaders('text/html; charset=UTF-8', 'no-store, max-age=0'),
    'Content-Security-Policy':
      "default-src 'none'; connect-src https://challenges.cloudflare.com; frame-ancestors http://tauri.localhost https://tauri.localhost tauri://localhost; frame-src https://challenges.cloudflare.com; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; base-uri 'none'; form-action 'none'",
  });
});

nativeRoutes.get('/turnstile.js', (context) => {
  const script = `(() => {
  const allowedParentOrigins = new Set([
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost'
  ]);
  const parentOrigin = new URLSearchParams(window.location.search).get('parentOrigin');
  const siteKey = document.querySelector('meta[name="turnstile-site-key"]')?.content;
  const action = document.querySelector('meta[name="turnstile-action"]')?.content;
  if (!parentOrigin || !allowedParentOrigins.has(parentOrigin) || !siteKey || !action) return;
  const sendToken = (token) => window.parent.postMessage(
    { source: 'k0nnect-turnstile', action, token },
    parentOrigin
  );
  window.turnstile?.render('#turnstile-container', {
    sitekey: siteKey,
    action,
    theme: 'dark',
    callback: sendToken,
    'expired-callback': () => sendToken(''),
    'error-callback': () => sendToken('')
  });
})();`;
  return context.body(
    script,
    200,
    nativeAssetHeaders('text/javascript; charset=UTF-8', 'public, max-age=3600'),
  );
});

nativeRoutes.get('/turnstile.css', (context) => {
  const stylesheet = `:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; background: #101010; color: #f5f5f5; }
main { display: grid; min-height: 100vh; align-content: center; justify-items: center; gap: 0.75rem; padding: 0.5rem; }
h1 { margin: 0; font-size: 0.75rem; font-weight: 500; color: #b8b8b8; }
#turnstile-container { min-height: 65px; }`;
  return context.body(
    stylesheet,
    200,
    nativeAssetHeaders('text/css; charset=UTF-8', 'public, max-age=3600'),
  );
});

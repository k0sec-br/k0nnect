import type { ApiResponse } from '../../shared/types/api';
import { notifySessionExpired } from '../core/auth/session-events';
import { isTauriApp } from '../core/platform/app-platform';
import { nativeApiRequest } from '../core/network/native-transport';
import { incrementDevelopmentMetric } from './development-metrics';

export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UserFacingError';
  }
}

class ApiClient {
  private csrfToken: string | null = null;

  setCsrfToken(token: string | null): void {
    this.csrfToken = token;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (init.method !== 'GET' && this.csrfToken) headers.set('X-CSRF-Token', this.csrfToken);

    incrementDevelopmentMetric('httpRequests');
    if (path.startsWith('/api/social/')) {
      incrementDevelopmentMetric(init.method === 'GET' ? 'd1Reads' : 'd1Writes');
    }
    if (path === '/api/realtime/session' && typeof init.body === 'string') {
      try {
        const action = (JSON.parse(init.body) as { action?: string }).action;
        incrementDevelopmentMetric('realtimeApiCalls', action === 'create' ? 2 : 1);
      } catch {
        // Request validation handles malformed payloads.
      }
    }
    let payload: ApiResponse<T>;
    let responseOk: boolean;
    if (isTauriApp()) {
      try {
        const response = await nativeApiRequest<T>(path, init, this.csrfToken);
        payload = response.payload;
        responseOk = response.status >= 200 && response.status < 300;
      } catch (caught) {
        const nativeError = caught as { code?: unknown; message?: unknown };
        throw new UserFacingError(
          typeof nativeError.message === 'string'
            ? nativeError.message
            : 'Não foi possível conectar ao k0nnect.',
          typeof nativeError.code === 'string' ? nativeError.code : 'NETWORK_UNAVAILABLE',
        );
      }
    } else {
      let response: Response;
      try {
        response = await fetch(path, { ...init, credentials: 'include', headers });
      } catch {
        throw new UserFacingError(
          'Não foi possível conectar ao k0nnect. Verifique sua internet e tente novamente.',
          'NETWORK_UNAVAILABLE',
        );
      }
      responseOk = response.ok;
      try {
        payload = await response.json();
      } catch {
        throw new UserFacingError(
          'Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.',
          'INTERNAL_ERROR',
        );
      }
    }
    if (!responseOk || !payload.ok) {
      const message = payload.ok
        ? 'Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.'
        : payload.error.message;
      const code = payload.ok ? 'INTERNAL_ERROR' : payload.error.code;
      if (code === 'AUTH_REQUIRED') notifySessionExpired();
      throw new UserFacingError(message, code);
    }
    return payload.data;
  }
}

export const apiClient = new ApiClient();

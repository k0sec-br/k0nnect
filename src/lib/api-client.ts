import type { ApiResponse } from '../../shared/types/api';
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

    let response: Response;
    try {
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
      response = await fetch(path, { ...init, credentials: 'include', headers });
    } catch {
      throw new UserFacingError(
        'Não foi possível conectar ao k0nnect. Verifique sua internet e tente novamente.',
        'NETWORK_UNAVAILABLE',
      );
    }

    let payload: ApiResponse<T>;
    try {
      payload = await response.json();
    } catch {
      throw new UserFacingError(
        'Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.',
        'INTERNAL_ERROR',
      );
    }
    if (!response.ok || !payload.ok) {
      const message = payload.ok
        ? 'Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.'
        : payload.error.message;
      const code = payload.ok ? 'INTERNAL_ERROR' : payload.error.code;
      throw new UserFacingError(message, code);
    }
    return payload.data;
  }
}

export const apiClient = new ApiClient();

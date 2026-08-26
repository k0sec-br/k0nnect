import { Channel, invoke } from '@tauri-apps/api/core';

import type { ApiResponse } from '../../../shared/types/api';
import { isTauriApp } from '../platform/app-platform';

const NATIVE_API_ORIGIN = 'https://connect.k0sec.org';

interface NativeApiResponse<T> {
  status: number;
  payload: ApiResponse<T>;
}

class NativeTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NativeTransportError';
  }
}

function parseNativeError(caught: unknown): NativeTransportError {
  if (
    caught &&
    typeof caught === 'object' &&
    'code' in caught &&
    'message' in caught &&
    typeof caught.code === 'string' &&
    typeof caught.message === 'string'
  ) {
    return new NativeTransportError(caught.code, caught.message);
  }
  return new NativeTransportError('NETWORK_UNAVAILABLE', 'Não foi possível conectar ao k0nnect.');
}

export async function nativeApiRequest<T>(
  path: string,
  init: RequestInit,
  csrfToken: string | null,
): Promise<NativeApiResponse<T>> {
  let body: unknown;
  if (typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      throw new NativeTransportError('INVALID_NATIVE_REQUEST', 'A solicitação não é válida.');
    }
  }
  try {
    return await invoke<NativeApiResponse<T>>('native_api_request', {
      request: {
        method: init.method ?? 'GET',
        path,
        ...(body === undefined ? {} : { body }),
        ...(csrfToken ? { csrfToken } : {}),
      },
    });
  } catch (caught) {
    throw parseNativeError(caught);
  }
}

type NativeSocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error' };

export interface RealtimeSocket extends EventTarget {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export const SOCKET_CONNECTING = 0;
export const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;

class NativeRealtimeSocket extends EventTarget implements RealtimeSocket {
  readyState = SOCKET_CONNECTING;
  private socketId: number | null = null;
  private closeRequest: { code: number; reason: string } | null = null;
  private pendingEvents: NativeSocketEvent[] = [];

  constructor(url: URL) {
    super();
    const nativeUrl = new URL(url.pathname + url.search, NATIVE_API_ORIGIN);
    nativeUrl.protocol = 'wss:';
    const events = new Channel<NativeSocketEvent>();
    events.onmessage = (event) => {
      if (this.socketId === null) {
        this.pendingEvents.push(event);
        return;
      }
      this.handleEvent(event);
    };
    void invoke<number>('native_socket_open', { url: nativeUrl.toString(), events })
      .then((socketId) => {
        this.socketId = socketId;
        for (const event of this.pendingEvents.splice(0)) this.handleEvent(event);
        if (this.closeRequest) {
          const { code, reason } = this.closeRequest;
          void this.requestClose(code, reason);
        }
      })
      .catch(() => {
        this.readyState = SOCKET_CLOSED;
        this.dispatchEvent(new Event('error'));
        this.dispatchEvent(new CloseEvent('close', { code: 4000, reason: 'Erro de transporte' }));
      });
  }

  send(data: string): void {
    if (this.readyState !== SOCKET_OPEN || this.socketId === null) {
      throw new DOMException('Conexão realtime indisponível.', 'InvalidStateError');
    }
    void invoke('native_socket_send', { socketId: this.socketId, data }).catch(() => {
      this.dispatchEvent(new Event('error'));
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === SOCKET_CLOSED || this.readyState === SOCKET_CLOSING) return;
    this.readyState = SOCKET_CLOSING;
    if (this.socketId === null) {
      this.closeRequest = { code, reason };
      return;
    }
    void this.requestClose(code, reason);
  }

  private async requestClose(code: number, reason: string): Promise<void> {
    if (this.socketId === null) return;
    try {
      await invoke('native_socket_close', { socketId: this.socketId, code, reason });
    } finally {
      if (this.readyState !== SOCKET_CLOSED) {
        this.readyState = SOCKET_CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code, reason }));
      }
    }
  }

  private handleEvent(event: NativeSocketEvent): void {
    if (event.type === 'open') {
      this.readyState = SOCKET_OPEN;
      this.dispatchEvent(new Event('open'));
      return;
    }
    if (event.type === 'message') {
      this.dispatchEvent(new MessageEvent('message', { data: event.data }));
      return;
    }
    if (event.type === 'error') {
      this.dispatchEvent(new Event('error'));
      return;
    }
    this.readyState = SOCKET_CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code: event.code, reason: event.reason }));
  }
}

export function createRealtimeSocket(url: URL): RealtimeSocket {
  return isTauriApp() ? new NativeRealtimeSocket(url) : new WebSocket(url);
}

import type { AuthenticatedSession } from './auth/session';

export interface AppBindings {
  Bindings: Env;
  Variables: {
    requestId: string;
    authenticated: AuthenticatedSession;
  };
}

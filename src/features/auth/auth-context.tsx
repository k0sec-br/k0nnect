import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { BootstrapView, PublicConfig, SessionUser } from '../../../shared/types/api';
import { apiClient } from '../../lib/api-client';

interface AuthContextValue {
  loading: boolean;
  user: SessionUser | null;
  bootstrap: Extract<BootstrapView, { authenticated: true }> | null;
  config: PublicConfig | null;
  login(username: string, password: string, turnstileToken?: string): Promise<void>;
  register(input: {
    inviteToken: string;
    username: string;
    displayName: string;
    password: string;
    turnstileToken?: string;
  }): Promise<string[]>;
  logout(all?: boolean): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<Extract<
    BootstrapView,
    { authenticated: true }
  > | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await apiClient.get<BootstrapView>('/api/bootstrap');
      setConfig(result.config);
      if (result.authenticated) {
        setUser(result.user);
        setBootstrap(result);
        apiClient.setCsrfToken(result.csrfToken);
      } else {
        setUser(null);
        setBootstrap(null);
        apiClient.setCsrfToken(null);
      }
    } catch {
      setUser(null);
      apiClient.setCsrfToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      user,
      bootstrap,
      config,
      refresh,
      async login(username, password, turnstileToken) {
        const result = await apiClient.post<{ user: SessionUser; csrfToken: string }>(
          '/api/auth/login',
          { username, password, ...(turnstileToken ? { turnstileToken } : {}) },
        );
        apiClient.setCsrfToken(result.csrfToken);
        setUser(result.user);
        await refresh();
      },
      async register(input) {
        const result = await apiClient.post<{
          user: SessionUser;
          csrfToken: string;
          recoveryCodes: string[];
        }>('/api/auth/register-invite', input);
        apiClient.setCsrfToken(result.csrfToken);
        setUser(result.user);
        await refresh();
        return result.recoveryCodes;
      },
      async logout(all = false) {
        await apiClient.post(all ? '/api/auth/logout-all' : '/api/auth/logout');
        apiClient.setCsrfToken(null);
        setUser(null);
        setBootstrap(null);
      },
    }),
    [bootstrap, config, loading, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}

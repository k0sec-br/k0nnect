import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { SessionUser } from '../../../shared/types/api';
import { apiClient } from '../../lib/api-client';

interface AuthContextValue {
  loading: boolean;
  user: SessionUser | null;
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

  const refresh = useCallback(async () => {
    try {
      const result = await apiClient.get<
        { authenticated: false } | { authenticated: true; user: SessionUser; csrfToken: string }
      >('/api/auth/session');
      if (result.authenticated) {
        setUser(result.user);
        apiClient.setCsrfToken(result.csrfToken);
      } else {
        setUser(null);
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
      refresh,
      async login(username, password, turnstileToken) {
        const result = await apiClient.post<{ user: SessionUser; csrfToken: string }>(
          '/api/auth/login',
          { username, password, ...(turnstileToken ? { turnstileToken } : {}) },
        );
        apiClient.setCsrfToken(result.csrfToken);
        setUser(result.user);
      },
      async register(input) {
        const result = await apiClient.post<{
          user: SessionUser;
          csrfToken: string;
          recoveryCodes: string[];
        }>('/api/auth/register-invite', input);
        apiClient.setCsrfToken(result.csrfToken);
        setUser(result.user);
        return result.recoveryCodes;
      },
      async logout(all = false) {
        await apiClient.post(all ? '/api/auth/logout-all' : '/api/auth/logout');
        apiClient.setCsrfToken(null);
        setUser(null);
      },
    }),
    [loading, refresh, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}

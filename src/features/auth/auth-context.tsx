import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type {
  BootstrapView,
  PublicConfig,
  SessionUser,
  SocialStateView,
} from '../../../shared/types/api';
import { SESSION_EXPIRED_EVENT } from '../../core/auth/session-events';
import { apiClient, UserFacingError } from '../../lib/api-client';

export type BootstrapFailure = 'network' | 'server' | null;

interface AuthContextValue {
  loading: boolean;
  user: SessionUser | null;
  bootstrap: Extract<BootstrapView, { authenticated: true }> | null;
  config: PublicConfig | null;
  bootstrapFailure: BootstrapFailure;
  sessionExpired: boolean;
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
  acknowledgeSessionExpiration(): void;
  updateSocialState(state: SocialStateView): void;
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
  const [bootstrapFailure, setBootstrapFailure] = useState<BootstrapFailure>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    setLoading(true);
    setBootstrapFailure(null);
    const pending = (async () => {
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
      } catch (caught) {
        setUser(null);
        setBootstrap(null);
        apiClient.setCsrfToken(null);
        setBootstrapFailure(
          caught instanceof UserFacingError && caught.code === 'NETWORK_UNAVAILABLE'
            ? 'network'
            : 'server',
        );
      } finally {
        setLoading(false);
      }
    })();
    refreshPromiseRef.current = pending;
    void pending.finally(() => {
      if (refreshPromiseRef.current === pending) refreshPromiseRef.current = null;
    });
    return pending;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleSessionExpiration = () => {
      apiClient.setCsrfToken(null);
      setSessionExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpiration);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpiration);
  }, []);

  const updateSocialState = useCallback((state: SocialStateView) => {
    setBootstrap((current) => (current ? { ...current, ...state } : current));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      bootstrapFailure,
      sessionExpired,
      user,
      bootstrap,
      config,
      refresh,
      acknowledgeSessionExpiration() {
        apiClient.setCsrfToken(null);
        setSessionExpired(false);
        setUser(null);
        setBootstrap(null);
      },
      updateSocialState,
      async login(username, password, turnstileToken) {
        setSessionExpired(false);
        const result = await apiClient.post<{ user: SessionUser; csrfToken: string }>(
          '/api/auth/login',
          { username, password, ...(turnstileToken ? { turnstileToken } : {}) },
        );
        apiClient.setCsrfToken(result.csrfToken);
        setUser(result.user);
        await refresh();
      },
      async register(input) {
        setSessionExpired(false);
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
        setSessionExpired(false);
      },
    }),
    [
      bootstrap,
      bootstrapFailure,
      config,
      loading,
      refresh,
      sessionExpired,
      updateSocialState,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}

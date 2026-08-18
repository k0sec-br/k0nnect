import { useEffect, useState } from 'react';

import { apiClient } from '../lib/api-client';

export interface PublicConfig {
  registrationMode: 'disabled' | 'invite' | 'public';
  realtimeEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    apiClient
      .get<PublicConfig>('/api/config')
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);
  return config;
}

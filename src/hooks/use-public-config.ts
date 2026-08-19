import type { PublicConfig } from '../../shared/types/api';
import { useAuth } from '../features/auth/auth-context';

export function usePublicConfig(): PublicConfig | null {
  return useAuth().config;
}

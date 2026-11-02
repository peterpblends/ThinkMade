import { useQuery } from '@tanstack/react-query';
import { DEFAULT_FEATURES, type FeatureKey } from '@thinkmade/shared';
import { api, type PublicSettings } from './api';

/** The public settings, shared by every screen that needs them. */
export function usePublicSettings() {
  return useQuery({ queryKey: ['settings', 'public'], queryFn: () => api<PublicSettings>('/api/settings/public'), staleTime: 60_000 });
}

/**
 * Which features an administrator has switched on. Until the settings arrive (or offline), features count as
 * on; the server refuses a switched-off feature anyway.
 */
export function useFeatures(): Record<FeatureKey, boolean> {
  const q = usePublicSettings();
  return { ...DEFAULT_FEATURES, ...q.data?.features };
}

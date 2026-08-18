import { useEffect } from 'react';

import { SettingsLayout } from '../components/settings-layout';
import { useAuth } from '../features/auth/auth-context';
import { AdminInvites } from '../features/invites/admin-invites';
import { navigate } from '../lib/navigation';

export function InvitesSettingsPage() {
  const { user } = useAuth();

  useEffect(() => {
    if (user?.role === 'member') navigate('/settings');
  }, [user]);

  if (!user || user.role === 'member') return null;

  return (
    <SettingsLayout active="invites">
      <AdminInvites user={user} />
    </SettingsLayout>
  );
}

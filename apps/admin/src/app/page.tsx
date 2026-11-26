import { redirect } from 'next/navigation';
import { AccessGate } from '@/components/access/access-gate';
import { entryGate } from '@/lib/access';
import { WORKSPACE_HOME } from '@/lib/workspace-access';

/** The admin app has no landing page: visitors go to sign-in or their default workspace. */
export default async function RootPage() {
  const gate = await entryGate();
  if (gate.access === 'sign_in') redirect('/login');
  if (gate.access === 'allowed') redirect(WORKSPACE_HOME[gate.workspace]);
  return <AccessGate {...gate} retryHref="/" />;
}

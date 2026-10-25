import { TokenPasswordForm } from '../token-forms';
import { activateMigratedAccount } from '../actions';
import { recordTokenLinkOpened } from '@/lib/activity/token-link-activity';

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (token) await recordTokenLinkOpened(token, 'migration_activation');
  return <TokenPasswordForm action={activateMigratedAccount} heading="Activate your IDOC account" token={token ?? ''} />;
}

import { TokenPasswordForm } from '../token-forms';
import { activateMigratedAccount } from '../actions';

export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <TokenPasswordForm action={activateMigratedAccount} heading="Activate your IDOC account" token={token ?? ''} />;
}

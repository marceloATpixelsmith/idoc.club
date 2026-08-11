import { AccountLinkForm } from '../token-forms';
import { requestMigrationActivation } from '../actions';

export default function RequestActivationPage() {
  return <AccountLinkForm action={requestMigrationActivation} heading="Activate an imported account" />;
}

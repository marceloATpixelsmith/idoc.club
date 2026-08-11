import { AccountLinkForm } from '../token-forms';
import { requestPasswordRecovery } from '../actions';

export default function RecoverPasswordPage() {
  return <AccountLinkForm action={requestPasswordRecovery} heading="Recover password" />;
}

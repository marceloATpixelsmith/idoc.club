'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { forceRevokeAllAuthorityForm, reinstateUserAccountForm, suspendUserAccountForm } from './actions';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type FormState = { error?: string; success?: string };
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function SuspendAccountForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(suspendUserAccountForm, {} as FormState);
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="userId" value={userId} />
    <p className="text-sm text-muted-foreground">Immediately blocks this user from signing in and revokes all active sessions and remembered devices.</p>
    <div className="space-y-1.5">
      <Label htmlFor="suspend-account-reason">Reason (required)</Label>
      <Textarea id="suspend-account-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit" variant="destructive">Suspend account</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}

const REINSTATE_ACCOUNT_STATES = ['active', 'onboarding', 'migrated_pending'] as const;
const REINSTATE_ACCOUNT_LABELS: Record<string, string> = {
  active: 'Active', migrated_pending: 'Migrated (pending verification)', onboarding: 'Onboarding',
};

export function ReinstateAccountForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(reinstateUserAccountForm, {} as FormState);
  return <form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="userId" value={userId} />
    <div className="space-y-1.5">
      <Label htmlFor="reinstate-account-state">Restore to state</Label>
      <select className={SELECT_CLASSNAME} defaultValue="active" id="reinstate-account-state" name="accountState" required>
        {REINSTATE_ACCOUNT_STATES.map((state) => <option key={state} value={state}>{REINSTATE_ACCOUNT_LABELS[state]}</option>)}
      </select>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="reinstate-account-reason">Reason (required)</Label>
      <Textarea id="reinstate-account-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit">Reinstate account</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>;
}

/** AUTH-OPERATIONS-007: incident response for a compromised account -- Super-Admin-only. Cuts every
 * live session, every remembered/trusted device, and every enrolled MFA factor for this user, but
 * (unlike suspending the account) leaves the account itself sign-in-eligible so its rightful owner
 * can regain control and re-enroll MFA once they have. */
export function ForceRevokeAllAuthorityForm({ userId }: { userId: number }) {
  const [state, action, pending, stepUpDialog] = useFreshStepUpAction(forceRevokeAllAuthorityForm, {});
  return <><form action={action} className="space-y-4">
    <CsrfField />
    <input type="hidden" name="userId" value={userId} />
    <p className="text-sm text-muted-foreground">Immediately revokes every session, remembered device, and MFA factor for this user (incident response). The account itself remains sign-in-eligible.</p>
    <div className="space-y-1.5">
      <Label htmlFor="incident-reference">Incident reference (required)</Label>
      <Input id="incident-reference" name="incidentReference" required type="text" />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="incident-reason">Reason (required)</Label>
      <Textarea id="incident-reason" name="reason" required rows={2} />
    </div>
    <Button disabled={pending} type="submit" variant="destructive">Force-revoke all authority</Button>
    {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    {state.success && <p className="text-sm text-green-400">{state.success}</p>}
  </form>{stepUpDialog}</>;
}

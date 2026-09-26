'use client';

import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { grantRoleForm, revokeRoleForm } from './actions';

type FormState = { error?: string; success?: string };
type Role = { id: number; role: string };
const SELECT_CLASSNAME = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

export function RolesSection({ activeRoles, userId }: { activeRoles: Role[]; userId: number }) {
  const [grantState, grantAction, grantPending, grantDialog] = useFreshStepUpAction(grantRoleForm, {});
  const [revokeState, revokeAction, revokePending, revokeDialog] = useFreshStepUpAction(revokeRoleForm, {});
  return <><div className="space-y-6">
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Currently active roles</p>
      {activeRoles.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
      {activeRoles.map((role) => (
        <form key={role.id} action={revokeAction} className="flex items-center gap-2">
          <CsrfField />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="role" value={role.role} />
          <span className="text-sm">{role.role}</span>
          <Input className="h-8 text-xs" name="reason" placeholder="Reason (required)" required />
          <Button disabled={revokePending} size="sm" type="submit" variant="outline">Revoke</Button>
        </form>
      ))}
      {revokeState.error && <p className="text-sm text-red-400">{revokeState.error}</p>}
      {revokeState.success && <p className="text-sm text-green-400">{revokeState.success}</p>}
    </div>
    <form action={grantAction} className="space-y-4">
      <CsrfField />
      <input type="hidden" name="userId" value={userId} />
      <div className="space-y-1.5">
        <Label htmlFor="grant-role">Grant role</Label>
        <select className={SELECT_CLASSNAME} defaultValue="administrator" id="grant-role" name="role" required>
          <option value="administrator">Administrator</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grant-role-reason">Reason (required)</Label>
        <Textarea id="grant-role-reason" name="reason" required rows={2} />
      </div>
      <Button disabled={grantPending} type="submit">Grant role</Button>
      {grantState.error && <p className="text-sm text-red-400">{grantState.error}</p>}
      {grantState.success && <p className="text-sm text-green-400">{grantState.success}</p>}
    </form>
  </div>{grantDialog}{revokeDialog}</>;
}

'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { grantRoleForm, revokeRoleForm } from './actions';

type FormState = { error?: string; success?: string };
type Role = { id: number; role: string };

export function RolesSection({ activeRoles, userId }: { activeRoles: Role[]; userId: number }) {
  const [grantState, grantAction, grantPending] = useActionState(grantRoleForm, {} as FormState);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeRoleForm, {} as FormState);
  return <div className="mt-2 max-w-md space-y-4">
    <div>
      <p className="text-sm font-medium">Currently active roles</p>
      {activeRoles.length === 0 && <p className="text-sm text-gray-500">None.</p>}
      {activeRoles.map((role) => (
        <form key={role.id} action={revokeAction} className="mt-1 flex items-center gap-2">
          <CsrfField />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="role" value={role.role} />
          <span className="text-sm">{role.role}</span>
          <input className="border p-1 text-xs" name="reason" placeholder="Reason (required)" required />
          <button className="rounded border px-2 py-1 text-xs" disabled={revokePending} type="submit">Revoke</button>
        </form>
      ))}
      {revokeState.error && <p className="text-sm text-red-600">{revokeState.error}</p>}
      {revokeState.success && <p className="text-sm text-green-700">{revokeState.success}</p>}
    </div>
    <form action={grantAction} className="space-y-2">
      <CsrfField />
      <input type="hidden" name="userId" value={userId} />
      <label className="block text-sm">Grant role
        <select className="mt-1 block w-full border p-2" defaultValue="administrator" name="role" required>
          <option value="administrator">Administrator</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </label>
      <label className="block text-sm">Reason (required)<textarea className="mt-1 block w-full border p-2" name="reason" required rows={2} /></label>
      <button className="rounded bg-blue-700 px-3 py-1 text-sm text-white" disabled={grantPending} type="submit">Grant role</button>
      {grantState.error && <p className="text-sm text-red-600">{grantState.error}</p>}
      {grantState.success && <p className="text-sm text-green-700">{grantState.success}</p>}
    </form>
  </div>;
}

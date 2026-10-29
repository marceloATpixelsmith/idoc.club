'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CsrfField } from '@/components/security/csrf-field';
import type { MembershipHealthCase } from '@/lib/membership/health-cases';
import { updateMembershipHealthCase } from './actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="idoc-primary-button px-4 py-2 text-sm" type="submit" disabled={pending}>
    {pending ? 'Saving…' : 'Save investigation'}
  </button>;
}

export function MembershipHealthCaseForm({ record }: { record: MembershipHealthCase }) {
  const [result, formAction] = useActionState(updateMembershipHealthCase, { error: null });
  const [status, setStatus] = useState(record.status);
  const [assignment, setAssignment] = useState('keep');
  const [note, setNote] = useState(record.resolution_note ?? '');
  const needsReason = status === 'resolved' || status === 'dismissed';
  const invalidReason = needsReason && note.trim().length < 10;

  return <form action={formAction} className="space-y-5 rounded-lg border p-5">
    <CsrfField/>
    <input type="hidden" name="id" value={record.id}/>
    <div>
      <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-status">Investigation status</label>
      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)} id="health-case-status" name="status" required>
        <option value="new">New</option><option value="investigating">Investigating</option>
        <option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
      </select>
    </div>
    <div>
      <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-assignment">Assigned administrator</label>
      <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={assignment} onChange={(event) => setAssignment(event.target.value)} id="health-case-assignment" name="assignment">
        <option value="keep">{record.assigned_email ? `Keep assigned: ${record.assigned_email}` : 'Leave unassigned'}</option>
        <option value="me">Assign to me</option>
        <option value="unassigned">Unassign</option>
      </select>
    </div>
    <div>
      <label className="mb-2 block text-sm font-semibold" htmlFor="health-case-note">Investigation / resolution notes</label>
      <textarea className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} id="health-case-note" maxLength={2000} name="resolutionNote" aria-invalid={invalidReason || !!result.error} aria-describedby="health-case-note-help"/>
      <p id="health-case-note-help" className="mt-1 text-xs text-muted-foreground">At least 10 characters are required when resolving or dismissing a case. Changes are audited.</p>
      {invalidReason && <p className="mt-1 text-sm text-red-600">Enter at least 10 characters before resolving or dismissing this case.</p>}
    </div>
    {result.error && <p role="alert" className="text-sm text-red-600">{result.error}</p>}
    <SaveButton/>
  </form>;
}

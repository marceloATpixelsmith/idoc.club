'use client';

import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { bulkDeleteAdminRows, type BulkDeleteState } from '@/app/(dashboard)/admin/bulk-actions';
import { useFreshStepUpAction } from '@/components/auth/fresh-step-up-action';
import { useDataTableMutation } from '@/components/data-table/data-table';
import { ActionBarItem } from '@/components/ui/action-bar';
import { useBrandedDialogs } from '@/components/ui/branded-dialogs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

export function BulkDeleteSelected({ clearSelection, ids, table }: {
  clearSelection: () => void;
  ids: string[];
  table: 'members' | 'news' | 'registrations' | 'seminars' | 'support';
}) {
  const [state, run, pending, challenge] = useFreshStepUpAction<BulkDeleteState>(bulkDeleteAdminRows, {});
  const mutation = useDataTableMutation();
  const { alert, confirm, dialogs } = useBrandedDialogs();
  const mutationStarted = useRef(false);
  const [reassignTo, setReassignTo] = useState('');
  const [reassignOpen, setReassignOpen] = useState(false);
  const reassignment = state.reassignment;

  useEffect(() => {
    if (!pending && mutationStarted.current) {
      mutationStarted.current = false;
      mutation.finish(Boolean(state.success));
      if (state.success) clearSelection();
      if (reassignment) {
        setReassignTo(String((reassignment.candidates.find((candidate) => candidate.isYou) ?? reassignment.candidates[0])?.id ?? ''));
        setReassignOpen(true);
      }
      if (state.error) alert(state.error, 'Could not delete');
    }
  // clearSelection is intentionally read only when a new result arrives; table instances recreate callbacks during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.error, state.success, state.reassignment, pending]);

  function submit(reassignAuthoredTo?: string) {
    mutationStarted.current = true;
    mutation.begin();
    const formData = new FormData();
    formData.set('csrf_token', readCsrfTokenFromDocumentCookie());
    formData.set('table', table);
    ids.forEach((id) => formData.append('id', id));
    if (reassignAuthoredTo) formData.set('reassign_to', reassignAuthoredTo);
    run(formData);
  }

  async function requestDelete(event: Event) {
    // Keep the ActionBar mounted while the server action/MFA dialog runs; otherwise its portal
    // would close and unmount the component that owns the pending destructive action.
    event.preventDefault();
    if (!ids.length || pending) return;
    const label = ids.length === 1 ? 'record' : 'records';
    const prompt = table === 'members' ? 'Permanently delete ' + ids.length + ' selected member' + (ids.length === 1 ? '' : 's') + '? Payment, profile-change, registration, and support history will be removed. Audit events will remain without an actor link.' : 'Delete ' + ids.length + ' selected ' + label + '? Existing financial, audit, and retention protections still apply.';
    if (!(await confirm({ title: table === 'members' ? 'Permanently delete members' : 'Delete selected records', message: prompt, confirmLabel: 'Delete', destructive: true }))) return;
    submit();
  }

  return <>
    <ActionBarItem disabled={pending} onSelect={requestDelete}>
      <Trash2 aria-hidden="true" className="mr-2 size-4" />
      {pending ? 'Deleting…' : 'Delete selected'}
    </ActionBarItem>
    {challenge}
    {dialogs}
    <Dialog onOpenChange={setReassignOpen} open={reassignOpen && Boolean(reassignment)}>
      <DialogContent aria-describedby="reassign-description" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Who should take over their content?</DialogTitle>
          <DialogDescription className="whitespace-pre-line" id="reassign-description">
            {reassignment?.accounts.map((account) => `• ${account.email}: ${account.sources.join(', ')}`).join('\n')}
            {'\n\nThis content keeps its author on record. Choose the administrator it will be attributed to; it is reassigned and the accounts are permanently deleted in one step.'}
          </DialogDescription>
        </DialogHeader>
        {reassignment?.candidates.length ? (
          <Select onValueChange={setReassignTo} value={reassignTo}>
            <SelectTrigger aria-label="Attribute content to" className="w-full"><SelectValue placeholder="Choose an administrator" /></SelectTrigger>
            <SelectContent>
              {reassignment.candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.email} ({candidate.role === 'super_admin' ? 'Super Admin' : 'Admin'}{candidate.isYou ? ', you' : ''})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : <p className="text-sm text-destructive">There is no other active administrator to take over this content.</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={() => setReassignOpen(false)} type="button" variant="outline">Cancel</Button>
          <Button disabled={!reassignTo || pending} onClick={() => { setReassignOpen(false); submit(reassignTo); }} type="button" variant="destructive">Reassign and delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

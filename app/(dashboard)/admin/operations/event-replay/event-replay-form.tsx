'use client';

import { useState } from 'react';

import { useFreshStepUpAction, type StepUpActionState } from '@/components/auth/fresh-step-up-action';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { DateTimePicker } from '@/components/forms/date-time-picker';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { lastDaysRange } from '@/lib/forms/local-moment';
import type { ReplayPreview, ReplayResult } from '@/lib/payments/stripe-event-replay';

export type EventReplayActionState = StepUpActionState & { error?: string; preview?: ReplayPreview; result?: ReplayResult };
type Action = (state: EventReplayActionState, formData: FormData) => Promise<EventReplayActionState>;

const STATUS_TEXT: Record<string, string> = {
  already_processed: 'already applied',
  blocked_earlier: 'received earlier but not applied (launch hold, or the member did not exist yet)',
  new: 'never received',
  superseded: 'skipped: a newer event for the same customer was already applied',
};
const money = (cents: number | null, currency: string | null) => cents === null ? '—' : `${(cents / 100).toFixed(2)} ${(currency ?? '').toUpperCase()}`;

export function EventReplayForm({ action, holdOn }: { action: Action; holdOn: boolean }) {
  const [state, run, pending, challenge] = useFreshStepUpAction<EventReplayActionState>(action, {});
  // An apply response carries no preview, so keep showing the one that was reviewed.
  const [preview, setPreview] = useState<ReplayPreview>();
  const shown = state.preview ?? preview;
  if (state.preview && state.preview !== preview) setPreview(state.preview);
  const phrase = shown ? `REPLAY ${shown.replayable} EVENTS` : '';
  return (
    <>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); run(new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)); }}>
        <CsrfField />
        <AdminFormSection description="Choose where to start, preview what Stripe has that this site does not, then confirm." title="Replay window">
        <div className="flex max-w-xl flex-col gap-2 text-sm font-medium text-foreground">
          <label htmlFor="replay-since">Replay events created since (within the last 29 days; use the moment the WordPress export was taken)</label>
          <DateTimePicker id="replay-since" name="since" {...lastDaysRange(29)} />
        </div>
        <Button disabled={pending} formNoValidate name="intent" type="submit" value="preview">{pending ? 'Working…' : 'Preview (changes nothing)'}</Button>
        </AdminFormSection>
        {shown ? (
          <AdminFormSection title="Preview result">
          <div className="space-y-3 text-sm" data-testid="event-replay-preview">
            <p className="text-foreground">
              Since {shown.since}: {shown.total} handled events in Stripe → <strong>{shown.replayable} to replay</strong> ({shown.counts.new} never received, {shown.counts.blocked_earlier} received earlier but not applied), {shown.counts.already_processed} already applied, {shown.counts.superseded} skipped as out of date.
            </p>
            {shown.events.length > 0 ? (
              <ul className="max-h-80 space-y-1 overflow-auto text-muted-foreground">
                {shown.events.map((row) => <li key={row.id}>{row.createdAt.slice(0, 16).replace('T', ' ')} · {row.type} · {money(row.amountCents, row.currency)} · {row.customerId ?? 'no customer'} · {STATUS_TEXT[row.status]}</li>)}
              </ul>
            ) : null}
            {shown.truncated ? <p className="text-muted-foreground">Only the first {shown.events.length} are listed.</p> : null}
            {holdOn ? <p className="text-amber-200" role="status">The member communications and billing hold is on, so events cannot be replayed yet. Release the hold first.</p> : null}
            {!holdOn && shown.replayable > 0 ? (
              <>
                <label className="flex max-w-xl flex-col gap-2 font-medium text-foreground">
                  Type <code>{phrase}</code> to confirm
                  <input autoComplete="off" className="rounded-md border border-border bg-background px-3 py-2 text-sm" name="confirmPhrase" required type="text" />
                </label>
                <input name="expected" type="hidden" value={shown.replayable} />
                <Button disabled={pending} name="intent" type="submit" value="apply" variant="destructive">{pending ? 'Working…' : 'Replay events now'}</Button>
              </>
            ) : null}
          </div>
          </AdminFormSection>
        ) : null}
      </form>
      {state.error ? <p className="mt-3 whitespace-pre-line text-sm text-red-300" role="alert">{state.error}</p> : null}
      {state.result ? (
        <p className="mt-4 rounded border border-emerald-400/40 bg-emerald-950/20 p-3 text-sm text-emerald-200" role="status">
          Replay finished: {state.result.processed} applied, {state.result.ignored} ignored, {state.result.skipped} skipped{state.result.failed.length > 0 ? `, ${state.result.failed.length} FAILED (${state.result.failed.slice(0, 5).map((item) => item.id).join(', ')}); run the preview again to retry them` : ''}.
        </p>
      ) : null}
      {challenge}
    </>
  );
}

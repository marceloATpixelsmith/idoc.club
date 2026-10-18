import type { ActionKind, ActionOutcome, PausedResolution, ResolutionAction, StripeMode } from '@/lib/payments/reconciliation-resolver';

export type ResolutionSummary = {
  actions?: ResolutionAction[]; counts?: Record<string, number>; paused?: PausedResolution[]; simulatedBecause?: 'safeguard'; stripeMode?: StripeMode; truncated?: boolean;
};

const LABEL: Record<ActionKind, { stripe: boolean; text: string }> = {
  subscription_status_synced: { stripe: false, text: 'Subscription status updated to match Stripe' },
  subscription_marked_canceled: { stripe: false, text: 'Subscription missing from Stripe marked cancelled' },
  renewal_change_completed: { stripe: false, text: 'Finished renewal change recorded' },
  renewal_change_reverted: { stripe: false, text: 'Renewal change that can no longer happen dropped' },
  seminar_payment_recorded: { stripe: false, text: 'Seminar payment confirmed by Stripe recorded' },
  orphan_subscription_canceled: { stripe: true, text: 'Orphaned Stripe subscription cancelled' },
  unlinked_customer_deleted: { stripe: true, text: 'Unlinked Stripe customer deleted' },
};
const OUTCOME_WORD: Record<ActionOutcome, string> = { applied: 'done', failed: 'failed (retried next scan)', simulated: 'simulated' };

/** What the last scan resolved by itself, so the findings below can be read as "only what needs a person". Stripe changes are simulated outside production. */
export function ResolutionPanel({ summary }: { summary: ResolutionSummary }) {
  const actions = summary.actions ?? [];
  const counts = summary.counts ?? {};
  // Totals come from the exact counts; the capped action list only feeds the expandable detail.
  const kinds = (Object.keys(LABEL) as ActionKind[]).filter((kind) => (['applied', 'simulated', 'failed'] as ActionOutcome[]).some((outcome) => (counts[`${kind}:${outcome}`] ?? 0) > 0));
  const simulated = summary.stripeMode === 'simulate';
  if (kinds.length === 0 && !(summary.paused?.length)) {
    return <p className="mt-1 text-sm text-muted-foreground">Nothing needed resolving automatically on that run.</p>;
  }
  return (
    <div className="mt-3 border-t pt-3">
      <h3 className="text-sm font-medium text-foreground">Resolved automatically before reporting</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {simulated && summary.simulatedBecause === 'safeguard'
          ? 'Changes to the website database were made. Changes to Stripe are switched off for now: the import-verified safeguard (RECONCILIATION_LIVE_STRIPE_ACTIONS) is not enabled, so they are listed as if done and removed from the findings below, but nothing was changed in Stripe. Enable the safeguard once the legacy import has been checked.'
          : simulated
          ? 'Changes to the website database were made. Changes to Stripe are only simulated in this environment: they are listed as if done, and removed from the findings below, but nothing was changed in Stripe. A production scan makes the same changes for real.'
          : 'Changes to the website database and to Stripe were made. Items resolved this way will not appear again.'}
      </p>
      <ul className="mt-2 space-y-2">
        {kinds.map((kind) => {
          const mine = actions.filter((action) => action.kind === kind);
          const label = LABEL[kind];
          const done = (counts[`${kind}:applied`] ?? 0) + (counts[`${kind}:simulated`] ?? 0);
          const failed = counts[`${kind}:failed`] ?? 0;
          const total = done + failed;
          return (
            <li key={kind}>
              <details>
                <summary className="cursor-pointer text-sm text-foreground">
                  {label.text}: {done.toLocaleString('en-GB')}{label.stripe && simulated ? ' (simulated)' : ''}
                  {failed > 0 ? `, ${failed.toLocaleString('en-GB')} failed` : ''}
                </summary>
                <ul className="mt-1 max-h-56 list-disc space-y-1 overflow-auto pl-5 text-xs text-muted-foreground">
                  {mine.slice(0, 100).map((action) => <li key={`${action.kind}-${action.id}`}><span className="font-mono">{action.id}</span> — {action.summary} ({OUTCOME_WORD[action.outcome]})</li>)}
                  {total > Math.min(mine.length, 100) ? <li>…and {(total - Math.min(mine.length, 100)).toLocaleString('en-GB')} more not listed here{summary.truncated ? ' (the stored detail is capped)' : ''}</li> : null}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      {(summary.paused ?? []).map((paused) => (
        <p className="mt-2 rounded-md border border-amber-400/50 bg-amber-950/20 p-2 text-xs text-amber-200" key={paused.kind} role="note">Paused by a safety check: {paused.reason}</p>
      ))}
    </div>
  );
}

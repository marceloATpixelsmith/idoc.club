import { notFound } from 'next/navigation';

import { EventReplayForm, type EventReplayActionState } from './event-replay-form';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { AuthorizationError, requireSuperAdmin } from '@/lib/membership/authorization';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { ReplayInputError } from '@/lib/payments/stripe-event-replay-core';
import { ReplayBlockedError, applyReplay, previewReplay } from '@/lib/payments/stripe-event-replay';
import { getStripeServerClient } from '@/lib/payments/stripe-client';
import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { requireCsrfToken } from '@/lib/security/csrf';

const PATH = '/admin/operations/event-replay';

async function eventReplayAction(_state: EventReplayActionState, formData: FormData): Promise<EventReplayActionState> {
  'use server';
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
    const since = String(formData.get('since') ?? '').trim();
    const stripe = getStripeServerClient();
    if (formData.get('intent') !== 'apply') return { preview: await previewReplay(stripe, since) };
    const stepUp = await requireFreshStepUp(actor, 'change-security-settings', PATH);
    if (stepUp.required) return { stepUpRequired: true };
    const result = await applyReplay({
      actorId: actor.id, confirmation: String(formData.get('confirmPhrase') ?? ''), expected: Number(formData.get('expected')), since, stripe,
    });
    return { result };
  } catch (error) {
    if (error instanceof ReplayInputError || error instanceof ReplayBlockedError || error instanceof AuthorizationError || (error instanceof Error && error.name === 'CsrfError')) return { error: error.message };
    return { error: 'Stripe could not be read, or the replay could not be completed. Nothing further was changed; run the preview again.' };
  }
}

export default async function EventReplayPage() {
  const actor = await requireAccountAccess('administration');
  try { requireSuperAdmin(actor); } catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  return (
    <main className="space-y-8 px-5 py-8 lg:px-8">
      <header className="space-y-2">
        <p className="eyebrow">Super Admin Operations</p>
        <h1 className="text-3xl font-semibold text-gold">Replay missed Stripe events</h1>
        <p className="max-w-3xl text-muted-foreground">
          Finds Stripe events from the last 30 days that this site never applied (the webhook endpoint did not exist yet, DNS pointed at the old site, or the launch hold consumed them) and applies them the way a live webhook would. A payment is recorded once and the paid-through date moves exactly as it would have. Nothing is written to Stripe. The preview changes nothing; applying needs the launch hold released, your authenticator code and a typed confirmation.
        </p>
      </header>
      <section className="space-y-4 rounded-lg border border-border bg-surface/40 p-5">
        <EventReplayForm action={eventReplayAction} holdOn={memberCommunicationsDisabled()} />
      </section>
    </main>
  );
}

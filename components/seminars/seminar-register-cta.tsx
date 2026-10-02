'use client';

import { useActionState, useEffect, useState } from 'react';
import { startGuestSeminarStripeCheckoutAction, type GuestStripeCheckoutState } from '@/app/(marketing)/seminars/actions';
import { registerAtNonMemberPriceAction, registerForSeminarAction, type MemberSeminarState } from '@/app/(dashboard)/dashboard/seminars/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { ArrowUpRight } from 'lucide-react';

/** The single full-width "Register" call to action on a seminar's detail page. A signed-in visitor
 * never re-enters identity data: their authenticated profile is the registration identity for every
 * payment method. Anonymous Stripe registration is Stripe-first; the IDOC guest form exists only
 * for anonymous bank-transfer/cash registrations. */
export function SeminarRegisterCta({ isSignedIn, memberDetails, memberPriceLabel, ownProfileDetails, paymentMethods, seminarId }: {
  isSignedIn: boolean;
  memberDetails?: { email: string; name: string };
  memberPriceLabel: string;
  ownProfileDetails?: { email: string; name: string };
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>;
  seminarId: number;
}) {
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [guestPaymentMethod, setGuestPaymentMethod] = useState<string | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [guestTurnstileToken, setGuestTurnstileToken] = useState('');
  const [guestCheckoutState, guestCheckoutAction, guestCheckoutPending] = useActionState<GuestStripeCheckoutState, FormData>(startGuestSeminarStripeCheckoutAction, {});
  const [memberState, memberAction, memberPending] = useActionState<MemberSeminarState, FormData>(registerForSeminarAction, {});
  const [nonMemberState, nonMemberAction, nonMemberPending] = useActionState<MemberSeminarState, FormData>(registerAtNonMemberPriceAction, {});
  useEffect(() => { if (guestCheckoutState.error) setGuestTurnstileToken(''); }, [guestCheckoutState]);
  useEffect(() => {
    const redirectTo = memberState.redirectTo ?? nonMemberState.redirectTo;
    if (redirectTo) window.location.replace(redirectTo);
  }, [memberState.redirectTo, nonMemberState.redirectTo]);
  const hasProfile = Boolean(memberDetails) || Boolean(ownProfileDetails);
  const knownVisitor = hasProfile || isSignedIn;

  const authenticatedAction = memberDetails ? memberAction : nonMemberAction;
  const authenticatedPending = memberDetails ? memberPending : nonMemberPending;
  const authenticatedState = memberDetails ? memberState : nonMemberState;

  return (
    <>
      <Button
        className="w-full text-xs uppercase tracking-[0.2em]"
        onClick={() => (knownVisitor ? setPaymentDialogOpen(true) : setJoinDialogOpen(true))}
        size="lg"
        type="button"
      >
        Register <ArrowUpRight aria-hidden className="ml-1 size-4" />
      </Button>
      <Dialog onOpenChange={setJoinDialogOpen} open={joinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register for this seminar</DialogTitle>
            <DialogDescription>Choose how you&apos;d like to register.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link href="/sign-up">Join to get member pricing of {memberPriceLabel}</Link>
            </Button>
            <Button
              className="w-full"
              onClick={() => { setJoinDialogOpen(false); setPaymentDialogOpen(true); }}
              type="button"
              variant="ghost"
            >
              Register as a guest <ArrowUpRight aria-hidden className="ml-1 size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={(open) => { setPaymentDialogOpen(open); if (!open) setGuestPaymentMethod(null); }} open={paymentDialogOpen}>
        <DialogContent>
          {guestPaymentMethod ? (
            <SeminarRegistrationForm embedded paymentMethod={guestPaymentMethod} seminarId={seminarId} />
          ) : (
            <>
              <DialogHeader><DialogTitle>Choose a payment method</DialogTitle><DialogDescription>Your choice applies only to this registration.</DialogDescription></DialogHeader>
              <div className="flex flex-col gap-3">
            {paymentMethods.map((method) => {
              const methodId = String(method.canonical_id);
              if (!hasProfile && methodId === 'online_stripe') {
                return (
                  <form action={guestCheckoutAction} className="w-full" key={`${methodId}-${guestCheckoutState.attempt ?? 0}`}>
                    <CsrfField />
                    <input name="seminarId" type="hidden" value={seminarId} />
                    <input name="turnstileToken" type="hidden" value={guestTurnstileToken} />
                    <Button className="h-8 w-full rounded-md border-dashed px-3 font-normal" data-idoc-table-control="" disabled={!guestTurnstileToken || guestCheckoutPending} type="submit" variant="outline">
                      {String(method.display_label)}
                    </Button>
                  {guestCheckoutState.error ? <p className="mt-2 text-sm text-destructive" role="alert">{guestCheckoutState.error}</p> : null}
                  </form>
                );
              }
              if (hasProfile) {
                return (
                  <form action={authenticatedAction} className="w-full" key={methodId}>
                    <CsrfField />
                    <input name="seminarId" type="hidden" value={seminarId} />
                    <input name="paymentMethod" type="hidden" value={methodId} />
                    <Button className="h-8 w-full rounded-md border-dashed px-3 font-normal" data-idoc-table-control="" disabled={authenticatedPending} type="submit" variant="outline">
                      {String(method.display_label)}
                    </Button>
                  </form>
                );
              }
              return (
                <Button className="h-8 rounded-md border-dashed px-3 font-normal" data-idoc-table-control="" key={methodId} onClick={() => setGuestPaymentMethod(methodId)} type="button" variant="outline">
                  {String(method.display_label)}
                </Button>
              );
            })}
            {authenticatedState.error ? <p className="text-sm text-destructive" role="alert">{authenticatedState.error}</p> : null}
            {!hasProfile ? <TurnstileWidget action="seminar_guest_registration" key={guestCheckoutState.attempt ?? 0} onVerify={setGuestTurnstileToken} theme="dark" /> : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

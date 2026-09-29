'use client';

import { useActionState, useEffect, useState } from 'react';
import { startGuestSeminarStripeCheckoutAction, type GuestStripeCheckoutState } from '@/app/(marketing)/seminars/actions';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';
import { CsrfField } from '@/components/security/csrf-field';
import { TurnstileWidget } from '@/components/turnstile-widget';

/** The single full-width "Register" call to action on a seminar's detail page. A signed-in visitor
 * (member or not) always goes straight to the registration form, pre-filled from whatever member
 * data is actually available. A signed-out visitor instead sees a branded choice first -- join to
 * unlock the member price, or continue straight to the same form as an anonymous guest -- rather
 * than a second, separately-styled panel. */
export function SeminarRegisterCta({ isSignedIn, memberDetails, memberPriceLabel, ownProfileDetails, paymentMethods, seminarId }: {
  isSignedIn: boolean;
  memberDetails?: { email: string; name: string };
  memberPriceLabel: string;
  ownProfileDetails?: { email: string; name: string };
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>;
  seminarId: number;
}) {
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [guestTurnstileToken, setGuestTurnstileToken] = useState('');
  const [guestCheckoutState, guestCheckoutAction, guestCheckoutPending] = useActionState<GuestStripeCheckoutState, FormData>(startGuestSeminarStripeCheckoutAction, {});
  useEffect(() => { if (guestCheckoutState.error) setGuestTurnstileToken(''); }, [guestCheckoutState]);
  const hasProfile = Boolean(memberDetails) || Boolean(ownProfileDetails);
  const knownVisitor = hasProfile || isSignedIn;

  if (selectedPaymentMethod) {
    return <SeminarRegistrationForm memberDetails={memberDetails} ownProfileDetails={ownProfileDetails} paymentMethod={selectedPaymentMethod} seminarId={seminarId} />;
  }

  return (
    <>
      <Button
        className="w-full text-xs uppercase tracking-[0.2em]"
        onClick={() => (knownVisitor ? setPaymentDialogOpen(true) : setJoinDialogOpen(true))}
        size="lg"
        type="button"
      >
        Register
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
              Register as a guest
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setPaymentDialogOpen} open={paymentDialogOpen}>
        <DialogContent>
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
                    <Button className="w-full" disabled={!guestTurnstileToken || guestCheckoutPending} type="submit" variant="outline">
                      {String(method.display_label)}
                    </Button>
                  {guestCheckoutState.error ? <p className="mt-2 text-sm text-destructive" role="alert">{guestCheckoutState.error}</p> : null}
                  </form>
                );
              }
              return (
                <Button key={methodId} onClick={() => { setSelectedPaymentMethod(methodId); setPaymentDialogOpen(false); }} type="button" variant="outline">
                  {String(method.display_label)}
                </Button>
              );
            })}
            {!hasProfile ? <TurnstileWidget action="seminar_guest_registration" key={guestCheckoutState.attempt ?? 0} onVerify={setGuestTurnstileToken} theme="dark" /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

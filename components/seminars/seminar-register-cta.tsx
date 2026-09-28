'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';

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
  const [revealed, setRevealed] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const knownVisitor = Boolean(memberDetails) || Boolean(ownProfileDetails) || isSignedIn;

  if (revealed) {
    return <SeminarRegistrationForm memberDetails={memberDetails} ownProfileDetails={ownProfileDetails} paymentMethod={paymentMethod!} seminarId={seminarId} />;
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
          <DialogHeader>
            <DialogTitle>How would you like to pay?</DialogTitle>
            <DialogDescription>Choose a payment method for this seminar registration.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {paymentMethods.map((method) => (
              <Button key={String(method.canonical_id)} onClick={() => { setPaymentMethod(String(method.canonical_id)); setPaymentDialogOpen(false); setRevealed(true); }} type="button" variant="outline">
                {String(method.display_label)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

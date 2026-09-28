'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SeminarRegistrationForm } from '@/components/seminars/seminar-registration-form';

/** The choice a visitor with no active member profile sees on a seminar's detail page: join IDOC
 * to unlock the member price, or continue as an anonymous guest at the non-member price -- no
 * account required. Choosing "Continue as a guest" swaps in the same registration form a member
 * would use (SeminarRegistrationForm), just with editable name/email instead of pre-filled ones. */
export function SeminarRegistrationPanel({ paymentMethods, seminarId }: {
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>; seminarId: number;
}) {
  const [showGuestForm, setShowGuestForm] = useState(false);

  if (showGuestForm) {
    return (
      <div className="space-y-4">
        <button className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setShowGuestForm(false)} type="button">← Back to registration options</button>
        <SeminarRegistrationForm paymentMethods={paymentMethods} seminarId={seminarId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Choose how you&apos;d like to register.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild className="flex-1">
          <Link href="/sign-up">Create an account</Link>
        </Button>
        <Button className="flex-1 border border-input" onClick={() => setShowGuestForm(true)} type="button" variant="ghost">
          Register as a guest
        </Button>
      </div>
    </div>
  );
}

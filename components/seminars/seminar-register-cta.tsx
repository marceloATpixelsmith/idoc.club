'use client';

import { useActionState, useEffect, useState } from 'react';
import { registerForSeminarAction, type MemberSeminarState } from '@/app/(dashboard)/dashboard/seminars/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CsrfField } from '@/components/security/csrf-field';
import { ArrowUpRight } from 'lucide-react';

/** The single full-width "Register" call to action on a seminar/course detail page. It is rendered
 * only for a signed-in, currently entitled member: their authenticated profile is the registration
 * identity for every payment method, and the server independently re-checks session, CSRF and
 * entitlement (UI visibility is never authorization). */
export function SeminarRegisterCta({ paymentMethods, seminarId }: {
  paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>;
  seminarId: number;
}) {
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [state, action, pending] = useActionState<MemberSeminarState, FormData>(registerForSeminarAction, {});
  useEffect(() => {
    if (state.redirectTo) window.location.replace(state.redirectTo);
  }, [state.redirectTo]);

  return (
    <>
      <Button className="w-full text-xs uppercase tracking-[0.2em]" onClick={() => setPaymentDialogOpen(true)} size="lg" type="button">
        Register <ArrowUpRight aria-hidden className="ml-1 size-4" />
      </Button>
      <Dialog onOpenChange={setPaymentDialogOpen} open={paymentDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Choose a payment method</DialogTitle><DialogDescription>Your choice applies only to this registration.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            {paymentMethods.map((method) => {
              const methodId = String(method.canonical_id);
              return (
                <form action={action} className="w-full" key={methodId}>
                  <CsrfField />
                  <input name="seminarId" type="hidden" value={seminarId} />
                  <input name="paymentMethod" type="hidden" value={methodId} />
                  <Button className="h-8 w-full rounded-md border-dashed px-3 font-normal" data-idoc-table-control="" disabled={pending} type="submit" variant="outline">
                    {String(method.display_label)}
                  </Button>
                </form>
              );
            })}
            {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

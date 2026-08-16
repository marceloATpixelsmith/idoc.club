'use server';

import { recordManualPayment } from '@/lib/payments/manual-payments';

type ManualPaymentActionState = { error?: string; success?: string };

export async function recordManualPaymentForm(_state: ManualPaymentActionState, formData: FormData): Promise<ManualPaymentActionState> {
  try {
    await recordManualPayment({
      paidAt: formData.get('paidAt'),
      profileId: formData.get('profileId'),
      reason: formData.get('reason'),
      reference: formData.get('reference'),
      source: formData.get('source'),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') return { error: 'Review the payment fields.' };
    if (error instanceof Error && error.name === 'AuthorizationError') return { error: 'You are not authorized to record payments.' };
    return { error: 'The payment could not be recorded.' };
  }
  return { success: 'Payment recorded.' };
}

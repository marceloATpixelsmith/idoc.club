'use server';

import { recordManualPayment } from '@/lib/payments/manual-payments';
import { getSession } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';

type ManualPaymentActionState = { error?: string; success?: string };

export async function recordManualPaymentForm(_state: ManualPaymentActionState, formData: FormData): Promise<ManualPaymentActionState> {
  try {
    await requireCsrfToken(formData, (await getSession())?.sessionId ?? null);
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
    if (error instanceof Error && error.name === 'CsrfError') return { error: error.message };
    return { error: 'The payment could not be recorded.' };
  }
  return { success: 'Payment recorded.' };
}

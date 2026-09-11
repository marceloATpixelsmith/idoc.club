'use server';

import { recordManualPayment } from '@/lib/payments/manual-payments';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireCsrfToken } from '@/lib/security/csrf';
import { requireFreshStepUp } from '@/lib/auth/mfa/step-up';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { refundMembershipPayment } from '@/lib/payments/refunds';

type ManualPaymentActionState = { error?: string; stepUpRequired?: boolean; success?: string };

export async function recordManualPaymentForm(_state: ManualPaymentActionState, formData: FormData): Promise<ManualPaymentActionState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
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

export async function refundMembershipPaymentForm(_state: ManualPaymentActionState, formData: FormData): Promise<ManualPaymentActionState> {
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    if ((await requireFreshStepUp(actor, 'change-security-settings', `/admin/payments?profileId=${formData.get('profileId')}`)).required) return { stepUpRequired: true };
    await refundMembershipPayment(formData.get('paymentId'), formData.get('reason'));
    return { success: 'Stripe completed the approved full membership refund. Original payment history was preserved.' };
  } catch (error) {
    if (error instanceof Error && ['AuthorizationError', 'CsrfError', 'RefundError'].includes(error.name)) return { error: error.message };
    return { error: 'The membership refund could not be completed.' };
  }
}

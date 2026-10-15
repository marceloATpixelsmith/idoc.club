'use server';

import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import {
  EMAIL_PREVIEW_DEFINITIONS,
  sendAllEmailPreviews,
  sendEmailPreview,
} from '@/lib/notifications/email-previews';
import { requireCsrfToken } from '@/lib/security/csrf';

export type PreviewSendState = {
  message: string;
  status: 'idle' | 'sent' | 'failed';
};

export async function sendPreviewForm(
  _previous: PreviewSendState,
  formData: FormData,
): Promise<PreviewSendState> {
  //ENFORCE THE ENVIRONMENT AND PRIVILEGE BOUNDARIES FOR EVERY SEND.
  if (process.env.VERCEL_ENV === 'production') {
    return { message: 'Email previews are unavailable in production.', status: 'failed' };
  }

  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
  } catch {
    return { message: 'The preview request could not be completed safely.', status: 'failed' };
  }

  const id = String(formData.get('previewId') ?? '');
  if (id === 'all') {
    const results = await sendAllEmailPreviews();
    const failed = results.filter((result) => result.status === 'failed');
    return {
      message: failed.length
        ? `Sent ${results.length - failed.length} of ${results.length} previews. Failed: ${failed.map((item) => item.label).join(', ')}.`
        : `All ${results.length} preview emails were accepted for delivery.`,
      status: failed.length ? 'failed' : 'sent',
    };
  }

  const preview = EMAIL_PREVIEW_DEFINITIONS.find((entry) => entry.id === id);
  if (!preview) {
    return { message: 'Choose a valid email preview.', status: 'failed' };
  }

  try {
    await sendEmailPreview(id);
    return { message: `${preview.label} was accepted for delivery.`, status: 'sent' };
  } catch {
    //NEVER EXPOSE INTERNAL PROVIDER ERRORS OR SECRET CONFIGURATION IN THE RESPONSE.
    return { message: `${preview.label} could not be sent. Retry the individual preview.`, status: 'failed' };
  }
}

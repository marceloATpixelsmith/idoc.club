'use server';

import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import { EMAIL_PREVIEW_DEFINITIONS, sendAllEmailPreviews, sendEmailPreview } from '@/lib/notifications/email-previews';
import { requireCsrfToken } from '@/lib/security/csrf';

export type EmailPreviewState = { error?: string; success?: string };

function environmentAllowed() {
  return process.env.VERCEL_ENV !== 'production';
}

export async function sendEmailPreviewAction(
  _state: EmailPreviewState,
  formData: FormData,
): Promise<EmailPreviewState> {
  try {
    if (!environmentAllowed()) return { error: 'Email previews are disabled in production.' };
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);

    const previewId = String(formData.get('previewId') ?? '');
    if (previewId === 'all') {
      const count = await sendAllEmailPreviews();
      return { success: `Sent ${count} preview emails to zangfuqi@gmail.com.` };
    }
    if (!EMAIL_PREVIEW_DEFINITIONS.some((preview) => preview.id === previewId)) {
      return { error: 'Choose a valid email preview.' };
    }
    await sendEmailPreview(previewId);
    return { success: 'Preview email sent to zangfuqi@gmail.com.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return { error: 'Super Admin authorization is required.' };
    }
    if (error instanceof Error && error.name === 'CsrfError') return { error: error.message };
    return { error: 'The preview email could not be sent.' };
  }
}

import { notFound } from 'next/navigation';
import { EmailPreviewSender } from './email-preview-sender';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import { EMAIL_PREVIEW_DEFINITIONS, EMAIL_PREVIEW_RECIPIENT } from '@/lib/notifications/email-previews';

export default async function AdminEmailPreviewsPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);

  return (
    <main className="flex-1 px-5 py-8 lg:px-8">
      <h1 className="text-3xl font-semibold text-gold">Email previews</h1>
      <p className="mt-3 max-w-3xl text-base text-muted-foreground">
        Send the real current transactional-email templates to {EMAIL_PREVIEW_RECIPIENT} without creating users,
        OTP records, payments, seminar registrations, or other workflow state. Preview links and codes are samples
        and are intentionally not valid.
      </p>
      <EmailPreviewSender previews={EMAIL_PREVIEW_DEFINITIONS} />
    </main>
  );
}

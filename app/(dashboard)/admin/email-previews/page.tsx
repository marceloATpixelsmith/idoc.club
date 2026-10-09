import { notFound, redirect } from 'next/navigation';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import {
  EMAIL_PREVIEW_DEFINITIONS,
  EMAIL_PREVIEW_RECIPIENT,
  sendAllEmailPreviews,
  sendEmailPreview,
} from '@/lib/notifications/email-previews';
import { requireCsrfToken } from '@/lib/security/csrf';

type PreviewSearchParams = {
  error?: string;
  failed?: string;
  sent?: string;
  sentCount?: string;
};

async function sendPreviewForm(formData: FormData) {
  'use server';

  if (process.env.VERCEL_ENV === 'production') redirect('/admin');
  try {
    await requireCsrfToken(formData, await rawCanonicalSessionId(), await rawCanonicalUserId());
    const actor = await requireAccountAccess('administration');
    requireSuperAdmin(actor);
  } catch {
    redirect('/admin/email-previews?error=authorization');
  }

  const previewId = String(formData.get('previewId') ?? '');
  if (previewId === 'all') {
    const results = await sendAllEmailPreviews();
    const failed = results.filter((result) => result.status === 'failed').map((result) => result.id);
    const sentCount = results.length - failed.length;
    const params = new URLSearchParams({ sent: 'all', sentCount: String(sentCount) });
    if (failed.length) params.set('failed', failed.join(','));
    redirect(`/admin/email-previews?${params.toString()}`);
  }

  if (!EMAIL_PREVIEW_DEFINITIONS.some((preview) => preview.id === previewId)) {
    redirect('/admin/email-previews?error=invalid');
  }

  try {
    await sendEmailPreview(previewId);
    redirect(`/admin/email-previews?sent=${encodeURIComponent(previewId)}`);
  } catch {
    redirect(`/admin/email-previews?failed=${encodeURIComponent(previewId)}`);
  }
}

export default async function AdminEmailPreviewsPage({
  searchParams,
}: {
  searchParams: Promise<PreviewSearchParams>;
}) {
  if (process.env.VERCEL_ENV === 'production') notFound();
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);

  const params = await searchParams;
  const failedIds = (params.failed ?? '').split(',').filter(Boolean);
  const failedLabels = failedIds
    .map((id) => EMAIL_PREVIEW_DEFINITIONS.find((preview) => preview.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  const singleSent = params.sent && params.sent !== 'all'
    ? EMAIL_PREVIEW_DEFINITIONS.find((preview) => preview.id === params.sent)?.label
    : null;
  const categories = Array.from(new Set(EMAIL_PREVIEW_DEFINITIONS.map((preview) => preview.category)));

  return (
    <main className="flex-1 px-5 py-8 lg:px-8">
      <h1 className="text-3xl font-semibold text-gold">Email Previews</h1>
      <p className="mt-3 max-w-3xl text-base text-muted-foreground">
        Send the real current transactional-email templates to {EMAIL_PREVIEW_RECIPIENT} without creating users,
        OTP records, payments, seminar registrations, or other workflow state. Preview links and codes are samples
        and are intentionally not valid.
      </p>

      {params.sent === 'all' ? (
        <div className="mt-5 rounded-lg border border-border bg-surface p-4 text-sm text-foreground">
          Sent {params.sentCount ?? '0'} of {EMAIL_PREVIEW_DEFINITIONS.length} preview emails.
          {failedLabels.length ? (
            <p className="mt-2 text-red-400">Failed: {failedLabels.join(', ')}. You can retry those templates individually.</p>
          ) : (
            <p className="mt-2 text-green-400">Every preview was accepted for delivery.</p>
          )}
        </div>
      ) : null}
      {singleSent ? <p className="mt-5 text-sm text-green-400">{singleSent} was accepted for delivery.</p> : null}
      {params.sent !== 'all' && failedLabels.length ? (
        <p className="mt-5 text-sm text-red-400">{failedLabels.join(', ')} could not be sent. Retry the individual preview.</p>
      ) : null}
      {params.error ? <p className="mt-5 text-sm text-red-400">The preview request could not be completed safely.</p> : null}

      <form action={sendPreviewForm} className="mt-6 rounded-lg border border-border bg-surface p-5">
        <CsrfField />
        <input name="previewId" type="hidden" value="all" />
        <h2 className="text-lg font-bold uppercase tracking-wider text-gold">Send all previews</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sends every preview independently. If one delivery fails, the remaining previews still run and the failed
          templates are listed afterward so they can be retried individually without guessing what succeeded.
        </p>
        <Button className="mt-4 rounded-full" type="submit">Send all preview emails</Button>
      </form>

      <div className="mt-8 space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="text-lg font-bold uppercase tracking-wider text-gold">{category}</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {EMAIL_PREVIEW_DEFINITIONS.filter((preview) => preview.category === category).map((preview) => (
                <form action={sendPreviewForm} className="rounded-lg border border-border bg-surface p-4" key={preview.id}>
                  <CsrfField />
                  <input name="previewId" type="hidden" value={preview.id} />
                  <p className="font-medium text-foreground">{preview.label}</p>
                  <Button className="mt-3 rounded-full" size="sm" type="submit">Send preview</Button>
                </form>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

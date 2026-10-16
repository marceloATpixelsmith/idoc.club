import { notFound } from 'next/navigation';
import { PreviewSendForm } from '@/app/(dashboard)/admin/email-previews/preview-send-form';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';
import { EMAIL_PREVIEW_DEFINITIONS, EMAIL_PREVIEW_RECIPIENT } from '@/lib/notifications/email-previews';

export default async function AdminEmailPreviewsPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  const categories = Array.from(new Set(EMAIL_PREVIEW_DEFINITIONS.map((preview) => preview.category)));

  return (
    <main className="flex-1 px-5 py-8 lg:px-8">
      <h1 className="text-3xl font-semibold text-gold">Email Previews</h1>
      <p className="mt-3 max-w-3xl text-base text-muted-foreground">
        Send the real current transactional-email templates to {EMAIL_PREVIEW_RECIPIENT} without creating users,
        OTP records, payments, seminar registrations, or other workflow state. Preview links and codes are samples
        and are intentionally not valid.
      </p>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-bold uppercase tracking-wider text-gold">Send all previews</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sends every preview independently. Failed templates are listed afterward so you can retry them individually.
        </p>
        <PreviewSendForm className="mt-4" id="all" label="Send all preview emails" />
      </section>

      <div className="mt-8 space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="text-lg font-bold uppercase tracking-wider text-gold">{category}</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {EMAIL_PREVIEW_DEFINITIONS.filter((preview) => preview.category === category).map((preview) => (
                <div className="rounded-lg border border-border bg-surface p-4" key={preview.id}>
                  <p className="font-medium text-foreground">{preview.label}</p>
                  <PreviewSendForm className="mt-3" id={preview.id} label="Send preview" size="sm" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

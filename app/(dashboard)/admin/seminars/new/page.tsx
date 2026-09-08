import Link from 'next/link';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { listEnabledSeminarPaymentMethods } from '@/lib/seminars/seminars';
import { createSeminarAction } from '../actions';

export default async function NewSeminarPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  const paymentMethods = await listEnabledSeminarPaymentMethods();
  return (
    <main className="space-y-6 py-8 px-5 lg:px-8">
      <Link className="underline" href="/admin/seminars">← Seminars</Link>
      <h1 className="text-2xl font-semibold">New seminar</h1>
      <SeminarForm action={createSeminarAction} submitLabel="Create seminar">
        <SeminarFieldset paymentMethods={paymentMethods} />
      </SeminarForm>
    </main>
  );
}

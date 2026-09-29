import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { createSeminarAction } from '../actions';

export default async function NewSeminarPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return (
    <main className="space-y-6 py-8 px-5 lg:px-8">
      <Link className="underline" href="/admin/seminars">← Seminars</Link>
      <h1 className="text-3xl font-semibold text-gold">New seminar</h1>
      <SeminarForm action={createSeminarAction} submitLabel="Create seminar">
        <SeminarFieldset />
      </SeminarForm>
    </main>\n    </AdminFormDrawer>\n  );
}

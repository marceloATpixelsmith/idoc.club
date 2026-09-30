import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { SeminarFieldset } from '@/components/seminars/seminar-fieldset';
import { SeminarForm } from '@/components/seminars/seminar-form';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireAdministrator } from '@/lib/membership/authorization';
import { createSeminarAction } from '../actions';

export default async function NewSeminarPage() {
  const actor = await requireAccountAccess('administration');
  requireAdministrator(actor);
  return (
    <AdminFormDrawer closeHref="/admin/seminars" title="New seminar">
      <main className="space-y-6 px-5 py-8 lg:px-8">
        <SeminarForm action={createSeminarAction} submitLabel="Create seminar">
          <SeminarFieldset />
        </SeminarForm>
      </main>
    </AdminFormDrawer>
  );
}

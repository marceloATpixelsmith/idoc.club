import { SupportForm } from '@/components/support/support-form';
import { CATEGORY_LABELS, listCategoryDefaults, listEligibleAdministrators, SUPPORT_CATEGORIES } from '@/lib/support/inbox';
import { updateSupportCategoryDefault } from '../actions';

export default async function SupportDefaultsPage() {
  const [defaults, administrators] = await Promise.all([listCategoryDefaults(), listEligibleAdministrators()]);
  return <main className="space-y-6 py-8 px-5 lg:px-8"><header><h1 className="text-2xl font-semibold">Support category defaults</h1><p className="text-muted-foreground">Defaults apply only to conversations created after a change.</p></header>
    <div className="grid gap-4 md:grid-cols-3">{SUPPORT_CATEGORIES.map((category) => { const current = defaults.find((row) => row.category === category); return <section className="rounded-lg border p-4" key={category}><h2 className="mb-3 font-semibold">{CATEGORY_LABELS[category]}</h2><SupportForm action={updateSupportCategoryDefault} submitLabel="Save default"><input name="category" type="hidden" value={category} /><label>Default administrator<select className="mt-1 block w-full border p-2" defaultValue={String(current?.assignment_key ?? '')} name="administratorId" required><option disabled value="">Select administrator</option>{administrators.map((admin) => <option key={String(admin.assignment_key)} value={String(admin.assignment_key)}>{String(admin.display_name)}</option>)}</select></label></SupportForm></section>; })}</div>
  </main>;
}

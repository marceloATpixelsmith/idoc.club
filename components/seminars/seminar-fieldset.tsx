import { TimezoneInput } from '@/components/seminars/timezone-input';

type ExistingSeminar = {
  capacity: number; description: string; end_time: string; location: string; payment_method_canonical_id: string;
  price_cents: number; registration_deadline: string | Date; seminar_date: string; start_time: string; status: string; timezone: string; title: string;
};

function toDatetimeLocalUtc(value: unknown): string {
  return new Date(String(value)).toISOString().slice(0, 16);
}

export function SeminarFieldset({ allowCanceled = false, lockPriceAndMethod = false, paymentMethods, seminar }: {
  allowCanceled?: boolean; lockPriceAndMethod?: boolean; paymentMethods: Array<{ canonical_id: unknown; display_label: unknown }>; seminar?: ExistingSeminar;
}) {
  const statuses = allowCanceled ? (['draft', 'published', 'canceled'] as const) : (['draft', 'published'] as const);
  const statusLabels: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };
  return (
    <>
      <label className="block">Title<input className="mt-1 block w-full border p-2" defaultValue={seminar?.title} maxLength={200} name="title" required /></label>
      <label className="block">Description
        <textarea className="mt-1 block min-h-32 w-full border p-2" defaultValue={seminar?.description} maxLength={10000} name="description" required />
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">Date<input className="mt-1 block w-full border p-2" defaultValue={seminar?.seminar_date} name="seminarDate" required type="date" /></label>
        <label className="block">Start time<input className="mt-1 block w-full border p-2" defaultValue={seminar?.start_time?.slice(0, 5)} name="startTime" required type="time" /></label>
        <label className="block">End time<input className="mt-1 block w-full border p-2" defaultValue={seminar?.end_time?.slice(0, 5)} name="endTime" required type="time" /></label>
      </div>
      <label className="block">Timezone<TimezoneInput defaultValue={seminar?.timezone} /></label>
      <label className="block">Location or online meeting link
        <textarea className="mt-1 block w-full border p-2" defaultValue={seminar?.location} maxLength={2000} name="location" required />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">Capacity<input className="mt-1 block w-full border p-2" defaultValue={seminar?.capacity} min={1} name="capacity" required type="number" /></label>
        <label className="block">Price (EUR)
          <input className="mt-1 block w-full border p-2" defaultValue={seminar ? (seminar.price_cents / 100).toFixed(2) : undefined} disabled={lockPriceAndMethod} min={0} name="price" required step="0.01" type="number" />
          {lockPriceAndMethod ? <p className="text-xs text-muted-foreground">Price cannot change once this seminar has registrations.</p> : null}
        </label>
      </div>
      <label className="block">Registration deadline (UTC)
        <input className="mt-1 block w-full border p-2" defaultValue={seminar ? toDatetimeLocalUtc(seminar.registration_deadline) : undefined} name="registrationDeadline" required type="datetime-local" />
      </label>
      <label className="block">Payment method
        <select className="mt-1 block w-full border p-2" defaultValue={seminar?.payment_method_canonical_id} disabled={lockPriceAndMethod} name="paymentMethodId" required>
          {paymentMethods.map((method) => <option key={String(method.canonical_id)} value={String(method.canonical_id)}>{String(method.display_label)}</option>)}
        </select>
        {lockPriceAndMethod ? <p className="text-xs text-muted-foreground">The payment method cannot change once this seminar has registrations.</p> : null}
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Status</legend>
        {statuses.map((value) => (
          <label className="flex items-center gap-2" key={value}><input defaultChecked={seminar ? seminar.status === value : value === 'draft'} name="status" type="radio" value={value} />{statusLabels[value]}</label>
        ))}
      </fieldset>
    </>
  );
}

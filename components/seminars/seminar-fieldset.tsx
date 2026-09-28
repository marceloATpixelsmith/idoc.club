import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TimezoneInput } from '@/components/seminars/timezone-input';

type ExistingSeminar = {
  capacity: number; description: string; end_date: string; end_time: string; is_fei: boolean; location: string;
  member_price_cents: number; non_member_price_cents: number; registration_deadline: string | Date;
  start_date: string; start_time: string; status: string; timezone: string; title: string;
};

function toDatetimeLocalUtc(value: unknown): string {
  return new Date(String(value)).toISOString().slice(0, 16);
}

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };

export function SeminarFieldset({ allowCanceled = false, lockPrices = false, seminar }: {
  allowCanceled?: boolean; lockPrices?: boolean; seminar?: ExistingSeminar;
}) {
  const statuses = allowCanceled ? (['draft', 'published', 'canceled'] as const) : (['draft', 'published'] as const);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input defaultValue={seminar?.title} id="title" maxLength={200} name="title" required />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="description">Directors and Application Details</Label>
            <Textarea className="min-h-32" defaultValue={seminar?.description} id="description" maxLength={10000} name="description" required />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="location">Location or online meeting link</Label>
            <Textarea defaultValue={seminar?.location} id="location" maxLength={2000} name="location" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="capacity">Capacity</Label>
            <Input defaultValue={seminar?.capacity} id="capacity" min={1} name="capacity" required type="number" />
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <TimezoneInput defaultValue={seminar?.timezone} />
          </div>
          <div className="col-span-2">
            <Label className="flex items-center gap-2 font-normal">
              <input defaultChecked={seminar?.is_fei ?? false} name="isFei" type="checkbox" />
              FEI seminar
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">Shows the FEI logo on this seminar's listing card and detail page.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <Input defaultValue={seminar?.start_date} id="startDate" name="startDate" required type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startTime">Start time</Label>
            <Input defaultValue={seminar?.start_time?.slice(0, 5)} id="startTime" name="startTime" required type="time" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End date</Label>
            <Input defaultValue={seminar?.end_date} id="endDate" name="endDate" required type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endTime">End time</Label>
            <Input defaultValue={seminar?.end_time?.slice(0, 5)} id="endTime" name="endTime" required type="time" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="registrationDeadline">Registration deadline (UTC)</Label>
            <Input defaultValue={seminar ? toDatetimeLocalUtc(seminar.registration_deadline) : undefined} id="registrationDeadline" name="registrationDeadline" required type="datetime-local" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Pricing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="memberPrice">Member price (EUR)</Label>
            <Input defaultValue={seminar ? (seminar.member_price_cents / 100).toFixed(2) : undefined} disabled={lockPrices} id="memberPrice" min={0} name="memberPrice" required step="0.01" type="number" />
            {/* A disabled input is omitted from FormData entirely -- without this hidden mirror,
              * submitting the form with lockPrices on (any seminar with registrations) would send no
              * memberPrice at all, failing validation and blocking every edit, including cancellation. */}
            {lockPrices && seminar ? <input name="memberPrice" type="hidden" value={(seminar.member_price_cents / 100).toFixed(2)} /> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nonMemberPrice">Non-member price (EUR)</Label>
            <Input defaultValue={seminar ? (seminar.non_member_price_cents / 100).toFixed(2) : undefined} disabled={lockPrices} id="nonMemberPrice" min={0} name="nonMemberPrice" required step="0.01" type="number" />
            {lockPrices && seminar ? <input name="nonMemberPrice" type="hidden" value={(seminar.non_member_price_cents / 100).toFixed(2)} /> : null}
          </div>
          {lockPrices ? <p className="col-span-2 text-xs text-muted-foreground">Prices cannot change once this seminar has registrations.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset className="flex flex-wrap gap-4">
            {statuses.map((value) => (
              <Label className="flex items-center gap-2 font-normal" key={value}>
                <input defaultChecked={seminar ? seminar.status === value : value === 'draft'} name="status" type="radio" value={value} />
                {STATUS_LABELS[value]}
              </Label>
            ))}
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}

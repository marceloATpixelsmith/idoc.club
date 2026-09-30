import { RichTextEditor } from '@/components/rich-text-editor';
import { FormGrid, FormSection } from '@/components/forms/form-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { COUNTRY_OPTIONS } from '@/lib/membership/countries';
import { LANGUAGE_OPTIONS } from '@/lib/seminars/language';

type ExistingSeminar = {
  accommodation_information: string; application: string; capacity: number; course_directors: string; course_venue_information: string;
  end_date: string; is_fei: boolean; language: string; levels: string[]; location: string; member_price_cents: number;
  non_member_price_cents: number; organizing_national_federation: string; participant_profile: string;
  registration_deadline: string | Date; start_date: string; status: string; title: string;
};

const STATUS_LABELS: Record<string, string> = { canceled: 'Canceled', draft: 'Draft', published: 'Published' };
const LEVEL_OPTIONS = [{ label: 'Level 1', value: 'level_1' }, { label: 'Level 2', value: 'level_2' }, { label: 'Level 3', value: 'level_3' }, { label: 'All Levels', value: 'all_levels' }] as const;

export function SeminarFieldset({ allowCanceled = false, lockPrices = false, seminar }: { allowCanceled?: boolean; lockPrices?: boolean; seminar?: ExistingSeminar }) {
  const statuses = allowCanceled ? (['draft', 'published', 'canceled'] as const) : (['draft', 'published'] as const);
  return <div className="grid max-w-6xl gap-6 xl:grid-cols-2">
    <FormSection title="Core information"><FormGrid>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="title">Title</Label><Input defaultValue={seminar?.title} id="title" maxLength={200} name="title" required /></div>
      <div className="space-y-1.5"><Label htmlFor="language">Language</Label><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" defaultValue={seminar?.language ?? 'en'} id="language" name="language" required>{LANGUAGE_OPTIONS.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="organizingNationalFederation">Organizing National Federation</Label><select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" defaultValue={seminar?.organizing_national_federation ?? ''} id="organizingNationalFederation" name="organizingNationalFederation" required><option disabled value="">Select federation</option>{COUNTRY_OPTIONS.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="location">Location or online meeting link</Label><Textarea defaultValue={seminar?.location} id="location" maxLength={2000} name="location" required /></div>
      <div className="max-w-48 space-y-1.5"><Label className="whitespace-nowrap" htmlFor="capacity">Number of participants</Label><Input defaultValue={seminar?.capacity} id="capacity" min={1} name="capacity" required type="number" /></div>
      <div><div className="mb-6 flex items-center gap-3"><label className="relative inline-flex h-6 w-11 cursor-pointer items-center"><input className="peer sr-only" defaultChecked={seminar?.is_fei ?? false} id="isFei" name="isFei" type="checkbox" /><span className="absolute inset-0 rounded-full bg-muted transition peer-checked:bg-primary" /><span className="relative ml-1 h-4 w-4 rounded-full bg-background transition-transform peer-checked:translate-x-5" /></label><Label className="font-normal" htmlFor="isFei">FEI seminar</Label></div><fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm font-medium">Levels</legend>{LEVEL_OPTIONS.map(({ label, value }) => <Label className="flex items-center gap-2 font-normal" key={value}><input defaultChecked={seminar?.levels?.includes(value) ?? false} name="levels" type="checkbox" value={value} />{label}</Label>)}</fieldset></div>
    </FormGrid></FormSection>

    <div className="grid content-start gap-6">
<FormSection title="Status"><fieldset className="flex flex-wrap gap-4">{statuses.map((value) => <Label className="flex items-center gap-2 font-normal" key={value}><input defaultChecked={seminar ? seminar.status === value : value === 'draft'} name="status" type="radio" value={value} />{STATUS_LABELS[value]}</Label>)}</fieldset></FormSection>
<FormSection title="Schedule"><FormGrid className="sm:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="startDate">Start date</Label><Input defaultValue={seminar?.start_date} id="startDate" name="startDate" required type="date" /></div>
      <div className="space-y-1.5"><Label htmlFor="endDate">End date</Label><Input defaultValue={seminar?.end_date} id="endDate" name="endDate" required type="date" /></div>
      <div className="space-y-1.5"><Label htmlFor="registrationDeadline">Registration deadline</Label><Input defaultValue={seminar ? new Date(String(seminar.registration_deadline)).toISOString().slice(0, 10) : undefined} id="registrationDeadline" name="registrationDeadline" required type="date" /></div>
    </FormGrid></FormSection>

    <FormSection title="Pricing"><FormGrid>{([['memberPrice', 'Member price (EUR)', seminar?.member_price_cents], ['nonMemberPrice', 'Non-member price (EUR)', seminar?.non_member_price_cents]] as const).map(([name, label, cents]) => <div className="max-w-48 space-y-1.5" key={name}><Label htmlFor={name}>{label}</Label><Input defaultValue={cents === undefined ? undefined : (cents / 100).toFixed(2)} disabled={lockPrices} id={name} min={0} name={name} required step="0.01" type="number" />{lockPrices && cents !== undefined ? <input name={name} type="hidden" value={(cents / 100).toFixed(2)} /> : null}</div>)}{lockPrices ? <p className="text-xs text-muted-foreground sm:col-span-2">Prices cannot change once this seminar has registrations.</p> : null}</FormGrid></FormSection>
    </div>
    <div className="xl:col-span-2"><FormSection title="Seminar information"><div className="grid gap-6 lg:grid-cols-2">
      <RichTextEditor initialHtml={seminar?.course_directors} label="Course Directors" name="courseDirectors" />
      <RichTextEditor initialHtml={seminar?.participant_profile} label="Participant Profile" name="participantProfile" />
      <RichTextEditor initialHtml={seminar?.course_venue_information} label="Course Venue Information" name="courseVenueInformation" />
      <RichTextEditor initialHtml={seminar?.application} label="Application" name="application" />
      <RichTextEditor initialHtml={seminar?.accommodation_information} label="Accommodation Information" name="accommodationInformation" />
    </div></FormSection></div>

  </div>;
}

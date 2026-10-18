'use client';

import { useState } from 'react';
import { SingleDatePicker } from '@/components/forms/us-date-input';
import { localMomentToUtc } from '@/lib/forms/local-moment';

const pad = (value: number) => String(value).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, index) => pad(index));
const MINUTES = Array.from({ length: 60 }, (_, index) => pad(index));
const SELECT = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

type DateTimePickerProps = { id: string; max?: string; min?: string; name: string };

/** Shared date and time picker for forms that need a moment in time (docs/29). The date opens the shared calendar; the time is two selects. The person chooses in their own
 * local time; the field submits the UTC equivalent as `YYYY-MM-DDTHH:MM` under `name` and shows what that is, so there is no time-zone arithmetic to do by hand. */
export function DateTimePicker({ id, max, min, name }: DateTimePickerProps) {
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('00');
  const [minute, setMinute] = useState('00');
  const utc = localMomentToUtc(date, hour, minute);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44"><SingleDatePicker id={id} max={max} min={min} name={`${name}Date`} onChange={setDate} required={false} value={date} /></div>
        <select aria-label="Hour" className={SELECT} onChange={(event) => setHour(event.target.value)} value={hour}>{HOURS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <span aria-hidden>:</span>
        <select aria-label="Minute" className={SELECT} onChange={(event) => setMinute(event.target.value)} value={minute}>{MINUTES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </div>
      <p className="text-xs text-muted-foreground">{utc ? `Your local time; that is ${utc.replace('T', ' ')} UTC.` : 'Choose a date, then the time, in your own local time.'}</p>
      <input name={name} type="hidden" value={utc} />
    </div>
  );
}

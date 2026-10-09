'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const ROLE_VALUES = ['judge', 'steward', 'veterinarian'] as const;
type AudienceValue = 'public' | 'members' | (typeof ROLE_VALUES)[number];

function normalizedInitial(values: readonly string[] | undefined): AudienceValue[] {
  const valid = (values ?? []).filter((value): value is AudienceValue =>
    ['public', 'members', ...ROLE_VALUES].includes(value as AudienceValue),
  );
  if (valid.includes('public')) return ['public'];
  if (valid.includes('members')) return ['members'];
  const roles = valid.filter((value): value is (typeof ROLE_VALUES)[number] => ROLE_VALUES.includes(value as (typeof ROLE_VALUES)[number]));
  return roles.length ? roles : ['public'];
}

export function ArticleAccessField({ initialAudience }: { initialAudience?: readonly string[] }) {
  const [selected, setSelected] = useState<AudienceValue[]>(() => normalizedInitial(initialAudience));

  function toggle(value: AudienceValue, checked: boolean) {
    if (value === 'public' || value === 'members') {
      setSelected(checked ? [value] : ['public']);
      return;
    }

    setSelected((current) => {
      const roleValues = current.filter((item): item is (typeof ROLE_VALUES)[number] => ROLE_VALUES.includes(item as (typeof ROLE_VALUES)[number]));
      const nextRoles = checked ? [...new Set([...roleValues, value])] : roleValues.filter((item) => item !== value);
      return nextRoles.length ? nextRoles : ['public'];
    });
  }

  const options: Array<{ label: string; value: AudienceValue }> = [
    { label: 'Public', value: 'public' },
    { label: 'All logged-in Members', value: 'members' },
    { label: 'Judge', value: 'judge' },
    { label: 'Steward', value: 'steward' },
    { label: 'Veterinarian', value: 'veterinarian' },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Member access</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {options.map(({ label, value }) => (
          <Label className="flex items-center gap-2 font-normal" key={value}>
            <Checkbox
              checked={selected.includes(value)}
              name="audience"
              onCheckedChange={(checked) => toggle(value, checked === true)}
              value={value}
            />
            {label}
          </Label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Public and All logged-in Members are exclusive. Judge, Steward, and Veterinarian can be combined.
      </p>
    </fieldset>
  );
}

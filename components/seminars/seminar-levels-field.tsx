'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';

export const LEVEL_OPTIONS = [
  { label: 'Level 1', value: 'level_1' },
  { label: 'Level 2', value: 'level_2' },
  { label: 'Level 3', value: 'level_3' },
  { label: 'All Levels', value: 'all_levels' },
] as const;

//ONLY ALL LEVELS IS EXCLUSIVE; UNCHECKING IT DOES NOT IMPLICITLY SELECT ANY OTHER LEVEL.
export function SeminarLevelsField({ initialLevels = [] }: { initialLevels?: string[] }) {
  const [selected, setSelected] = useState<string[]>(initialLevels.includes('all_levels') ? ['all_levels'] : initialLevels.filter((value) => value !== 'all_levels'));
  function toggle(value: string, checked: boolean) {
    if (value === 'all_levels') {
      setSelected(checked ? ['all_levels'] : []);
      return;
    }
    setSelected((previous) => checked
      ? [...previous.filter((item) => item !== 'all_levels' && item !== value), value]
      : previous.filter((item) => item !== value));
  }
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium">Levels</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {LEVEL_OPTIONS.map(({ label, value }) => (
          <Label className="flex items-center gap-2 font-normal" key={value}>
            <input
              checked={selected.includes(value)}
              name="levels"
              onChange={(event) => toggle(value, event.target.checked)}
              type="checkbox"
              value={value}
            />
            {label}
          </Label>
        ))}
      </div>
    </fieldset>
  );
}

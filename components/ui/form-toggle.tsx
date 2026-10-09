'use client';

import type { ChangeEventHandler } from 'react';
import { Label } from '@/components/ui/label';

type FormToggleProps = {
  checked?: boolean;
  className?: string;
  defaultChecked?: boolean;
  description?: string;
  id: string;
  label: string;
  name: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  value?: string;
};

export function FormToggle({
  checked,
  className = '',
  defaultChecked,
  description,
  id,
  label,
  name,
  onChange,
  value = 'on',
}: FormToggleProps) {
  return (
    <div className={`flex items-start gap-3 ${className}`.trim()}>
      <label className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center" htmlFor={id}>
        <input
          checked={checked}
          className="peer sr-only"
          defaultChecked={defaultChecked}
          id={id}
          name={name}
          onChange={onChange}
          type="checkbox"
          value={value}
        />
        <span className="absolute inset-0 rounded-full border border-input bg-muted transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:border-gold peer-checked:bg-gold" />
        <span className="relative ml-1 h-4 w-4 rounded-full bg-foreground transition-transform peer-checked:translate-x-5 peer-checked:bg-background" />
      </label>
      <div className="min-w-0">
        <Label className="font-normal" htmlFor={id}>{label}</Label>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

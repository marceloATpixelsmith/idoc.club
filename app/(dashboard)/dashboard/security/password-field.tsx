'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type PasswordFieldProps = {
  autoComplete: string;
  id: string;
  label: string;
  maxLength?: number;
  minLength?: number;
  name: string;
  required?: boolean;
};

/** A constrained-width password input with a visibility toggle, so a member can check what they
 * typed instead of needing a separate confirmation field. */
export function PasswordField({ autoComplete, id, label, maxLength, minLength, name, required }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <Label className="mb-2" htmlFor={id}>{label}</Label>
      <div className="relative max-w-xs">
        <Input autoComplete={autoComplete} className="pr-10" id={id} maxLength={maxLength} minLength={minLength}
          name={name} required={required} type={visible ? 'text' : 'password'} />
        <button
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
          onClick={() => setVisible((value) => !value)}
          type="button"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

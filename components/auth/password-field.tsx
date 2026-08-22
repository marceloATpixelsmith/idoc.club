'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shared password input + visibility toggle, reused by every password field across signup, login,
 * and password reset (both "create a new password" and "enter your existing password") — a single
 * eye/eye-off icon button, no confirm-password field needed because of the toggle. */
export function PasswordField({
  autoComplete, autoFocus, label, name = 'password', onChange, placeholder = 'Enter your password', value,
}: {
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  label: string;
  name?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  value?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <Label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor={name}>{label}</Label>
      <div className="relative">
        <Input
          autoComplete={autoComplete} autoFocus={autoFocus} className="pr-10" id={name} name={name}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder}
          required type={visible ? 'text' : 'password'} value={value}
        />
        <button
          aria-label={visible ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-gray-500 hover:text-gray-700"
          onClick={() => setVisible((current) => !current)} type="button"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

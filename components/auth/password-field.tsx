'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export function PasswordField({
  autoComplete,
  autoFocus,
  label,
  name = 'password',
  onChange,
  placeholder = 'Enter your password',
  value,
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
    <div className="idoc-auth-field">
      <label className="idoc-auth-label" htmlFor={name}>{label}</label>
      <div className="idoc-auth-password">
        <input
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className="idoc-auth-input"
          id={name}
          name={name}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          placeholder={placeholder}
          required
          type={visible ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="idoc-auth-password__toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff aria-hidden className="h-5 w-5" /> : <Eye aria-hidden className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

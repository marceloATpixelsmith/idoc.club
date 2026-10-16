'use client';

import { useActionState } from 'react';
import { sendPreviewForm, type PreviewSendState } from '@/app/(dashboard)/admin/email-previews/actions';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';

const INITIAL_STATE: PreviewSendState = { message: '', status: 'idle' };

export function PreviewSendForm({
  className,
  id,
  label,
  size,
}: {
  className?: string;
  id: string;
  label: string;
  size?: 'sm';
}) {
  const [state, action, pending] = useActionState(sendPreviewForm, INITIAL_STATE);

  return (
    <form action={action} className={className}>
      <CsrfField />
      <input name="previewId" type="hidden" value={id} />
      <Button
        aria-busy={pending}
        className="rounded-full"
        disabled={pending}
        size={size}
        type="submit"
      >
        {pending ? 'Sending…' : label}
      </Button>
      {state.message ? (
        <p
          aria-live="polite"
          className={`mt-3 text-sm ${state.status === 'sent' ? 'text-green-400' : 'text-red-400'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

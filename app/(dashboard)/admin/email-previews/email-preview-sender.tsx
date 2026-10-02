'use client';

import { useActionState } from 'react';
import { CsrfField } from '@/components/security/csrf-field';
import { Button } from '@/components/ui/button';
import {
  sendEmailPreviewAction,
  type EmailPreviewState,
} from './actions';

type Preview = { category: string; id: string; label: string };

const initialState: EmailPreviewState = {};

export function EmailPreviewSender({ previews }: { previews: Preview[] }) {
  const [state, action, pending] = useActionState(sendEmailPreviewAction, initialState);
  const categories = Array.from(new Set(previews.map((preview) => preview.category)));

  return (
    <div className="mt-6 space-y-8">
      <form action={action} className="rounded-lg border border-border bg-surface p-5">
        <CsrfField />
        <input name="previewId" type="hidden" value="all" />
        <h2 className="text-lg font-bold uppercase tracking-wider text-gold">Send all previews</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sends one copy of every current user-facing transactional email template to zangfuqi@gmail.com using safe sample data.
        </p>
        <Button className="mt-4 rounded-full" disabled={pending} type="submit">
          {pending ? 'Sending…' : 'Send all preview emails'}
        </Button>
      </form>

      {categories.map((category) => (
        <section key={category}>
          <h2 className="text-lg font-bold uppercase tracking-wider text-gold">{category}</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {previews.filter((preview) => preview.category === category).map((preview) => (
              <form action={action} className="rounded-lg border border-border bg-surface p-4" key={preview.id}>
                <CsrfField />
                <input name="previewId" type="hidden" value={preview.id} />
                <p className="font-medium text-foreground">{preview.label}</p>
                <Button className="mt-3 rounded-full" disabled={pending} size="sm" type="submit">
                  {pending ? 'Sending…' : 'Send preview'}
                </Button>
              </form>
            ))}
          </div>
        </section>
      ))}

      {state.error ? <p className="text-sm text-red-400">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-400">{state.success}</p> : null}
    </div>
  );
}

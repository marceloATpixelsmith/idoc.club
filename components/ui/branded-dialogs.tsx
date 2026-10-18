'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type ConfirmOptions = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean };
type ConfirmState = ConfirmOptions & { resolve: (accepted: boolean) => void };

/** Branded replacements for the browser's alert() and confirm(), using the same dialog as the authenticator prompt. Render `dialogs`
 * once in the component that calls them. `confirm` resolves true only when the person presses the confirm button; Escape, Cancel or
 * clicking away resolves false. Messages keep their line breaks. */
export function useBrandedDialogs() {
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null);

  const alert = useCallback((message: string, title = 'Please note') => setNotice({ title, message }), []);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    setConfirmation((previous) => { previous?.resolve(false); return { ...options, resolve }; });
  }), []);

  const answer = (accepted: boolean) => {
    confirmation?.resolve(accepted);
    setConfirmation(null);
  };

  const dialogs: ReactNode = (
    <>
      <Dialog onOpenChange={(open) => { if (!open) setNotice(null); }} open={notice !== null}>
        <DialogContent aria-describedby="branded-notice-description" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{notice?.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line" id="branded-notice-description">{notice?.message}</DialogDescription>
          </DialogHeader>
          <Button autoFocus className="w-full" onClick={() => setNotice(null)} type="button">OK</Button>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={(open) => { if (!open) answer(false); }} open={confirmation !== null}>
        <DialogContent aria-describedby="branded-confirm-description" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirmation?.title ?? 'Please confirm'}</DialogTitle>
            <DialogDescription className="whitespace-pre-line" id="branded-confirm-description">{confirmation?.message}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => answer(false)} type="button" variant="outline">{confirmation?.cancelLabel ?? 'Cancel'}</Button>
            <Button autoFocus onClick={() => answer(true)} type="button" variant={confirmation?.destructive ? 'destructive' : 'default'}>{confirmation?.confirmLabel ?? 'Continue'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  return { alert, confirm, dialogs } as const;
}

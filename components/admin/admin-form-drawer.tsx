'use client';

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { Button } from '@/components/ui/button';

const AdminFormDrawerContext = createContext<(() => void) | null>(null);

export function useAdminFormDrawer() {
  return useContext(AdminFormDrawerContext);
}

export function AdminFormDrawer({ children, closeHref, title }: { children: ReactNode; closeHref: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const closeAndRefresh = useCallback(() => { setOpen(false); router.push(closeHref); router.refresh(); }, [closeHref, router]);
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) router.push(closeHref); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 h-dvh w-full overflow-y-auto border-l bg-background shadow-2xl outline-none sm:w-[70vw] sm:max-w-5xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-5 py-4 backdrop-blur lg:px-8">
            <Dialog.Title className="text-3xl font-semibold text-gold">{title}</Dialog.Title>
            <Dialog.Close asChild><Button aria-label="Close" size="icon-sm" title="Close" type="button" variant="ghost"><X aria-hidden="true" /></Button></Dialog.Close>
          </div>
          <AdminFormDrawerContext.Provider value={closeAndRefresh}>
            {children}
          </AdminFormDrawerContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

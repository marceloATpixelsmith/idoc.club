'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export function AdminFormDrawer({ children, closeHref, title }: { children: ReactNode; closeHref: string; title: string }) {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);

  function close() {
    router.push(closeHref);
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button aria-label="Close form" className="absolute inset-0 bg-black/50" onClick={close} type="button" />
      <aside
        aria-label={title}
        aria-modal="true"
        className="relative h-dvh w-full overflow-y-auto border-l bg-background shadow-2xl md:w-[85vw]"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-5 py-4 backdrop-blur lg:px-8">
          <h1 className="text-2xl font-semibold text-gold">{title}</h1>
          <Button aria-label="Close" onClick={close} size="icon-sm" title="Close" type="button" variant="ghost"><X aria-hidden="true" /></Button>
        </div>
        {children}
      </aside>
    </div>
  );
}

'use client';

import { useEffect } from 'react';

export function FlashConsumer({ targetPath }: { targetPath: string }) {
  useEffect(() => {
    void fetch('/api/ui/flash/consume', {
      body: JSON.stringify({ targetPath }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }, [targetPath]);
  return null;
}

export function FlashBanner({ children, targetPath }: { children: React.ReactNode; targetPath: string }) {
  return (
    <>
      <FlashConsumer targetPath={targetPath} />
    <div
      className="my-8 rounded-lg border border-[#35527b] bg-[#152744] px-5 py-4 text-sm text-[#f2f6fc] shadow-sm"
      role="status"
    >
      {children}
    </div>
    </>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function PromotionStatusRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return active ? <p className="text-sm text-muted-foreground" role="status">Promotion is running. Status refreshes automatically every 15 seconds; you may leave this page.</p> : null;
}

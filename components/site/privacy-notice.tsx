'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const NOTICE_KEY = 'idoc-privacy-notice-v1';

export function PrivacyNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(NOTICE_KEY) !== 'acknowledged');
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(NOTICE_KEY, 'acknowledged');
    } catch {
      // THE NOTICE CAN STILL BE DISMISSED FOR THIS PAGE VIEW IF STORAGE IS UNAVAILABLE.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Privacy and cookie notice"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md border border-gold/45 bg-surface-raised p-5 shadow-[var(--shadow-deep)] sm:inset-x-auto sm:right-5 sm:mx-0"
    >
      <p className="eyebrow">Privacy &amp; Cookies</p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        IDOC uses essential cookies and similar technology for sign-in, security, fraud prevention, and requested site features. We do not currently use advertising or optional analytics cookies.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full px-5 py-2.5 text-sm"
        >
          Got it
        </button>
        <Link href="/privacy" className="text-sm font-semibold text-gold underline-offset-4 hover:underline">
          Privacy policy
        </Link>
      </div>
    </aside>
  );
}

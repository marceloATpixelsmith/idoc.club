'use client';

import Script from 'next/script';
import { useEffect, useId } from 'react';

/** Renders a Cloudflare Turnstile challenge. The widget itself requires JavaScript to solve (that
 * is inherent to what it verifies), but once solved it injects a hidden `cf-turnstile-response`
 * input into this div, which native form submission picks up like any other field — no client-side
 * submit handling required. `onVerify` is optional progressive enhancement for UI that wants to
 * know the challenge is solved (e.g. to enable a submit button) before the form is even submitted. */
export function TurnstileWidget({ onVerify }: { onVerify?: (token: string) => void }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const callbackName = `turnstileCallback_${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    if (!onVerify) return undefined;
    (window as unknown as Record<string, unknown>)[callbackName] = onVerify;
    return () => { delete (window as unknown as Record<string, unknown>)[callbackName]; };
  }, [callbackName, onVerify]);

  if (!siteKey) return null;
  return (
    <>
      <Script async defer src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div className="cf-turnstile" data-callback={onVerify ? callbackName : undefined} data-sitekey={siteKey} />
    </>
  );
}

import 'server-only';

import { baseUrlForServer, turnstileSecretKeyForServer } from '../runtime/configuration.ts';

type TurnstileSiteverifyResponse = {
  action?: string;
  hostname?: string;
  success?: boolean;
};

/** Verifies a Cloudflare Turnstile client token against trusted deployment and flow context.
 * Missing/misconfigured provider settings, provider failure, hostname mismatch, action mismatch,
 * and unsuccessful verification all fail closed. */
export async function verifyTurnstile(
  token: string,
  remoteIp: string | undefined,
  expectedAction: string
): Promise<boolean> {
  if (!token || !expectedAction) return false;

  let secret: string;
  let expectedHostname: string;
  try {
    secret = turnstileSecretKeyForServer();
    expectedHostname = new URL(baseUrlForServer()).hostname;
  } catch {
    return false;
  }

  const body = new URLSearchParams({ response: token, secret });
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    if (!response.ok) return false;

    const result = await response.json() as TurnstileSiteverifyResponse;
    return result.success === true
      && result.hostname === expectedHostname
      && result.action === expectedAction;
  } catch {
    return false;
  }
}

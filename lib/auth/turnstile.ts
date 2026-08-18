import 'server-only';

import { turnstileSecretKeyForServer } from '@/lib/runtime/configuration';

/** Verifies a Cloudflare Turnstile client token. Never throws — a misconfigured or unreachable
 * verification service must fail closed (rejects the submission) rather than take the site down. */
export async function verifyTurnstile(token: string, remoteIp?: string): Promise<boolean> {
  if (!token) return false;
  let secret: string;
  try {
    secret = turnstileSecretKeyForServer();
  } catch {
    return false;
  }
  const body = new URLSearchParams({ response: token, secret });
  if (remoteIp) body.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, method: 'POST',
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

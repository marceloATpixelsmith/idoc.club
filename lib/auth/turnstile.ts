import 'server-only';

// Keep this import Node-resolvable as well as bundler-resolvable: the release test runner executes
// this module directly under Node's ESM resolver without the Next.js @/* path alias.
import { baseUrlForServer, turnstileSecretKeyForServer } from '../runtime/configuration.ts';

type TurnstileSiteverifyResponse = {
  action?: string;
  hostname?: string;
  success?: boolean;
};

// Cloudflare's own publicly documented "always passes" testing secret key
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). It is not a credential
// this app owns or can rotate -- it is a fixed, world-readable constant Cloudflare itself resolves
// to `success: true` for ANY caller presenting the matching testing sitekey's fixed dummy token
// ("XXXX.DUMMY.TOKEN.XXXX"), regardless of which real site configured it. Real Turnstile protection
// binds a token to the exact hostname/action it was minted for; Cloudflare's siteverify response for
// this specific testing pair instead always returns the fixed shape `{ success: true,
// hostname: 'example.com' }` with no `action` field at all, which can never satisfy the strict
// hostname/action equality real verification requires below. Accepting that one fixed, externally
// pinned shape -- and only when this deployment's own configured secret literally equals this public
// constant -- adds no attack surface: a deployment that configures this exact publicly known string
// has already opted out of real Turnstile protection the moment it did so, since Cloudflare's own
// API grants the same "always passes" behavior to every caller on the internet for that secret, with
// or without this additional shape check.
//
// The activation gate is a POSITIVE allow-list of the one real deployment this exists for, not
// merely "VERCEL_ENV isn't literally 'production'": an unset/unexpected VERCEL_ENV (a misconfigured
// non-Vercel runtime, or some other preview deployment that happened to inherit this public secret
// value) must never be enough on its own to disable Turnstile for every verifyTurnstile caller site-
// wide. Requiring the deployment's own configured hostname to also equal the dedicated testing
// domain ties this to the actual environment it is for, not to a string this secret's value never
// even referenced. VERCEL_ENV remains additional defense-in-depth on top of that, not the only gate.
const CLOUDFLARE_ALWAYS_PASS_TESTING_KEY = '1x0000000000000000000000000000000AA';
const TURNSTILE_TESTING_EXCEPTION_HOSTNAME = 'staging.idoc.club';

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
    if (
      secret === CLOUDFLARE_ALWAYS_PASS_TESTING_KEY
      && expectedHostname === TURNSTILE_TESTING_EXCEPTION_HOSTNAME
      && process.env.VERCEL_ENV !== 'production'
    ) {
      return result.success === true && result.hostname === 'example.com' && !result.action;
    }
    return result.success === true
      && result.hostname === expectedHostname
      && result.action === expectedAction;
  } catch {
    return false;
  }
}

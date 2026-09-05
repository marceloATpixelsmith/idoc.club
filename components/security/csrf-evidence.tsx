import { CsrfField } from '@/components/security/csrf-field';

/** For every anonymous, multi-stage, redirect()-driven continuation flow in this app (MFA
 * challenge/enrollment/recovery, signup, login, password reset): renders the flow's own per-flow
 * csrfNonce directly as this page's hidden csrf_token field -- a plain per-request server-rendered
 * value, not a client Context value, so it has none of CsrfField's real, confirmed staleness risk
 * across this app's stage-to-stage client-side navigations (see lib/security/csrf.ts's
 * generatePendingCsrfNonce doc comment for the full mechanism). Falls back to the general
 * <CsrfField/> only when no such flow is active (pendingCsrfNonce undefined) -- the very first,
 * pre-flow page of each of these flows (no pending cookie exists yet to source a nonce from), and
 * step-up (a separate cookie/action family untouched by this fix). */
export function CsrfEvidence({ pendingCsrfNonce }: { pendingCsrfNonce?: string }) {
  return pendingCsrfNonce ? <input name="csrf_token" type="hidden" value={pendingCsrfNonce} /> : <CsrfField />;
}

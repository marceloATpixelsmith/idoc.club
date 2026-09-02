// AUTH-DEPENDENCY-001: "Each critical dependency MUST explicitly fail closed, degrade safely,
// queue/retry, or use bounded trusted cache according to authority and operation risk." Every
// posture named here was already correct before this file existed (see each entry's `evidence`) --
// what was missing was a single, explicit, code-level place naming the intended posture for every
// critical external dependency, so a future change to any of them is a deliberate, reviewable
// decision rather than an accidental drift nobody declared. tests/dependency-risk-register.test.ts
// and tests/dependency-risk-register.integration.ts hold each entry's declared posture against the
// real behavior its `evidence` cites -- this file is not just documentation, it is asserted against.

export type DependencyFailurePosture = 'fail-closed' | 'fail-open' | 'retry-queue' | 'bounded-cache';

export type DependencyAuthorityRisk =
  /** A failure here, handled wrong, could itself grant or falsify security-relevant authority
   * (authentication, authorization, rate limiting, revocation). */
  | 'authoritative'
  /** An additional, non-primary control layered on top of an authoritative one; failing safe here
   * means never weakening the primary control, not necessarily blocking the whole operation. */
  | 'defense-in-depth'
  /** Failure affects delivery/observability/convenience, never authority itself. */
  | 'best-effort';

export type DependencyRiskEntry = {
  name: string;
  posture: DependencyFailurePosture;
  authorityRisk: DependencyAuthorityRisk;
  rationale: string;
  /** Where the real behavior this posture describes actually lives, and what proves it. */
  evidence: string;
};

export const DEPENDENCY_RISK_REGISTER: readonly DependencyRiskEntry[] = [
  {
    name: 'postgres',
    posture: 'fail-closed',
    authorityRisk: 'authoritative',
    rationale: 'The sole authoritative store for sessions, roles, memberships, rate limits, and every other security-relevant record in this codebase (AUTH-DEPENDENCY-002: an unavailable authoritative store must never fall back to a client claim, stale privilege, or skipped authorization). A connection or query failure must fail the request, never silently continue with no data.',
    evidence: 'lib/db/drizzle.ts has no try/catch around client creation or queries; every caller (getSession, requireAccountAccess, checkRateLimit, etc.) lets a thrown error propagate to its own caller, ultimately failing the request. tests/dependency-risk-register.test.ts asserts no production file wraps a db/client call in a catch that returns a fallback value.',
  },
  {
    name: 'stripe',
    posture: 'fail-closed',
    authorityRisk: 'authoritative',
    rationale: 'Payment/subscription state derived from Stripe is authoritative for membership entitlement; a failed API call or an unverifiable webhook signature must never be treated as a successful payment or a valid event.',
    evidence: 'lib/payments/stripe.ts / app/api/stripe/webhook/route.ts: signature verification failure and API errors throw/reject rather than defaulting to success. tests/dependency-risk-register.test.ts asserts no production file wraps a Stripe call in a catch that returns a fallback "success" value.',
  },
  {
    name: 'google-jwks',
    posture: 'fail-closed',
    authorityRisk: 'authoritative',
    rationale: "The identity provider's signing keys are what makes a Google ID token trustworthy at all; a key-endpoint failure during verification must reject the login/link attempt, never accept an unverifiable token.",
    evidence: "lib/auth/google-oidc-reference.ts's completeGoogleOidcCallback catches any jwtVerify/resolveGoogleJwks failure and converts it to GoogleOidcError('invalid_id_token'), which the callback route treats as a rejected attempt, never a successful one. Proven behaviorally with a real, forced JWKS-endpoint failure in tests/security-e2e/google-oauth.spec.ts ('a real Google callback fails closed... when the identity provider key endpoint is unreachable').",
  },
  {
    name: 'turnstile',
    posture: 'fail-closed',
    authorityRisk: 'defense-in-depth',
    rationale: 'Bot/abuse defense layered in front of signup, login, and password-reset entry points. Missing config, a network error, a non-2xx provider response, or a malformed response must never be treated as a passed check.',
    evidence: 'lib/auth/turnstile.ts verifyTurnstile: every failure branch returns false, never throws past its own boundary. Proven directly in tests/dependency-risk-register.test.ts and tests/turnstile-contract.test.ts.',
  },
  {
    name: 'mailchimp-transactional',
    posture: 'retry-queue',
    authorityRisk: 'best-effort',
    rationale: "Email delivery is how a member learns about evidence (a reset link, an OTP code, a security notice) that already exists and is already authoritative on its own -- a delivery failure must never itself grant, deny, or fabricate authority, only affect whether/when the member is told about it. Blocking the underlying action on delivery succeeding would make the mail provider a single point of failure for actions it isn't authoritative for.",
    evidence: 'lib/notifications/account-delivery.ts / mailchimp-transactional.ts: a send failure is caught and the item is left for the outbox retry/dead-letter worker (deliverNextAccountLink), never silently dropped and never blocks the caller. Proven behaviorally in tests/account-delivery-worker.integration.ts and tests/evidence-safety-scan.integration.ts (the provider-failure sweep).',
  },
  {
    name: 'have-i-been-pwned',
    posture: 'fail-open',
    authorityRisk: 'defense-in-depth',
    rationale: "A free, keyless, best-effort advisory layered on top of this codebase's actual, mandatory password controls (composition policy, Argon2id hashing) -- not the primary control itself. Blocking every signup/password-change on an unrelated third-party outage would be a worse outcome than occasionally missing a breach match; this is a deliberate, explicit exception to this register's otherwise fail-closed default, not an oversight.",
    evidence: 'lib/security/password-breach-check.ts checkPasswordBreached: any network error, timeout, or non-2xx response returns { breached: false, checked: false } -- never throws, never blocks the caller. Proven directly in tests/dependency-risk-register.test.ts and tests/password-breach-check.test.ts.',
  },
];

export function dependencyRiskEntry(name: string): DependencyRiskEntry {
  const entry = DEPENDENCY_RISK_REGISTER.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`No dependency risk register entry named "${name}".`);
  return entry;
}

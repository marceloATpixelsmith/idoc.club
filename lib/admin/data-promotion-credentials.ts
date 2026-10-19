import { createHash } from 'node:crypto';

// Facts about the promotion connection URL, shown only when the database rejects the login, so a Super Admin can compare them with the password they
// set without the password itself ever being displayed. The SHA-256 prefix is released only for a long random hex password (what `openssl rand -hex` makes):
// six hex characters cannot be reversed into one, but they could help confirm guesses of a short or human-chosen password, so for those only the length is shown.
export type PromotionCredentialSummary = { database: string; host: string; passwordLength: number; passwordSha256Prefix: string | null; sslmode: string; user: string };

const RANDOM_HEX_PASSWORD = /^[0-9a-f]{32,}$/i;

export function summarizePromotionCredentials(databaseUrl: string): PromotionCredentialSummary | null {
  try {
    const parsed = new URL(databaseUrl.trim());
    const password = decodeURIComponent(parsed.password);
    return {
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      host: parsed.hostname,
      passwordLength: password.length,
      passwordSha256Prefix: RANDOM_HEX_PASSWORD.test(password) ? createHash('sha256').update(password, 'utf8').digest('hex').slice(0, 6) : null,
      sslmode: parsed.searchParams.get('sslmode') ?? 'require (added by the application)',
      user: decodeURIComponent(parsed.username),
    };
  } catch {
    return null;
  }
}

export function describePasswordRejection(summary: PromotionCredentialSummary | null) {
  if (!summary) return ' The connection URL could not be read; check DATA_PROMOTION_DATABASE_URL.';
  const where = ` The application connected to ${summary.host}/${summary.database} as "${summary.user}" with a password of ${summary.passwordLength} characters (TLS: ${summary.sslmode}).`;
  if (!summary.passwordSha256Prefix) return where + ' No password check value is shown because it is not a long random hex password; set one with: openssl rand -hex 24';
  return where + ` Its SHA-256 starts with ${summary.passwordSha256Prefix}. Compare with: printf %s 'YOUR_PASSWORD' | shasum -a 256 | cut -c1-6`;
}

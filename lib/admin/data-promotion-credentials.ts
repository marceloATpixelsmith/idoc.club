import { createHash } from 'node:crypto';

// Non-secret facts about the promotion connection URL, shown only when the database rejects the login, so a Super Admin can compare them with the
// password they set without the password itself ever being displayed. Six hex characters of a SHA-256 cannot be reversed into a random password.
export type PromotionCredentialSummary = { database: string; host: string; passwordLength: number; passwordSha256Prefix: string; sslmode: string; user: string };

export function summarizePromotionCredentials(databaseUrl: string): PromotionCredentialSummary | null {
  try {
    const parsed = new URL(databaseUrl.trim());
    const password = decodeURIComponent(parsed.password);
    return {
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      host: parsed.hostname,
      passwordLength: password.length,
      passwordSha256Prefix: createHash('sha256').update(password, 'utf8').digest('hex').slice(0, 6),
      sslmode: parsed.searchParams.get('sslmode') ?? 'require (added by the application)',
      user: decodeURIComponent(parsed.username),
    };
  } catch {
    return null;
  }
}

export function describePasswordRejection(summary: PromotionCredentialSummary | null) {
  if (!summary) return ' The connection URL could not be read; check DATA_PROMOTION_DATABASE_URL.';
  return ` The application connected to ${summary.host}/${summary.database} as "${summary.user}" with a password of ${summary.passwordLength} characters whose SHA-256 starts with ${summary.passwordSha256Prefix} (TLS: ${summary.sslmode}). Compare with: printf %s 'YOUR_PASSWORD' | shasum -a 256 | cut -c1-6`;
}

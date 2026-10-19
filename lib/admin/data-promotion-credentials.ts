// Facts about the promotion connection URL, shown only when the database rejects the login, so a Super Admin can see which host, database, user and TLS mode the
// application used. Nothing derived from the password (no length, no hash) is ever shown.
export type PromotionCredentialSummary = { database: string; host: string; sslmode: string; user: string };

export function summarizePromotionCredentials(databaseUrl: string): PromotionCredentialSummary | null {
  try {
    const parsed = new URL(databaseUrl.trim());
    return {
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      host: parsed.hostname,
      sslmode: parsed.searchParams.get('sslmode') ?? 'require (added by the application)',
      user: decodeURIComponent(parsed.username),
    };
  } catch {
    return null;
  }
}

export function describePasswordRejection(summary: PromotionCredentialSummary | null) {
  if (!summary) return ' The connection URL could not be read; check DATA_PROMOTION_DATABASE_URL.';
  return ` The application connected to ${summary.host}/${summary.database} as "${summary.user}" (TLS: ${summary.sslmode}). Check that the password in DATA_PROMOTION_DATABASE_URL matches the one set for that database role.`;
}

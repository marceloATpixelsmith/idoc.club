// Pure rules for where an email's links may point. The send boundary (brevo-transactional.ts) applies them to every
// outgoing message, so a link built from a wrong BASE_URL (staging, a preview, localhost, an old domain) is refused
// instead of reaching a member. Kept free of IO so the rule can be unit tested.

/** The one host production emails may link to. */
export const CANONICAL_EMAIL_HOST = 'idoc.club';

export class EmailLinkOriginError extends Error {
  readonly hosts: string[];
  constructor(hosts: string[]) {
    super(`email_link_noncanonical_host:${hosts.join(',')}`);
    this.name = 'EmailLinkOriginError';
    this.hosts = hosts;
  }
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)\\]+/gi;

function looksLikeAnIdocDeployment(host: string): boolean {
  return host === 'localhost' || host.startsWith('127.') || host.endsWith('.vercel.app') || host.endsWith('.idoc.club') || host.includes('idoc');
}

/** Hosts in the message that belong to this application's own deployments but are not the canonical host. External
 * hosts (fonts, FEI, and so on) are not this rule's concern. */
export function nonCanonicalEmailHosts(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(URL_PATTERN)) {
    let host: string;
    try { host = new URL(match[0]).hostname.toLowerCase(); } catch { continue; }
    if (host !== CANONICAL_EMAIL_HOST && looksLikeAnIdocDeployment(host)) found.add(host);
  }
  return [...found].sort();
}

/** Throws when this is the Production deployment and the message links to any other IDOC host. Preview/staging and
 * local runs link to their own origin by design, so they are not checked. */
export function assertEmailLinksCanonical(html: string, environment: Record<string, string | undefined> = process.env): void {
  if (environment.VERCEL_ENV !== 'production') return;
  const hosts = nonCanonicalEmailHosts(html);
  if (hosts.length > 0) throw new EmailLinkOriginError(hosts);
}

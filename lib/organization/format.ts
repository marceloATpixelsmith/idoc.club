export type OrganizationAddress = { address1: string | null; address2: string | null; city: string | null; country: string | null; postalCode: string | null; stateProvince: string | null };

export function formatOrganizationAddress(address: OrganizationAddress | null): string[] {
  if (!address) return [];
  const locality = [address.postalCode, address.city].filter(Boolean).join(' ');
  return [address.address1, address.address2, [locality, address.stateProvince].filter(Boolean).join(', '), address.country]
    .filter((line): line is string => Boolean(line));
}

const ALLOWED_TAGS = new Set(['a', 'br', 'em', 'li', 'ol', 'p', 'strong', 'ul']);
export function sanitizeBankInstructions(input: string): string {
  const withoutActiveContent = input.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return withoutActiveContent.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (whole, rawTag: string, attributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (whole.startsWith('</')) return tag === 'br' ? '' : `</${tag}>`;
    if (tag !== 'a') return tag === 'br' ? '<br>' : `<${tag}>`;
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    return href && /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">` : '<a>';
  });
}

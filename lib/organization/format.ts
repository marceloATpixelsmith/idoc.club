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

const ENTITY_ENCODED_WHITESPACE = /&(?:nbsp|ensp|emsp|thinsp|hairsp|zwnj|zwj|lrm|rlm);|&#(?:9|10|13|32|160|5760|8192|8193|8194|8195|8196|8197|8198|8199|8200|8201|8202|8203|8232|8233|8239|8287|12288);|&#x(?:9|a|d|20|a0|1680|2000|2001|2002|2003|2004|2005|2006|2007|2008|2009|200a|200b|2028|2029|202f|205f|3000);/gi;

export function hasVisibleBankInstructions(input: string): boolean {
  return Boolean(input
    .replace(/<[^>]*>/g, '')
    .replace(ENTITY_ENCODED_WHITESPACE, ' ')
    .replace(/[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g, '')
  );
}

/** Server-side allowlist sanitizer for News/Blog rich-text article bodies, following the same
 * regex-strip approach as lib/organization/format.ts's sanitizeBankInstructions but with the wider
 * tag set an article body needs (headings, blockquote, code, links, lists). Active content (script,
 * style, iframe, object, embed, svg, math), event-handler attributes, and unsafe link schemes are
 * removed unconditionally; every other attribute is dropped except a safe href on <a>. */
const ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'em', 'h2', 'h3', 'h4', 'hr', 'li', 'ol', 'p', 'pre', 'strong', 'ul',
]);

export function sanitizeArticleContent(input: string): string {
  const withoutActiveContent = input.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return withoutActiveContent.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (whole, rawTag: string, attributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (whole.startsWith('</')) return tag === 'br' || tag === 'hr' ? '' : `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    if (tag !== 'a') return `<${tag}>`;
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    return href && /^(https?:|mailto:)/i.test(href) ? `<a href="${href.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">` : '<a>';
  });
}

const ENTITY_ENCODED_WHITESPACE = /&(?:nbsp|ensp|emsp|thinsp|hairsp|zwnj|zwj|lrm|rlm);|&#(?:9|10|13|32|160|5760|8192|8193|8194|8195|8196|8197|8198|8199|8200|8201|8202|8203|8232|8233|8239|8287|12288);|&#x(?:9|a|d|20|a0|1680|2000|2001|2002|2003|2004|2005|2006|2007|2008|2009|200a|200b|2028|2029|202f|205f|3000);/gi;
const UNICODE_WHITESPACE = /[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

export function hasVisibleContent(input: string): boolean {
  return Boolean(input
    .replace(/<[^>]*>/g, '')
    .replace(ENTITY_ENCODED_WHITESPACE, ' ')
    .replace(UNICODE_WHITESPACE, ''));
}

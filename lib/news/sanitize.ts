/** Server-side allowlist sanitizer for News/Blog and seminar rich-text HTML. Active content (script,
 * style, iframe, object, embed, svg, math), event-handler attributes, unsafe links, and non-Cloudinary
 * image sources are removed. */
const ALLOWED_TAGS = new Set([
  'a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'h4', 'hr', 'img', 'li', 'ol', 'p', 'pre', 's', 'strong', 'u', 'ul',
]);
const MIN_IMAGE_WIDTH = 120;
const MAX_IMAGE_WIDTH = 2000;

// Preserve valid entities across repeated save/edit sanitization passes without allowing raw markup.
function escapeAmpersand(value: string): string {
  return value.replace(/&(?!amp;|quot;|#39;|lt;|gt;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;');
}

function safeImageWidth(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const width = Number.parseInt(value, 10);
  return width >= MIN_IMAGE_WIDTH && width <= MAX_IMAGE_WIDTH ? width : null;
}

function safeCloudinaryImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password) return null;
    if (!/^\/[a-z0-9_-]+\/image\/upload\//i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeArticleContent(input: string): string {
  const withoutActiveContent = input.replace(/<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return withoutActiveContent.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (whole, rawTag: string, attributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (whole.startsWith('</')) return tag === 'br' || tag === 'hr' || tag === 'img' ? '' : `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    if (tag === 'img') {
      const rawSrc = attributes.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
      const safeSrc = rawSrc ? safeCloudinaryImageUrl(rawSrc) : null;
      if (!safeSrc) return '';
      const rawAlt = attributes.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() ?? '';
      const alt = escapeAmpersand(rawAlt).replaceAll('"', '&quot;');
      const width = safeImageWidth(attributes.match(/\bwidth\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim());
      const widthAttribute = width ? ` width="${width}"` : '';
      return `<img src="${escapeAmpersand(safeSrc).replaceAll('"', '&quot;')}" alt="${alt}"${widthAttribute}>`;
    }
    if (tag !== 'a') return `<${tag}>`;
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    return href && /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeAmpersand(href).replaceAll('"', '&quot;')}">` : '<a>';
  });
}

const ENTITY_ENCODED_WHITESPACE = /&(?:nbsp|ensp|emsp|thinsp|hairsp|zwnj|zwj|lrm|rlm);|&#(?:9|10|13|32|160|5760|8192|8193|8194|8195|8196|8197|8198|8199|8200|8201|8202|8203|8232|8233|8239|8287|12288);|&#x(?:9|a|d|20|a0|1680|2000|2001|2002|2003|2004|2005|2006|2007|2008|2009|200a|200b|2028|2029|202f|205f|3000);/gi;
const UNICODE_WHITESPACE = /[\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

export function hasVisibleContent(input: string): boolean {
  const visibleText = input
    .replace(/<[^>]*>/g, '')
    .replace(ENTITY_ENCODED_WHITESPACE, ' ')
    .replace(UNICODE_WHITESPACE, '');
  return Boolean(visibleText || /<img\b/i.test(input));
}

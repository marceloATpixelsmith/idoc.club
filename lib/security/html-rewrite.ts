/** Shared by the rich-text sanitizers (news/blog/seminar content, bank-transfer instructions).
 *
 * The sanitizers rewrite only the tags their pattern recognises. Everything between those matches used to be copied through
 * untouched, so a `<` the pattern did not recognise as a complete tag (an unterminated `<img src=x onerror=...//`, a tag name the word
 * boundary cannot end such as `<img_x onerror=...>`, `<!--`, `<?`) reached the page or an email as raw markup, and whatever
 * surrounds the stored value (a closing `</div>`) completed it into a live element. Now the output contains a `<` only where the
 * sanitizer wrote one itself: every stretch of text between recognised tags has `<` and `>` escaped. `&` is left alone so entities
 * that are already there keep rendering and sanitising the same value twice gives the same result. */
const TAG = /<\/?([a-z0-9]+)\b([^>]*)>/gi;

export function escapeStrayMarkup(text: string): string {
  return text.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function rewriteTags(input: string, rewrite: (whole: string, rawTag: string, attributes: string) => string): string {
  let output = '';
  let last = 0;
  for (const match of input.matchAll(TAG)) {
    output += escapeStrayMarkup(input.slice(last, match.index)) + rewrite(match[0], match[1], match[2]);
    last = match.index + match[0].length;
  }
  return output + escapeStrayMarkup(input.slice(last));
}

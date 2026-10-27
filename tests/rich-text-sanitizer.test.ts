import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeArticleContent } from '../lib/news/sanitize.ts';
import { sanitizeBankInstructions } from '../lib/organization/format.ts';

// What the WYSIWYG editors produce: every allowed tag must come through exactly as it went in.
const EDITOR_HTML = [
  '<h2>Heading</h2><p>Plain <strong>bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> &amp; an entity, a &lt;literal&gt;.</p>',
  '<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol><blockquote><p>Quote</p></blockquote><pre><code>x = 1</code></pre><hr>',
  '<p><a href="https://idoc.club/news?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Link</a> and <a href="mailto:a@b.org">mail</a><br>next line</p>',
  '<p><span style="font-size: 18px">Sized</span></p>',
  '<img src="https://res.cloudinary.com/demo/image/upload/v1/a.jpg" alt="An image" width="400">',
].join('');

test('ordinary editor HTML is unchanged by the article sanitizer, and sanitizing twice changes nothing more', () => {
  assert.equal(sanitizeArticleContent(EDITOR_HTML), EDITOR_HTML);
  assert.equal(sanitizeArticleContent(sanitizeArticleContent(EDITOR_HTML)), EDITOR_HTML);
});

test('ordinary editor HTML is unchanged by the bank-instruction sanitizer', () => {
  const html = '<p>Bank: <strong>IBAN</strong> NL00 TEST 0000 0000 00</p><ul><li>Reference: your <em>name</em></li></ul><p><a href="https://idoc.club/pay?a=1&amp;b=2">Details</a><br>Thanks &amp; regards</p>';
  assert.equal(sanitizeBankInstructions(html), html);
});

// Pentest 2026-10-27, finding 6: markup the tag pattern does not recognise used to pass through and be completed into a live element by
// the surrounding template. It is now escaped, so it shows as text and can never become an element.
const BYPASSES = [
  '<p>Update</p><img src=x onerror=document.title=1//',
  '<p>Update</p><img_x src=x onerror=alert(1)>',
  '<p>Update</p><div_x style="border:2px solid red">notice</div_x>',
  '<p>Update</p><a_x href=https://example.org>click</a_x>',
  '<!-- hidden --><p>Update</p><? php ?>',
  '<p>Update</p><!',
];

for (const [name, sanitize] of [['article', sanitizeArticleContent], ['bank instructions', sanitizeBankInstructions]] as const) {
  test(`the ${name} sanitizer never emits a < it did not write itself`, () => {
    for (const payload of BYPASSES) {
      const out = sanitize(payload);
      // Strip the tags the sanitizer legitimately wrote; nothing may remain that a browser could read as another tag.
      assert.equal(out.replace(/<\/?(?:p|a|br|strong|em|span|ul|ol|li)(?: href="[^"]*")?>/g, '').includes('<'), false, `${payload} -> ${out}`);
      assert.equal(sanitize(out), out, 'sanitizing again is stable');
    }
    assert.ok(sanitize('<p>x</p><img_x src=x onerror=alert(1)>').includes('&lt;img_x'), 'the text is still visible, just inert');
  });
}

test('an unterminated tag cannot be completed by the closing tag of the wrapper the page puts around the content', () => {
  const out = sanitizeArticleContent('<p>Hi</p><img src=x onerror=document.title=1//');
  const rendered = `<div class="idoc-rich-content">${out}</div>`;
  assert.equal(/<img/i.test(rendered), false);
});

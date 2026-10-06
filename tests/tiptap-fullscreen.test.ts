import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('components/tiptap/simple-editor-field.tsx', 'utf8');

test('shared Tiptap editor exposes icon-only fullscreen and editable HTML source controls', () => {
  assert.match(source, /label=\{isFullscreen \? 'Exit full screen' : 'Open full screen'\}/);
  assert.match(source, /<ToolbarButton[\s\S]*?active=\{isFullscreen\}[\s\S]*?<Maximize2 \/>/);
  assert.doesNotMatch(source, /<span>\{isFullscreen/);
  assert.match(source, /onKeyDownCapture=\{\(event\) => \{/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /fixed inset-0 z-\[100\] flex h-dvh flex-col/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(source, /label=\{isSourceMode \? 'Return to visual editor' : 'View HTML source'\}/);
  assert.match(source, /active=\{isSourceMode\}/);
  assert.doesNotMatch(source, /<span>\{isSourceMode/);
  assert.match(source, /text-primary data-\[active=true\]:bg-accent data-\[active=true\]:text-primary/);
  assert.match(source, /<textarea/);
  assert.match(source, /value=\{html\}/);
  assert.match(source, /onChange=\{\(event\) => setHtml\(event\.target\.value\)\}/);
  assert.match(source, /editor\.commands\.setContent\(html, \{ emitUpdate: false \}\)/);
  assert.match(source, /isFullscreen \? 'sticky top-0 z-10 shrink-0' : ''/);
  assert.equal(source.split('<Code2 />').length - 1, 1);
  assert.doesNotMatch(source, /label="(?:Code block|Inline code)"/);
  assert.match(source, /label=\{isImageUploading \? 'Uploading image' : 'Insert image'\}/);
  assert.match(source, /fetch\('\/api\/admin\/tiptap-image'/);
  assert.match(source, /insertContent\(\{[\s\S]*type: 'image'/);
  assert.match(source, /readCsrfTokenFromDocumentCookie\(\)/);
  assert.match(source, /ImageNode/);
});

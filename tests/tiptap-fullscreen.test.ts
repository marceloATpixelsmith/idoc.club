import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('components/tiptap/simple-editor-field.tsx', 'utf8');

test('shared Tiptap editor exposes visible fullscreen and editable HTML source modes', () => {
  assert.match(source, /<span>\{isFullscreen \? 'Exit full screen' : 'Full screen'\}<\/span>/);
  assert.match(source, /onKeyDownCapture=\{\(event\) => \{/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /fixed inset-0 z-\[100\] flex h-dvh flex-col/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(source, /window\.removeEventListener\('keydown', handleKeyDown\)/);
  assert.match(source, /isFullscreen \? 'sticky top-0 z-10 shrink-0' : ''/);
});

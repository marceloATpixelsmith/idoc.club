'use client';

import { useState } from 'react';

/** Rich-text editor for article bodies, following the same contentEditable + document.execCommand
 * + hidden-input pattern already used by app/(dashboard)/admin/organization/organization-settings-form.tsx
 * for Bank Transfer instructions -- kept intentionally lightweight (no new editor dependency). The
 * hidden field carries the live innerHTML to the Server Action, which re-sanitizes it before storage
 * regardless of what this toolbar produced. */
export function ArticleContentEditor({ initialHtml = '' }: { initialHtml?: string }) {
  const [html, setHtml] = useState(initialHtml);
  const command = (name: string, value?: string) => document.execCommand(name, false, value);
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor="article-content-editor">Content</label>
      <div aria-label="Formatting controls" className="mt-1 flex flex-wrap gap-2" role="toolbar">
        <button className="rounded border px-3 py-1" onClick={() => command('formatBlock', 'h2')} type="button">H2</button>
        <button className="rounded border px-3 py-1" onClick={() => command('formatBlock', 'h3')} type="button">H3</button>
        <button className="rounded border px-3 py-1" onClick={() => command('bold')} type="button"><strong>Bold</strong></button>
        <button className="rounded border px-3 py-1 italic" onClick={() => command('italic')} type="button">Italic</button>
        <button className="rounded border px-3 py-1" onClick={() => command('insertUnorderedList')} type="button">Bulleted list</button>
        <button className="rounded border px-3 py-1" onClick={() => command('insertOrderedList')} type="button">Numbered list</button>
        <button className="rounded border px-3 py-1" onClick={() => command('formatBlock', 'blockquote')} type="button">Quote</button>
        <button
          className="rounded border px-3 py-1"
          onClick={() => {
            const url = window.prompt('Link URL (https:// or mailto:)');
            if (url) command('createLink', url);
          }}
          type="button"
        >
          Link
        </button>
      </div>
      <div
        aria-labelledby="article-content-editor"
        className="mt-2 min-h-64 rounded-md border p-3"
        contentEditable
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        id="article-content-editor"
        onInput={(event) => setHtml(event.currentTarget.innerHTML)}
        role="textbox"
        suppressContentEditableWarning
      />
      <input name="contentHtml" type="hidden" value={html} />
      <p className="mt-1 text-xs text-muted-foreground">Formatting is sanitized server-side when saved.</p>
    </div>
  );
}

'use client';

import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';

const BUTTON = 'rounded border bg-transparent px-3 py-1 text-sm disabled:opacity-40';

/** Shared, self-hosted Tiptap editor. The hidden field preserves existing server-action contracts;
 * the server remains responsible for sanitizing this untrusted HTML before persistence. */
export function RichTextEditor({ initialHtml = '', label, name }: { initialHtml?: string; label: string; name: string }) {
  const [html, setHtml] = useState(initialHtml);
  const editor = useEditor({
    content: initialHtml,
    extensions: [StarterKit, Link.configure({ openOnClick: false, protocols: ['http', 'https', 'mailto'] })],
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => setHtml(activeEditor.getHTML()),
  });
  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return <div className="min-h-32 rounded-md border" />;
  const action = (labelText: string, run: () => void, disabled = false) => (
    <button className={BUTTON} disabled={disabled} onClick={run} type="button">{labelText}</button>
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div aria-label={`${label} formatting controls`} className="flex flex-wrap gap-2" role="toolbar">
        {action('Paragraph', () => editor.chain().focus().setParagraph().run())}
        {action('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        {action('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        {action('Bold', () => editor.chain().focus().toggleBold().run())}
        {action('Italic', () => editor.chain().focus().toggleItalic().run())}
        {action('Bulleted list', () => editor.chain().focus().toggleBulletList().run())}
        {action('Numbered list', () => editor.chain().focus().toggleOrderedList().run())}
        {action('Quote', () => editor.chain().focus().toggleBlockquote().run())}
        {action('Link', () => {
          const href = window.prompt('Link URL (https://, http://, or mailto:)');
          if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        })}
        {action('Undo', () => editor.chain().focus().undo().run(), !editor.can().undo())}
        {action('Redo', () => editor.chain().focus().redo().run(), !editor.can().redo())}
      </div>
      <EditorContent aria-label={label} className="min-h-32 rounded-md border p-3 [&_.tiptap]:min-h-28 [&_.tiptap]:outline-none" editor={editor} />
      <input name={name} type="hidden" value={html} />
      <p className="text-xs text-muted-foreground">Formatting is sanitized server-side when saved.</p>
    </div>
  );
}

import { RichTextEditor } from '@/components/rich-text-editor';

/** News uses the same open-source Tiptap editor and server-sanitized HTML contract as seminars. */
export function ArticleContentEditor({ initialHtml = '' }: { initialHtml?: string }) {
  return <RichTextEditor initialHtml={initialHtml} label="Content" name="contentHtml" />;
}

import { SimpleEditorField } from '@/components/tiptap/simple-editor-field';
import { sanitizeArticleContent } from '@/lib/news/sanitize';

/** News uses the same open-source Tiptap editor and server-sanitized HTML contract as seminars. */
export function ArticleContentEditor({ initialHtml = '' }: { initialHtml?: string }) {
  return <SimpleEditorField initialHtml={sanitizeArticleContent(initialHtml)} label="Content" name="contentHtml" />;
}

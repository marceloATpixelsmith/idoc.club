'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  ChevronDown,
  Code2,
  Italic,
  ImagePlus,
  Link2,
  List,
  LoaderCircle,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
  Underline,
  Unlink,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';
import { ImageNode } from '@/components/tiptap/image-node';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

type SimpleEditorFieldProps = {
  initialHtml?: string;
  label: string;
  name: string;
};

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active || undefined}
      className="size-8 rounded-md p-0 text-primary data-[active=true]:bg-accent data-[active=true]:text-primary"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function ToolbarSeparator() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/**
 * TIPTAP SIMPLE EDITOR FORM-FIELD ADAPTATION.
 * KEEPS THE EXISTING HTML FORM CONTRACT WHILE USING A RESPONSIVE TOOLBAR PATTERN
 * MATCHED TO TIPTAP'S SIMPLE EDITOR INSTEAD OF THE PREVIOUS STRIPPED-DOWN EDITOR.
 */
export function SimpleEditorField({
  initialHtml = '',
  label,
  name,
}: SimpleEditorFieldProps) {
  const editorId = useId();
  const [html, setHtml] = useState(initialHtml);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-labelledby': editorId,
        autocomplete: 'off',
        autocapitalize: 'sentences',
        class: 'min-h-40 px-4 py-3 outline-none',
      },
    },
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
        link: {
          autolink: true,
          defaultProtocol: 'https',
          enableClickSelection: true,
          openOnClick: false,
          protocols: ['http', 'https', 'mailto'],
        },
      }),
      ImageNode,
    ],
    onUpdate: ({ editor: activeEditor }) => {
      setHtml(activeEditor.getHTML());
    },
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFullscreen]);

  if (!editor) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide">{label}</p>
        <div className="min-h-52 animate-pulse rounded-lg border bg-muted/20" />
      </div>
    );
  }

  const applyLink = () => {
    const href = linkHref.trim();

    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false);
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinkOpen(false);
  };

  const openLinkEditor = (open: boolean) => {
    setLinkOpen(open);

    if (open) {
      setLinkHref(String(editor.getAttributes('link').href ?? ''));
    }
  };

  const uploadAndInsertImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setImageUploadError('Image must be 4 MB or smaller.');
      return;
    }

    setImageUploadError('');
    setIsImageUploading(true);

    try {
      const body = new FormData();
      body.set('image', file);
      const response = await fetch('/api/admin/tiptap-image', {
        body,
        headers: { 'x-csrf-token': readCsrfTokenFromDocumentCookie() },
        method: 'POST',
      });
      const result = await response.json() as { error?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(result.error || 'The image could not be uploaded.');

      editor.chain().focus().insertContent({
        attrs: { alt: file.name, src: result.url },
        type: 'image',
      }).run();
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : 'The image could not be uploaded.');
    } finally {
      setIsImageUploading(false);
    }
  };

  return (
    <div
      className={isFullscreen ? 'fixed inset-0 z-[100] flex h-dvh flex-col gap-2 overflow-hidden bg-background p-3 sm:p-6' : 'space-y-2'}
      onKeyDownCapture={(event) => {
        if (isFullscreen && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setIsFullscreen(false);
        }
      }}
    >
      <p className="text-sm font-medium uppercase tracking-wide" id={editorId}>
        {label}
      </p>

      <div className={['overflow-hidden rounded-lg border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/30', isFullscreen ? 'flex min-h-0 flex-1 flex-col' : ''].join(' ')}>
        <div
          aria-label={`${label} formatting controls`}
          className={['flex min-h-11 items-center gap-0.5 overflow-x-auto border-b bg-muted/20 px-2 py-1.5', isFullscreen ? 'sticky top-0 z-10 shrink-0' : ''].join(' ')}
          role="toolbar"
        >
          <ToolbarButton
            active={isFullscreen}
            label={isFullscreen ? 'Exit full screen' : 'Open full screen'}
            onClick={() => setIsFullscreen((current) => !current)}
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
          </ToolbarButton>
          <ToolbarButton
            active={isSourceMode}
            label={isSourceMode ? 'Return to visual editor' : 'View HTML source'}
            onClick={() => {
              if (isSourceMode) {
                editor.commands.setContent(html, { emitUpdate: false });
              } else {
                setHtml(editor.getHTML());
              }
              setIsSourceMode((current) => !current);
            }}
          >
            <Code2 />
          </ToolbarButton>
          <input
            accept="image/jpeg,image/png,image/webp,image/avif"
            aria-label="Choose an image to upload"
            className="sr-only"
            onChange={uploadAndInsertImage}
            ref={imageInputRef}
            tabIndex={-1}
            type="file"
          />
          <ToolbarButton
            disabled={isImageUploading}
            label={isImageUploading ? 'Uploading image' : 'Insert image'}
            onClick={() => imageInputRef.current?.click()}
          >
            {isImageUploading ? <LoaderCircle className="animate-spin" /> : <ImagePlus />}
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            disabled={!editor.can().undo()}
            label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 />
          </ToolbarButton>
          <ToolbarButton
            disabled={!editor.can().redo()}
            label="Redo"
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 />
          </ToolbarButton>

          <ToolbarSeparator />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Text style"
                className="h-8 gap-1 px-2"
                size="sm"
                type="button"
                variant="ghost"
              >
                <Pilcrow />
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
                Paragraph
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
                Heading 1
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
                Heading 2
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
                Heading 3
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
                Heading 4
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Lists"
                className="h-8 gap-1 px-2"
                size="sm"
                type="button"
                variant="ghost"
              >
                <List />
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBulletList().run()}>
                <List />
                Bulleted list
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleOrderedList().run()}>
                <ListOrdered />
                Numbered list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToolbarButton
            active={editor.isActive('blockquote')}
            label="Blockquote"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </ToolbarButton>
          <ToolbarButton
            label="Horizontal rule"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            active={editor.isActive('bold')}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('strike')}
            label="Strikethrough"
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough />
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('underline')}
            label="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <Underline />
          </ToolbarButton>

          <Popover onOpenChange={openLinkEditor} open={linkOpen}>
            <PopoverTrigger asChild>
              <Button
                aria-label="Link"
                aria-pressed={editor.isActive('link') || undefined}
                className="size-8 rounded-md p-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
                data-active={editor.isActive('link')}
                size="icon-sm"
                title="Link"
                type="button"
                variant="ghost"
              >
                <Link2 />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor={`${editorId}-link`}>
                  Link URL
                </label>
                <Input
                  autoFocus
                  id={`${editorId}-link`}
                  onChange={(event) => setLinkHref(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyLink();
                    }
                  }}
                  placeholder="https://example.com"
                  value={linkHref}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  disabled={!editor.isActive('link')}
                  onClick={() => {
                    editor.chain().focus().unsetLink().run();
                    setLinkHref('');
                    setLinkOpen(false);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Unlink />
                  Remove
                </Button>
                <Button onClick={applyLink} size="sm" type="button">
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {isImageUploading ? (
          <div
            aria-live="polite"
            className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Uploading image and inserting it into the editor...
          </div>
        ) : null}

        {isSourceMode ? (
          <textarea
            aria-label={`${label} HTML source`}
            className={[
              'w-full bg-background px-4 py-3 font-mono text-sm leading-6 outline-none',
              isFullscreen ? 'min-h-0 flex-1 resize-none overflow-y-auto' : 'min-h-40 resize-y',
            ].join(' ')}
            onChange={(event) => setHtml(event.target.value)}
            spellCheck={false}
            value={html}
          />
        ) : (
        <EditorContent
          className={[
            '[&_.tiptap]:min-h-40',
            isFullscreen ? 'min-h-0 flex-1 overflow-y-auto [&_.tiptap]:h-full [&_.tiptap]:!min-h-full' : '',
            '[&_.tiptap_h1]:mb-3 [&_.tiptap_h1]:mt-5 [&_.tiptap_h1]:text-3xl [&_.tiptap_h1]:font-bold',
            '[&_.tiptap_h2]:mb-3 [&_.tiptap_h2]:mt-5 [&_.tiptap_h2]:text-2xl [&_.tiptap_h2]:font-bold',
            '[&_.tiptap_h3]:mb-2 [&_.tiptap_h3]:mt-4 [&_.tiptap_h3]:text-xl [&_.tiptap_h3]:font-semibold',
            '[&_.tiptap_h4]:mb-2 [&_.tiptap_h4]:mt-4 [&_.tiptap_h4]:text-lg [&_.tiptap_h4]:font-semibold',
            '[&_.tiptap_p]:my-2',
            '[&_.tiptap_ul]:my-2 [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6',
            '[&_.tiptap_ol]:my-2 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6',
            '[&_.tiptap_blockquote]:my-3 [&_.tiptap_blockquote]:border-l-4 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:italic',
            '[&_.tiptap_pre]:my-3 [&_.tiptap_pre]:overflow-x-auto [&_.tiptap_pre]:rounded-md [&_.tiptap_pre]:bg-muted [&_.tiptap_pre]:p-3 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:text-sm',
            '[&_.tiptap_code]:rounded [&_.tiptap_code]:bg-muted [&_.tiptap_code]:px-1 [&_.tiptap_code]:py-0.5 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-sm',
            '[&_.tiptap_hr]:my-5 [&_.tiptap_hr]:border-border',
            '[&_.tiptap_a]:text-primary [&_.tiptap_a]:underline [&_.tiptap_a]:underline-offset-2',
            '[&_.tiptap_img]:my-4 [&_.tiptap_img]:h-auto [&_.tiptap_img]:max-w-full',
          ].join(' ')}
          editor={editor}
        />
        )}
      </div>

      {imageUploadError ? <p className="text-sm text-destructive" role="alert">{imageUploadError}</p> : null}
      <input name={name} type="hidden" value={html} />
    </div>
  );
}

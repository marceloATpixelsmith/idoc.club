'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  ChevronDown,
  Code2,
  Italic,
  Link2,
  List,
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
import { useEffect, useId, useState } from 'react';
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
      className="size-8 rounded-md p-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
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
          <Button
            aria-label={isFullscreen ? 'Exit full screen' : 'Open full screen'}
            className="h-8 shrink-0 gap-2 rounded-md border-primary/30 px-3 font-medium text-primary"
            onClick={() => setIsFullscreen((current) => !current)}
            size="sm"
            title={isFullscreen ? 'Exit full screen' : 'Open full screen'}
            type="button"
            variant="outline"
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </Button>
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
            active={editor.isActive('codeBlock')}
            label="Code block"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 />
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
          <ToolbarButton
            active={editor.isActive('code')}
            label="Inline code"
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code2 />
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
          ].join(' ')}
          editor={editor}
        />
      </div>

      <input name={name} type="hidden" value={html} />
    </div>
  );
}

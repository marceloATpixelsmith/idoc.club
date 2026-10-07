'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { useRef } from 'react';

const MIN_IMAGE_WIDTH = 120;

export function ImageNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const image = imageRef.current;
    if (!image) return;

    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    const editorWidth = image.closest('.tiptap')?.getBoundingClientRect().width ?? startWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        Math.max(MIN_IMAGE_WIDTH, startWidth + (moveEvent.clientX - startX)),
        editorWidth,
      );
      updateAttributes({ width: Math.round(nextWidth) });
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const width = typeof node.attrs.width === 'number' ? node.attrs.width : undefined;

  return (
    <NodeViewWrapper
      as="figure"
      className="group relative my-4 inline-block max-w-full align-top"
      data-resizable-image
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img
        alt={node.attrs.alt ?? ''}
        className="block h-auto max-w-full"
        draggable={false}
        ref={imageRef}
        src={node.attrs.src}
        title={node.attrs.title ?? undefined}
      />
      {selected ? (
        <button
          aria-label="Resize image"
          className="absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize rounded-sm border border-primary bg-background shadow"
          contentEditable={false}
          onPointerDown={beginResize}
          title="Drag to resize image"
          type="button"
        />
      ) : null}
    </NodeViewWrapper>
  );
}

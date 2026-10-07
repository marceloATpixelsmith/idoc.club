'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { useRef } from 'react';

const MIN_IMAGE_WIDTH = 120;

type ResizeState = {
  editorWidth: number;
  pointerId: number;
  startWidth: number;
  startX: number;
};

export function ImageNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const image = imageRef.current;
    if (!image) return;

    const startWidth = image.getBoundingClientRect().width;
    resizeRef.current = {
      editorWidth: image.closest('.tiptap')?.getBoundingClientRect().width ?? startWidth,
      pointerId: event.pointerId,
      startWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = resizeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;

    event.preventDefault();
    const nextWidth = Math.min(
      Math.max(MIN_IMAGE_WIDTH, active.startWidth + (event.clientX - active.startX)),
      active.editorWidth,
    );
    updateAttributes({ width: Math.round(nextWidth) });
  };

  const endResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = resizeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;

    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
        className="block h-auto w-full max-w-full"
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
          onLostPointerCapture={() => {
            resizeRef.current = null;
          }}
          onPointerCancel={endResize}
          onPointerDown={beginResize}
          onPointerMove={resize}
          onPointerUp={endResize}
          title="Drag to resize image"
          type="button"
        />
      ) : null}
    </NodeViewWrapper>
  );
}

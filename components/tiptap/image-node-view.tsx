'use client';

import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper } from '@tiptap/react';
import { useEffect, useRef } from 'react';

const MIN_IMAGE_WIDTH = 120;

type ResizeState = {
  editorWidth: number;
  pointerId: number;
  startWidth: number;
  startX: number;
};

export function ImageNodeView({ editor, getPos, node, selected, updateAttributes }: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const removeResizeListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
    window.removeEventListener('blur', cancelResize);
  };

  const cancelResize = () => {
    resizeRef.current = null;
    removeResizeListeners();
  };

  const handlePointerMove = (event: PointerEvent) => {
    const active = resizeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;

    event.preventDefault();
    const nextWidth = Math.min(
      Math.max(MIN_IMAGE_WIDTH, active.startWidth + (event.clientX - active.startX)),
      active.editorWidth,
    );
    updateAttributes({ width: Math.round(nextWidth) });
  };

  const handlePointerEnd = (event: PointerEvent) => {
    const active = resizeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    cancelResize();
  };

  useEffect(() => cancelResize, []);

  const selectImage = (event: React.PointerEvent<HTMLImageElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const position = getPos();
    if (typeof position === 'number') editor.commands.setNodeSelection(position);
  };

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

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', cancelResize);
  };

  const width = typeof node.attrs.width === 'number' ? node.attrs.width : undefined;

  return (
    <NodeViewWrapper
      as="figure"
      className={[
        'group relative my-4 inline-block max-w-full align-top',
        selected ? 'rounded-sm outline outline-2 outline-primary/70 outline-offset-2' : '',
      ].join(' ')}
      data-resizable-image
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img
        alt={node.attrs.alt ?? ''}
        className="block h-auto w-full max-w-full cursor-pointer"
        draggable={false}
        onPointerDown={selectImage}
        ref={imageRef}
        src={node.attrs.src}
        title={node.attrs.title ?? undefined}
      />
      {selected ? (
        <button
          aria-label="Resize image"
          className="absolute -bottom-2.5 -right-2.5 size-6 cursor-nwse-resize rounded-sm border-2 border-primary bg-background shadow-md"
          contentEditable={false}
          onPointerDown={beginResize}
          style={{ touchAction: 'none' }}
          title="Drag to resize image"
          type="button"
        />
      ) : null}
    </NodeViewWrapper>
  );
}

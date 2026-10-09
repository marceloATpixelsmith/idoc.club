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

type RegisteredResizeHandlers = {
  blur: () => void;
  pointerCancel: (event: PointerEvent) => void;
  pointerMove: (event: PointerEvent) => void;
  pointerUp: (event: PointerEvent) => void;
};

export function ImageNodeView({ editor, getPos, node, selected, updateAttributes }: NodeViewProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const registeredHandlersRef = useRef<RegisteredResizeHandlers | null>(null);

  const removeResizeListeners = () => {
    const handlers = registeredHandlersRef.current;
    if (!handlers) return;

    window.removeEventListener('pointermove', handlers.pointerMove);
    window.removeEventListener('pointerup', handlers.pointerUp);
    window.removeEventListener('pointercancel', handlers.pointerCancel);
    window.removeEventListener('blur', handlers.blur);
    registeredHandlersRef.current = null;
  };

  const cancelResize = () => {
    resizeRef.current = null;
    removeResizeListeners();
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

    removeResizeListeners();

    const startWidth = image.getBoundingClientRect().width;
    resizeRef.current = {
      editorWidth: image.closest('.tiptap')?.getBoundingClientRect().width ?? startWidth,
      pointerId: event.pointerId,
      startWidth,
      startX: event.clientX,
    };

    const pointerMove = (moveEvent: PointerEvent) => {
      const active = resizeRef.current;
      if (!active || moveEvent.pointerId !== active.pointerId) return;

      moveEvent.preventDefault();
      const nextWidth = Math.min(
        Math.max(MIN_IMAGE_WIDTH, active.startWidth + (moveEvent.clientX - active.startX)),
        active.editorWidth,
      );
      updateAttributes({ width: Math.round(nextWidth) });
    };

    const pointerEnd = (endEvent: PointerEvent) => {
      const active = resizeRef.current;
      if (!active || endEvent.pointerId !== active.pointerId) return;
      cancelResize();
    };

    const blur = () => {
      cancelResize();
    };

    const handlers: RegisteredResizeHandlers = {
      blur,
      pointerCancel: pointerEnd,
      pointerMove,
      pointerUp: pointerEnd,
    };
    registeredHandlersRef.current = handlers;

    window.addEventListener('pointermove', handlers.pointerMove, { passive: false });
    window.addEventListener('pointerup', handlers.pointerUp);
    window.addEventListener('pointercancel', handlers.pointerCancel);
    window.addEventListener('blur', handlers.blur);
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

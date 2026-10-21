'use client';

import { MousePointerClick, Users } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

/** localStorage flag: the hint is shown the first time a browser sees the map, never again. */
export const MAP_HINT_STORAGE_KEY = 'idoc-map-click-hint-v1';
/** How long the hint stays up before it fades out on its own. */
export const MAP_HINT_VISIBLE_MS = 7000;
export const MAP_HINT_FADE_MS = 600;

export function mapHintAlreadySeen(): boolean {
  try { return window.localStorage.getItem(MAP_HINT_STORAGE_KEY) === '1'; } catch { return true; }
}
export function markMapHintSeen() {
  try { window.localStorage.setItem(MAP_HINT_STORAGE_KEY, '1'); } catch { /* private mode: it simply may show again */ }
}

/** Floating, menu-dropdown-styled bubble that points at a map bubble (default: the US one) to tell a
 * signed-in member they can click it. `x`/`y`/`radius` are the dot's pixel position inside the map and
 * `width` is the map's pixel width, so the bubble can be kept on screen while its arrow still points at the dot.
 * It never takes pointer events, so it can never block the map underneath. */
export function MapFirstVisitHint({ leaving, radius, width, x, y }: { leaving: boolean; radius: number; width: number; x: number; y: number }) {
  const bubble = useRef<HTMLDivElement>(null);
  const [bubbleWidth, setBubbleWidth] = useState(280);
  useLayoutEffect(() => { if (bubble.current) setBubbleWidth(bubble.current.offsetWidth); }, [width]);

  const margin = 8;
  const left = Math.max(margin, Math.min(x - bubbleWidth / 2, width - bubbleWidth - margin));
  const arrowLeft = Math.max(16, Math.min(x - left, bubbleWidth - 16));
  const ringSize = radius * 2 + 16;

  return <div aria-hidden={leaving} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" role="status">
    <span
      aria-hidden
      className="idoc-map-hint-ring absolute rounded-full border-2 border-gold"
      style={{ height: ringSize, left: x - ringSize / 2, top: y - ringSize / 2, width: ringSize }}
    />
    <div
      className={`absolute transition-opacity ease-out ${leaving ? 'opacity-0' : 'opacity-100'}`}
      ref={bubble}
      style={{ bottom: `calc(100% - ${y - radius - 14}px)`, left, maxWidth: width - margin * 2, transitionDuration: `${MAP_HINT_FADE_MS}ms` }}
    >
      <div className="idoc-map-hint-bubble relative flex w-max max-w-full items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
        <MousePointerClick aria-hidden className="idoc-map-hint-pointer size-4 shrink-0 text-gold" />
        <Users aria-hidden className="size-4 shrink-0 text-gold" />
        <span>Click a bubble to see its members</span>
        <span
          aria-hidden
          className="absolute top-full size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r bg-popover"
          style={{ left: arrowLeft }}
        />
      </div>
    </div>
  </div>;
}

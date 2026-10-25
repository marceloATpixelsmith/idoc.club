'use client';

import { useEffect } from 'react';
import { isReactManaged } from '@/lib/dom/react-hydration';

function humanizeIconName(value: string): string {
  return value
    .replace(/^lucide-/, '')
    .replace(/-icon$/, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function tooltipFor(svg: SVGSVGElement): string | undefined {
  const explicit = svg.getAttribute('data-icon-tooltip') ?? svg.getAttribute('aria-label');
  if (explicit) return explicit;

  const control = svg.closest<HTMLElement>('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"]');
  const controlTitle = control?.getAttribute('title') ?? control?.getAttribute('aria-label');
  if (controlTitle) return controlTitle;

  const lucideClass = [...svg.classList].find((name) => name.startsWith('lucide-') && name !== 'lucide');
  if (lucideClass) return humanizeIconName(lucideClass);

  return undefined;
}

/** Returns false when the icon cannot be touched yet because React has not hydrated it. */
function ensureTooltip(svg: SVGSVGElement): boolean {
  if (svg.querySelector(':scope > title')) return true;
  // An icon in a Suspense boundary that is still dehydrated must not gain a child before React claims
  // it, or React reports a hydration mismatch and regenerates the boundary (lib/dom/react-hydration.ts).
  if (!isReactManaged(svg)) return false;
  const tooltip = tooltipFor(svg);
  if (!tooltip) return true;

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.dataset.idocAutoTooltip = 'true';
  title.textContent = tooltip;
  svg.prepend(title);
  return true;
}

// Icons waiting for hydration are retried with a short backoff; hydrating a boundary adds no DOM
// nodes, so there is no mutation to wait for. About 30 seconds in total, then they are left alone.
const RETRY_LIMIT = 40;
const retryDelay = (attempt: number) => Math.min(1_000, 100 + attempt * 50);

/**
 * Adds a native hover tooltip to rendered SVG icons that do not already provide one.
 * Explicit domain labels win; otherwise the associated interactive control or Lucide icon name
 * provides the fallback text. Structural container labels are deliberately ignored so an icon
 * cannot inherit an unrelated nav/region label.
 */
export function SitewideIconTooltips() {
  useEffect(() => {
    let attempt = 0;
    let timer: number | undefined;

    // Returns how many icons had to be skipped because React has not hydrated them yet.
    const scan = (root: ParentNode): number => {
      let pending = 0;
      if (root instanceof SVGSVGElement && !ensureTooltip(root)) pending += 1;
      root.querySelectorAll?.('svg').forEach((svg) => {
        if (!ensureTooltip(svg as SVGSVGElement)) pending += 1;
      });
      return pending;
    };

    const retryLater = () => {
      if (timer !== undefined || attempt >= RETRY_LIMIT) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        attempt += 1;
        if (scan(document) > 0) retryLater();
      }, retryDelay(attempt));
    };

    if (scan(document) > 0) retryLater();

    const observer = new MutationObserver((mutations) => {
      let pending = 0;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) pending += scan(node);
        }
      }
      if (pending > 0) {
        attempt = 0;
        retryLater();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  return null;
}

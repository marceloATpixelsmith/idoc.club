'use client';

import { useEffect } from 'react';

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

function ensureTooltip(svg: SVGSVGElement) {
  if (svg.querySelector(':scope > title')) return;
  const tooltip = tooltipFor(svg);
  if (!tooltip) return;

  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  title.dataset.idocAutoTooltip = 'true';
  title.textContent = tooltip;
  svg.prepend(title);
}

/**
 * Adds a native hover tooltip to rendered SVG icons that do not already provide one.
 * Explicit domain labels win; otherwise the associated interactive control or Lucide icon name
 * provides the fallback text. Structural container labels are deliberately ignored so an icon
 * cannot inherit an unrelated nav/region label.
 */
export function SitewideIconTooltips() {
  useEffect(() => {
    const scan = (root: ParentNode) => {
      if (root instanceof SVGSVGElement) ensureTooltip(root);
      root.querySelectorAll?.('svg').forEach((svg) => ensureTooltip(svg as SVGSVGElement));
    };

    scan(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element || node instanceof DocumentFragment) scan(node);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

import { Mark, mergeAttributes } from '@tiptap/core';

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36] as const;
export const DEFAULT_FONT_SIZE = 16;

export function nearestFontSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FONT_SIZE;
  return FONT_SIZES.reduce<number>((closest, candidate) =>
    Math.abs(candidate - parsed) < Math.abs(closest - parsed) ? candidate : closest, DEFAULT_FONT_SIZE);
}

export function adjustFontSize(current: unknown, direction: -1 | 1): number {
  const size = nearestFontSize(current);
  const index = FONT_SIZES.indexOf(size as typeof FONT_SIZES[number]);
  return FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, index + direction))];
}

//USE A DEDICATED MARK SO INCREMENTAL FONT SIZES SURVIVE SAVE, SANITIZATION AND RE-EDITING.
export const FontSizeMark = Mark.create({
  name: 'fontSize',
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => {
          const raw = (element as HTMLElement).style.fontSize;
          return /^\d+px$/.test(raw) ? nearestFontSize(raw) : null;
        },
        renderHTML: (attributes) =>
          attributes.size && FONT_SIZES.includes(Number(attributes.size) as typeof FONT_SIZES[number])
            ? { style: `font-size: ${attributes.size}px` }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[style*="font-size"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
});

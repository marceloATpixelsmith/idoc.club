import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageNodeView } from '@/components/tiptap/image-node-view';

/** BLOCK IMAGE NODE FOR CLOUDINARY URLS INSERTED BY THE SHARED ADMIN EDITOR. */
export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  inline: false,
  selectable: true,
  addAttributes() {
    return {
      alt: { default: null },
      src: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('width');
          if (!value) return null;
          const parsed = Number.parseInt(value, 10);
          return Number.isFinite(parsed) ? parsed : null;
        },
        renderHTML: (attributes) => attributes.width ? { width: attributes.width } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

import { Node, mergeAttributes } from '@tiptap/core';

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
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
});

import type { Attachment } from 'svelte/attachments';

/** Closes a popover on outside pointer-down or Escape (attach to the popover's wrapper). */
export function dismissable(isOpen: () => boolean, close: () => void): Attachment<HTMLElement> {
  return (node) => {
    const onDown = (e: PointerEvent) => {
      if (isOpen() && !node.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isOpen() && e.key === 'Escape') {
        close();
        node.querySelector<HTMLElement>('[aria-expanded]')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  };
}

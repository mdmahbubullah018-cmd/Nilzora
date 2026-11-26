import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom does not implement the modal methods of HTMLDialogElement; browsers do.
// This stand-in mirrors the spec behaviour the Dialog component relies on.
// Files running in the Node environment (e.g. styles.test.ts) have no DOM at all.
if (typeof HTMLDialogElement !== 'undefined') {
  const dialogProto = HTMLDialogElement.prototype;
  if (typeof dialogProto.showModal !== 'function') {
    dialogProto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (typeof dialogProto.close !== 'function') {
    dialogProto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  if (!Object.getOwnPropertyDescriptor(dialogProto, 'open')) {
    Object.defineProperty(dialogProto, 'open', {
      configurable: true,
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open');
      },
    });
  }
}

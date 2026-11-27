// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClosePopoverOnOutside } from './close-popover-on-outside';

afterEach(cleanup);

function renderPopover() {
  const { container } = render(
    <div>
      <details>
        <ClosePopoverOnOutside />
        <summary>Custom</summary>
        <form>
          <label>
            From
            <input type="date" name="from" />
          </label>
        </form>
      </details>
      <p>Somewhere else</p>
    </div>,
  );
  const details = container.querySelector('details');
  if (!details) throw new Error('no details');
  details.open = true;
  return { container, details };
}

describe('ClosePopoverOnOutside', () => {
  it('closes the popover when the page is clicked elsewhere', () => {
    const { container, details } = renderPopover();

    container.querySelector('p')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(details.open).toBe(false);
  });

  it('stays open while the click is inside it', () => {
    const { container, details } = renderPopover();

    screen.getByLabelText('From').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(container.querySelector('details')?.open).toBe(true);
    expect(details.open).toBe(true);
  });

  it('closes on Escape and returns focus to the summary', () => {
    const { details } = renderPopover();
    const summary = details.querySelector('summary');
    const focus = vi.spyOn(summary as HTMLElement, 'focus');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(details.open).toBe(false);
    expect(focus).toHaveBeenCalled();
  });

  it('leaves a closed popover alone', () => {
    const { details } = renderPopover();
    details.open = false;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(details.open).toBe(false);
  });
});

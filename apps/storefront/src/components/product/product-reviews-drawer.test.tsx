import type { RatingSummary } from '@nilzora/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductReviewsDrawer, ReviewsSummaryButton } from './product-reviews-drawer';

const summary: RatingSummary = {
  averageRating: 4.5,
  reviewCount: 12,
  distribution: { '1': 0, '2': 1, '3': 1, '4': 4, '5': 6 },
};

/** `null` renders the page as it is when the reviews could not be read. */
function renderDrawer(given: RatingSummary | null = summary) {
  return render(
    <ProductReviewsDrawer summary={given ?? undefined} panel={<p>The published reviews</p>}>
      <main>Product</main>
    </ProductReviewsDrawer>,
  );
}

function openFromTrigger() {
  const [trigger] = screen.getAllByRole('button', { name: /^Reviews/ });
  if (trigger === undefined) throw new Error('No reviews trigger on the page');
  fireEvent.click(trigger);
}

/** Whether the panel is open, as the browser sees it: an open native dialog. */
function panelIsOpen(): boolean {
  return document.querySelector('dialog')?.hasAttribute('open') ?? false;
}

describe('ProductReviewsDrawer', () => {
  it('keeps the reviews out of the page until a trigger is used', () => {
    renderDrawer();

    expect(screen.getByRole('main').textContent).toBe('Product');
    // A closed native dialog is not in the accessibility tree at all.
    expect(panelIsOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the panel from the floating trigger, naming the rating it holds', () => {
    renderDrawer();
    const [trigger] = screen.getAllByRole('button', { name: /^Reviews/ });

    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger?.getAttribute('aria-label')).toBe('Reviews · 4.5 out of 5 · 12 reviews');
    openFromTrigger();

    expect(screen.getByRole('dialog', { name: 'Ratings & reviews' })).not.toBeNull();
    expect(screen.getByText('The published reviews')).not.toBeNull();
    expect(screen.getByText('4.5 out of 5 · 12 reviews')).not.toBeNull();
  });

  it('closes again from its close button', () => {
    renderDrawer();
    openFromTrigger();
    fireEvent.click(screen.getByRole('button', { name: 'Close reviews' }));

    expect(panelIsOpen()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('treats Escape as a close, as a native dialog does', () => {
    renderDrawer();
    openFromTrigger();
    const dialog = screen.getByRole('dialog', { name: 'Ratings & reviews' });

    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(panelIsOpen()).toBe(false);
  });

  it('offers the rating beside the title as a second way in', () => {
    render(
      <ProductReviewsDrawer summary={summary} panel={<p>The published reviews</p>}>
        <ReviewsSummaryButton />
      </ProductReviewsDrawer>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: '4.5 out of 5 from 12 reviews. Open reviews.' }),
    );

    expect(screen.getByText('The published reviews')).not.toBeNull();
  });

  it('says the reviews could not be read, and stays usable, when there is no summary', () => {
    renderDrawer(null);

    expect(screen.getAllByRole('button', { name: 'Reviews' })).toHaveLength(1);
    openFromTrigger();
    expect(screen.getByText('Reviews could not be loaded right now.')).not.toBeNull();
  });
});

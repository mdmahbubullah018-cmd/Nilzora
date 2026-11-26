import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatalogError } from './catalog-error';

describe('CatalogError', () => {
  it('offers a retry and a way home without showing error details', () => {
    const retry = vi.fn();
    const { container } = render(<CatalogError retry={retry} />);

    expect(screen.getByText('Something went wrong')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Back to the home page' }).getAttribute('href')).toBe(
      '/',
    );
    expect(container.textContent).not.toMatch(/stack|digest|Error:/);
  });
});

describe('catalog route error boundaries', () => {
  it('each wire the boundary retry to the shared error view', async () => {
    const boundaries = await Promise.all([
      import('@/app/(shop)/products/error'),
      import('@/app/(shop)/categories/error'),
      import('@/app/(shop)/search/error'),
    ]);
    for (const { default: Boundary } of boundaries) {
      const retry = vi.fn();
      const { unmount } = render(<Boundary retry={retry} />);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(retry).toHaveBeenCalledTimes(1);
      unmount();
    }
  });
});

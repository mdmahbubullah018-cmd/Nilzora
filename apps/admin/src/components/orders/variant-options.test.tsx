// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VariantOptions } from './variant-options';

afterEach(cleanup);

describe('VariantOptions', () => {
  it('shows every chosen option as its own labelled chip', () => {
    render(
      <VariantOptions
        options={[
          { name: 'Colour', value: 'Black' },
          { name: 'Size', value: '42' },
        ]}
        label="Colour: Black / Size: 42"
        size="lg"
      />,
    );
    const list = within(screen.getByRole('list', { name: 'Chosen options' }));
    expect(list.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'ColourBlack',
      'Size42',
    ]);
  });

  it('falls back to the saved label for an order that predates the snapshot', () => {
    render(<VariantOptions options={undefined} label="Size: M / Colour: Navy" />);
    expect(screen.getByText('Size: M / Colour: Navy')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says a simple product has no options', () => {
    render(<VariantOptions options={[]} label={null} />);
    expect(screen.getByText('No options')).toBeTruthy();
  });
});

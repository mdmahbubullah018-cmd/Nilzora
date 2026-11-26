import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollRail } from './scroll-rail';
import { HomeSection } from './home-section';

/*
 * jsdom does no layout, so these pin the CLASSES that stop the home page scrolling sideways on a
 * phone (a real 360/390/412px browser measured scrollWidth 479 before the fix).
 *
 * The CSS reasoning: a band's content is a `grid`. A bare grid has one implicit `auto` column, and
 * a grid item's automatic minimum size is its min-content width. A sideways rail inside it sizes
 * its cards in percentages, which are unresolvable while the column is measured, so the column
 * grew to the rail's full width. `grid-cols-[minmax(0,1fr)]` pins the column to the container and
 * `min-w-0` on the rail wrapper lets it shrink wherever it is placed.
 */
describe('home page bands cannot widen the page', () => {
  it('HomeSection gives its content a single shrinkable column', () => {
    render(
      <HomeSection id="categories" title="Shop by Category">
        <p>content</p>
      </HomeSection>,
    );
    const column = screen.getByText('content').parentElement;
    expect(column).not.toBeNull();
    expect(column?.className).toContain('grid');
    expect(column?.className).toContain('grid-cols-[minmax(0,1fr)]');
  });

  it('keeps the band a labelled region', () => {
    render(
      <HomeSection id="brands" title="Shop by Brand" muted joined>
        <p>content</p>
      </HomeSection>,
    );
    expect(screen.getByRole('region', { name: 'Shop by Brand' })).toBeDefined();
  });

  it('ScrollRail wraps its list in a min-w-0 element so it shrinks inside any grid or flex parent', () => {
    const { container } = render(
      <ScrollRail className="flex overflow-x-auto" label="categories">
        <li>one</li>
      </ScrollRail>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('min-w-0');
    expect(wrapper?.querySelector('ul')?.className).toContain('overflow-x-auto');
  });
});

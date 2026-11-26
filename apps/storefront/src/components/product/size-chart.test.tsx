import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shownSizeChart, SizeGuideSection } from './size-chart';

const chart = {
  columns: ['Size', 'Chest (cm)', 'Length (cm)'],
  rows: [
    ['M', '96', '72'],
    ['L', '102', ''],
  ],
};

describe('size guide', () => {
  it('shows the chart exactly as the store wrote it, the first column naming each row', () => {
    render(<SizeGuideSection chart={chart} productName="Cotton panjabi" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Size guide' })).toBeDefined();
    const table = screen.getByRole('table', { name: /Size chart for Cotton panjabi/ });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Size', 'Chest (cm)', 'Length (cm)']);
    expect(within(table).getByRole('rowheader', { name: 'L' })).toBeDefined();
    expect(within(table).getByText('102')).toBeDefined();
    // An empty entry is announced, never invented.
    expect(within(table).getByLabelText('Not given')).toBeDefined();
  });

  it('can be scrolled with the keyboard on a narrow screen', () => {
    render(<SizeGuideSection chart={chart} productName="Cotton panjabi" />);
    const region = screen.getByRole('region', { name: /Size chart for Cotton panjabi/ });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('overflow-x-auto');
  });

  it('leaves out a missing or empty chart', () => {
    expect(shownSizeChart(null)).toBeNull();
    expect(shownSizeChart(undefined)).toBeNull();
    expect(shownSizeChart({ columns: [], rows: [] })).toBeNull();
    expect(shownSizeChart({ columns: ['Size'], rows: [] })).toBeNull();
    expect(shownSizeChart(chart)).toBe(chart);
  });

  it('says what the measurements are in, for any kind of size', () => {
    const shoes = {
      columns: ['Size', 'Foot length'],
      rows: [
        ['42', '26.5'],
        ['43', '27.3'],
      ],
      unit: 'cm' as const,
    };
    render(<SizeGuideSection chart={shoes} productName="Leather shoe" />);

    expect(screen.getByText('Measurements are in centimetres (cm).')).toBeDefined();
    const table = screen.getByRole('table', { name: /measurements in centimetres \(cm\)/ });
    expect(within(table).getByRole('rowheader', { name: '43' })).toBeDefined();
    expect(within(table).getByText('27.3')).toBeDefined();
  });

  it('shows a chart that is one picture, openable full size', () => {
    const picture = {
      columns: [],
      rows: [],
      mode: 'image' as const,
      imageKey: 'library/abc',
      imageUrl: 'https://media.example.test/library/abc/full.webp',
    };
    expect(shownSizeChart(picture)).toBe(picture);
    render(<SizeGuideSection chart={picture} productName="Cotton panjabi" />);

    expect(screen.queryByRole('table')).toBeNull();
    const image = screen.getByRole('img', { name: 'Size chart for Cotton panjabi' });
    expect(image.getAttribute('src')).toBe(picture.imageUrl);
    expect(
      screen.getByRole('link', { name: 'Open the chart full size' }).getAttribute('href'),
    ).toBe(picture.imageUrl);
  });

  it('shows nothing for a picture chart whose picture is unknown', () => {
    expect(
      shownSizeChart({ columns: [], rows: [], mode: 'image', imageKey: 'library/abc' }),
    ).toBeNull();
  });
});

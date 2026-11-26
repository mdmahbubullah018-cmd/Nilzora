import type { ProductVariant } from '@nilzora/contracts';
import { screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import ProductScreen from '../../app/product/[slug]';
import { highlightedRow, shownSizeChart, spokenRow } from '../features/catalog/size-guide';
import { product } from '../features/catalog/test-fixtures';
import {
  chosenValues,
  isSelectionComplete,
  isValueOffered,
  optionGroups,
  withChoice,
} from '../features/catalog/variant-selection';
import { emptyReviews, myReview } from '../features/reviews/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
}));

const chart = {
  columns: ['Size', 'Chest (cm)', 'Length (cm)'],
  rows: [
    ['M', '96', '72'],
    ['L', '102', ''],
  ],
};

function sized(
  id: string,
  sku: string,
  size: string,
  colour: string,
  overrides: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    sku,
    priceMinor: 125_000,
    compareAtPriceMinor: null,
    availability: 'in_stock',
    maxOrderQuantity: 5,
    imageUrl: null,
    options: [
      { attribute: 'Size', attributeSlug: 'size', value: size, valueSlug: size.toLowerCase() },
      {
        attribute: 'Colour',
        attributeSlug: 'colour',
        value: colour,
        valueSlug: colour.toLowerCase(),
      },
    ],
    ...overrides,
  };
}

const mRed = sized('ee000000-0000-4000-8000-000000000011', 'TEE-M-RED', 'M', 'Red');
const lBlue = sized('ee000000-0000-4000-8000-000000000012', 'TEE-L-BLUE', 'L', 'Blue', {
  priceMinor: 150_000,
});

function productApi(found = product({ variants: [mRed, lBlue], sizeChart: chart })): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: found });
  api.productReviews.mockResolvedValue(emptyReviews());
  api.myProductReview.mockResolvedValue(myReview());
  return api;
}

beforeEach(() => {
  resetRouterMock();
  searchParams.slug = 'cotton-shirt';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('size guide helpers', () => {
  it('shows only a chart with rows', () => {
    expect(shownSizeChart(null)).toBeNull();
    expect(shownSizeChart(undefined)).toBeNull();
    expect(shownSizeChart({ columns: ['Size'], rows: [] })).toBeNull();
    expect(shownSizeChart(chart)).toBe(chart);
  });

  it('shows a chart that is one picture, and not one whose picture is unknown', () => {
    const picture = {
      columns: [],
      rows: [],
      mode: 'image' as const,
      imageKey: 'library/abc',
      imageUrl: 'https://media.example.test/library/abc/full.webp',
    };
    expect(shownSizeChart(picture)).toBe(picture);
    expect(shownSizeChart({ ...picture, imageUrl: undefined })).toBeNull();
  });

  it('shows any kind of size, with its unit, as an ordinary table', () => {
    const shoes = {
      columns: ['Size', 'Foot length'],
      rows: [
        ['42', '26.5'],
        ['43', '27.3'],
      ],
      unit: 'cm' as const,
    };
    expect(shownSizeChart(shoes)).toBe(shoes);
    expect(highlightedRow(shoes, ['43'])).toBe(1);
  });

  it('finds the row of a chosen size, ignoring case, and reads a row aloud', () => {
    expect(highlightedRow(chart, ['l', 'Navy'])).toBe(1);
    expect(highlightedRow(chart, ['XL'])).toBe(-1);
    expect(highlightedRow(chart, [])).toBe(-1);
    expect(spokenRow(chart, ['L', '102', ''])).toBe('L: Chest (cm) 102, Length (cm) not given');
  });
});

describe('choosing a combination', () => {
  const variants = [mRed, lBlue];
  const groups = optionGroups(variants);

  it('tells a value missing from the combination from one sold with it', () => {
    expect(isValueOffered(variants, groups, { size: 'm' }, 'colour', 'red')).toBe(true);
    expect(isValueOffered(variants, groups, { size: 'm' }, 'colour', 'blue')).toBe(false);
  });

  it('keeps the new choice and drops the ones it is not sold with', () => {
    expect(withChoice(variants, { size: 'm', colour: 'red' }, 'size', 'l')).toEqual({ size: 'l' });
    expect(withChoice(variants, { size: 'l' }, 'colour', 'blue')).toEqual({
      colour: 'blue',
      size: 'l',
    });
  });

  it('knows when every attribute is chosen, and the chosen values in order', () => {
    expect(isSelectionComplete(groups, { size: 'm' })).toBe(false);
    expect(isSelectionComplete(groups, { size: 'm', colour: 'blue' })).toBe(true);
    expect(chosenValues(groups, { colour: 'blue', size: 'l' })).toEqual(['L', 'Blue']);
  });
});

describe('ProductScreen size guide', () => {
  it('opens the chart in a sheet and highlights the chosen size', async () => {
    const { user } = await renderWithProviders(<ProductScreen />, { api: productApi() });

    await user.press(await screen.findByRole('button', { name: 'L' }));
    await user.press(screen.getByRole('button', { name: 'Size guide' }));

    const sheet = within(screen.getByTestId('size-guide-sheet'));
    expect(sheet.getByText('Chest (cm)')).toBeOnTheScreen();
    expect(sheet.getByLabelText('L: Chest (cm) 102, Length (cm) not given, your choice')).toBeOnTheScreen();
    expect(sheet.getByLabelText('M: Chest (cm) 96, Length (cm) 72')).toBeOnTheScreen();
  });

  it('has no size guide without a chart', async () => {
    await renderWithProviders(<ProductScreen />, {
      api: productApi(product({ variants: [mRed, lBlue], sizeChart: null })),
    });
    expect(await screen.findByRole('button', { name: 'L' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Size guide' })).toBeNull();
  });

  it('switches to a sold combination instead of holding one that does not exist', async () => {
    const { user } = await renderWithProviders(<ProductScreen />, { api: productApi() });

    await user.press(await screen.findByRole('button', { name: 'M' }));
    await user.press(screen.getByRole('button', { name: 'Red' }));
    expect(screen.getByText('SKU TEE-M-RED')).toBeOnTheScreen();
    // Blue is only sold in L: it is announced as such, and choosing it drops the M.
    const blue = screen.getByRole('button', { name: 'Blue, not with this choice' });
    await user.press(blue);
    expect(screen.queryByText('SKU TEE-M-RED')).toBeNull();
    await user.press(screen.getByRole('button', { name: 'L' }));
    expect(screen.getByText('SKU TEE-L-BLUE')).toBeOnTheScreen();
  });
});

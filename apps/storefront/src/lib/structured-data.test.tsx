import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { detail, productImage } from '@/testing/catalog-fixtures';
import { breadcrumbJsonLd, JsonLd, productJsonLd, serializeJsonLd } from './structured-data';

describe('serializeJsonLd', () => {
  it('can never end its script element early', () => {
    const json = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>' });
  });

  it('escapes the JavaScript line separators too', () => {
    const text = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
    const json = serializeJsonLd({ text });
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(json).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(json)).toEqual({ text });
  });

  it('renders as a JSON-LD script whose text parses back', () => {
    const { container } = render(<JsonLd data={{ '@type': 'Thing', name: 'Mug & <Cup>' }} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(JSON.parse(script?.textContent ?? '')).toEqual({
      '@type': 'Thing',
      name: 'Mug & <Cup>',
    });
  });
});

describe('productJsonLd', () => {
  it('prices a product with variants as a range, buyable when any variant is', () => {
    const product = detail({
      images: [productImage()],
      variants: [
        {
          id: '9a000000-0000-4000-8000-000000000011',
          sku: 'A',
          priceMinor: 100_00,
          compareAtPriceMinor: null,
          availability: 'out_of_stock',
          maxOrderQuantity: 0,
          imageUrl: null,
          options: [],
        },
        {
          id: '9a000000-0000-4000-8000-000000000012',
          sku: 'B',
          priceMinor: 150_50,
          compareAtPriceMinor: null,
          availability: 'low_stock',
          maxOrderQuantity: 2,
          imageUrl: null,
          options: [],
        },
      ],
    });
    expect(productJsonLd(product, '/products/x', undefined)).toMatchObject({
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '100.00',
        highPrice: '150.50',
        offerCount: 2,
        availability: 'https://schema.org/LimitedAvailability',
      },
    });
  });

  it('leaves out what the product does not have', () => {
    const data = productJsonLd(
      detail({ summary: null, description: null, images: [], brand: null }),
      '/products/x',
      {
        averageRating: 0,
        reviewCount: 0,
        distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
      },
    ) as Record<string, unknown>;
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('image');
    expect(data).not.toHaveProperty('brand');
    expect(data).not.toHaveProperty('aggregateRating');
  });
});

describe('breadcrumbJsonLd', () => {
  it('numbers the trail and points the last crumb at this page', () => {
    expect(
      breadcrumbJsonLd([{ label: 'Home', href: '/' }, { label: 'Mug' }], '/products/mug'),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'http://localhost:3000/' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Mug',
          item: 'http://localhost:3000/products/mug',
        },
      ],
    });
  });
});

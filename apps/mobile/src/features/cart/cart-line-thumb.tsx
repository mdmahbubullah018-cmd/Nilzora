import { ProductVisual } from '@/features/catalog/product-visual';

export interface CartLineThumbProps {
  /** The line's picture from the quote; the variant's own when the variant has one. */
  image: { thumbUrl: string } | null;
  /** Edge length in dp. The cart row and the checkout summary use the same square. */
  size?: number;
}

/**
 * The picture of one cart line. It reuses the catalogue's ProductVisual, so a line looks
 * the same here as it does on a product card: the branded tile shows while the photo loads,
 * stays if it fails, and stands in for a product that has no picture at all. Decorative —
 * the product name is directly next to it.
 */
export function CartLineThumb({ image, size = 64 }: CartLineThumbProps) {
  return (
    <ProductVisual
      size="tile"
      imageUri={image?.thumbUrl ?? null}
      style={{ width: size, height: size }}
    />
  );
}

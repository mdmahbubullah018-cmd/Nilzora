/** The wishlist links' accessible name, saying how many products are saved once that is known. */
export function wishlistLabel(count: number): string {
  if (count === 0) return 'Wishlist';
  return `Wishlist, ${count} ${count === 1 ? 'saved product' : 'saved products'}`;
}

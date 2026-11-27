import type { Metadata } from 'next';
import { Container } from '@/components/layout/section';
import { VisualSearch } from '@/components/search/visual-search';

export const metadata: Metadata = {
  title: 'Search by photo',
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: string | string[] | undefined, limit: number): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return undefined;
  const trimmed = first.trim().slice(0, limit);
  return trimmed === '' ? undefined : trimmed;
}

/**
 * /search/image — visual search.
 *
 * With `?product=<id>` it opens as "Find similar products" for that product, seeded with the
 * picture the store already holds (no upload, no embedding). Otherwise it starts at the
 * choose-a-photo step. Everything else happens in the client component: the camera, the crop
 * and the search are per-visitor and never prefetched.
 */
export default async function VisualSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const product = text(params.product, 64);
  const image = text(params.image, 64);
  const thumb = text(params.thumb, 2_000);
  const name = text(params.name, 160);

  return (
    <Container className="py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <VisualSearch
          {...(product !== undefined && UUID.test(product) ? { initialProductId: product } : {})}
          {...(image !== undefined && UUID.test(image) ? { initialImageId: image } : {})}
          {...(thumb !== undefined && /^https:\/\//i.test(thumb)
            ? { initialThumbnail: thumb }
            : {})}
          {...(name !== undefined ? { initialProductName: name } : {})}
        />
      </div>
    </Container>
  );
}

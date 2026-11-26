import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { QueryStateView } from '@/components/query-state';
import { ScreenFrame, STACK_EDGES } from '@/components/screen';
import { queryKeys } from '@/query/query-keys';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { useProduct } from '@/features/catalog/catalog-hooks';
import { isProductNotFound, parseProductSlug, shopHref } from '@/features/catalog/catalog-query';
import { ProductDetailSkeleton } from '@/features/catalog/catalog-skeletons';
import {
  ProductDetailView,
  ProductNotFound,
  ProductStatus,
} from '@/features/catalog/product-detail';

export default function ProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  // A link can carry anything: only a well-formed slug is worth asking the API about.
  const slug = parseProductSlug(params.slug);
  const query = useProduct(slug);
  const queryClient = useQueryClient();
  // Price and stock come from the product; its reviews are separate queries on the same page.
  const { onRefresh } = useManualRefresh(() =>
    Promise.all([
      query.refetch(),
      slug === null
        ? undefined
        : queryClient.refetchQueries({ queryKey: queryKeys.catalog.reviews(slug), type: 'active' }),
    ]),
  );
  const product = query.data;

  const browse = () => {
    router.navigate(shopHref());
  };

  let body;
  if (slug === null || (product === undefined && isProductNotFound(query.error))) {
    body = (
      <ProductStatus>
        <ProductNotFound onBrowse={browse} />
      </ProductStatus>
    );
  } else if (product !== undefined) {
    body = <ProductDetailView product={product} onRefresh={onRefresh} />;
  } else if (query.status === 'error') {
    body = (
      <ProductStatus>
        <QueryStateView
          state="error"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      </ProductStatus>
    );
  } else {
    body = (
      <ProductStatus>
        <ProductDetailSkeleton />
      </ProductStatus>
    );
  }

  return (
    <ScreenFrame edges={STACK_EDGES}>
      <Stack.Screen options={{ title: product?.name ?? 'Product' }} />
      {body}
    </ScreenFrame>
  );
}

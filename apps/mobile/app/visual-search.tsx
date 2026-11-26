import { useLocalSearchParams } from 'expo-router';
import { VisualSearchScreen } from '@/features/visual-search/visual-search-screen';

/**
 * /visual-search — the camera's photo and scan search, opened from the search bar's camera
 * button or a product's "Find similar" action (?product=<id>&name=<product name>).
 */
export default function VisualSearchRoute() {
  const params = useLocalSearchParams<{ product?: string; name?: string }>();
  const product = typeof params.product === 'string' ? params.product : undefined;
  const name = typeof params.name === 'string' ? params.name : undefined;
  return (
    <VisualSearchScreen
      {...(product === undefined ? {} : { initialProductId: product })}
      {...(name === undefined ? {} : { initialProductName: name })}
    />
  );
}

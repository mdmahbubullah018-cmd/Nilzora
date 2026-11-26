import { SearchScreen } from '@/features/search/search-screen';

/**
 * `/search` — the screen Home's search box opens.
 *
 * It draws its own header (back control, field, filter) rather than using the native one, so
 * the field can take focus the moment the screen appears instead of sitting under a bar with
 * an empty title.
 */
export default function SearchRoute() {
  return <SearchScreen />;
}

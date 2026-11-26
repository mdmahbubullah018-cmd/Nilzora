import type { CatalogSort, DiscoverySection, ProductSummary } from '@nilzora/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SearchX } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from 'react-native';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { icons } from '@/components/icon';
import { QueryStateView } from '@/components/query-state';
import { BackButton } from '@/components/screen-header';
import { RefreshableScrollView } from '@/components/pull-to-refresh/pull-to-refresh';
import { ScreenFrame, HEADERLESS_STACK_EDGES } from '@/components/screen';
import { useManualRefresh } from '@/query/use-manual-refresh';
import { SectionHeader } from '@/components/section-header';
import { ListSkeleton } from '@/components/skeleton';
import { describeApiError } from '@/lib/errors';
import { theme } from '@/theme';
import { isVoiceSearchSupported } from '@/voice/native-speech';
import { VoiceSearchModal } from '@/voice/voice-search-modal';
import { useCategories, useProductFacets } from '@/features/catalog/catalog-hooks';
import {
  GRID_GAP,
  SCREEN_PADDING,
  useGridCardWidth,
  useRowCardWidth,
} from '@/features/catalog/catalog-layout';
import {
  facetsQuery,
  parseSearchText,
  productCountLabel,
  SEARCH_SORTS,
  type ShopFilters,
} from '@/features/catalog/catalog-query';
import { FilterSheet } from '@/features/catalog/filter-sheet';
import { useBrands } from '@/features/brands/brand-hooks';
import { ProductCard } from '@/features/catalog/product-card';
import { RecentSearches } from '@/features/catalog/recent-searches-list';
import { ResultsBar } from '@/features/catalog/results-bar';
import { SearchField } from '@/features/catalog/search-field';
import { useRecentSearches } from '@/features/catalog/use-recent-searches';
import {
  isSearchable,
  MIN_SEARCH_LENGTH,
  SEARCH_DEBOUNCE_MS,
  useDiscovery,
  useSearchResults,
} from './search-hooks';

/** Everything the search sheet can narrow the results by, kept together. */
interface SearchRefinements {
  category: string | undefined;
  brand: string | undefined;
  inStock: boolean;
  sizes: readonly string[];
  colors: readonly string[];
  minTaka: number | undefined;
  maxTaka: number | undefined;
}

const NO_REFINEMENTS: SearchRefinements = {
  category: undefined,
  brand: undefined,
  inStock: false,
  sizes: [],
  colors: [],
  minTaka: undefined,
  maxTaka: undefined,
};

/**
 * The Search screen.
 *
 * Its own route rather than the Shop page with a flag, because searching is a different task
 * from browsing: this screen opens on discovery, answers while you type, and hands the settled
 * query to a full result grid.
 *
 * The field's text and the committed query are separate on purpose. Every keystroke updates the
 * field; only a settled query — after the debounce, or when the keyboard's search key is pressed
 * — is requested, and it replaces the grid it already has. That is what keeps a half-typed word
 * from requesting (or showing) a page of results, and it makes one word cost one request.
 */
export function SearchScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInputInstance>(null);
  const gridCard = useGridCardWidth();
  const [text, setText] = useState('');
  const [committed, setCommitted] = useState('');
  const [sort, setSort] = useState<CatalogSort>(SEARCH_SORTS[0]);
  // Every refinement the sheet offers, in one object so the listing request and the badge
  // always agree. Sizes and colours are the store's own variant values.
  const [refine, setRefine] = useState<SearchRefinements>(NO_REFINEMENTS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  // Voice search is offered only where the phone can really do it; Home's microphone opens it at once.
  const voiceSupported = isVoiceSearchSupported();
  const { voice } = useLocalSearchParams<{ voice?: string }>();
  const [voiceOpen, setVoiceOpen] = useState(() => voiceSupported && voice === '1');

  const recents = useRecentSearches();
  const rememberSearch = recents.remember;
  const categories = useCategories();
  const discovery = useDiscovery();

  // The API refuses best-match ranking for a search narrowed by filters, so a search with any
  // refinement is listed newest first and "Best match" is not offered — the same rule the
  // website follows. Without refinements, relevance stays the default.
  const refined =
    refine.category !== undefined ||
    refine.brand !== undefined ||
    refine.inStock ||
    refine.sizes.length > 0 ||
    refine.colors.length > 0 ||
    refine.minTaka !== undefined ||
    refine.maxTaka !== undefined;
  const sorts: readonly CatalogSort[] = refined
    ? SEARCH_SORTS.filter((option) => option !== 'relevance')
    : SEARCH_SORTS;
  const chosenSort = sorts.includes(sort) ? sort : (sorts[0] ?? 'newest');

  const filters: ShopFilters = useMemo(
    () => ({
      q: committed,
      category: refine.category,
      zone: undefined,
      sort: chosenSort,
      brand: refine.brand,
      inStock: refine.inStock,
      sizes: refine.sizes.length > 0 ? refine.sizes : undefined,
      colors: refine.colors.length > 0 ? refine.colors : undefined,
      minTaka: refine.minTaka,
      maxTaka: refine.maxTaka,
    }),
    [committed, refine, chosenSort],
  );
  const results = useSearchResults(filters, { enabled: committed !== '' });
  // The values these results can still be narrowed by, and the brands the store has.
  const facets = useProductFacets(facetsQuery(filters));
  const brands = useBrands();
  const { onRefresh: refreshResults } = useManualRefresh(results.query.refetch);

  // The field opens with the keyboard already up: the customer tapped "search", not "browse".
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setCommitted(parseSearchText(text)), SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  // A term is remembered once its own search has proved it finds something: a half-typed
  // prefix, or a word that matched nothing, is not history worth offering again.
  useEffect(() => {
    if (!isSearchable(committed)) return;
    if (results.total === null || results.total === 0) return;
    rememberSearch(committed);
  }, [committed, results.total, rememberSearch]);

  const draft = parseSearchText(text);
  const showDiscovery = draft === '';
  const tooShort = !showDiscovery && !isSearchable(draft);
  // The badge counts every refinement that is actually narrowing the results.
  const filterCount =
    (refine.category === undefined ? 0 : 1) +
    (refine.brand === undefined ? 0 : 1) +
    (refine.inStock ? 1 : 0) +
    refine.sizes.length +
    refine.colors.length +
    (refine.minTaka === undefined && refine.maxTaka === undefined ? 0 : 1);

  const goBack = useCallback(() => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  const runSearch = useCallback((query: string) => {
    const next = parseSearchText(query);
    setText(next);
    setCommitted(next);
    Keyboard.dismiss();
  }, []);

  const clearAll = useCallback(() => {
    setText('');
    setCommitted('');
    setRefine(NO_REFINEMENTS);
    setSort(SEARCH_SORTS[0]);
    inputRef.current?.focus();
  }, []);

  const loadMore = useCallback(() => {
    if (!results.query.hasNextPage || results.query.isFetchingNextPage) return;
    void results.query.fetchNextPage();
  }, [results.query]);

  return (
    <ScreenFrame edges={HEADERLESS_STACK_EDGES}>
      <VoiceSearchModal
        visible={voiceOpen}
        onClose={() => {
          setVoiceOpen(false);
        }}
        onConfirm={(spoken) => {
          setVoiceOpen(false);
          // The same search the keyboard's search key runs: one request, remembered once it finds something.
          runSearch(spoken);
        }}
      />
      <View testID="search-row" style={styles.searchRow}>
        <BackButton onPress={goBack} />
        <View style={styles.field}>
          <SearchField
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onSubmit={() => {
              runSearch(text);
            }}
            onClear={() => {
              setText('');
              setCommitted('');
            }}
            onFocus={() => {
              setFieldFocused(true);
            }}
            onBlur={() => {
              setFieldFocused(false);
            }}
            onVoice={
              voiceSupported
                ? () => {
                    Keyboard.dismiss();
                    setVoiceOpen(true);
                  }
                : undefined
            }
            onVisualSearch={() => {
              Keyboard.dismiss();
              router.push('/visual-search');
            }}
          />
        </View>
        <IconButton
          icon={icons.filter}
          label={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
          hint="Narrow the results by category, brand, size, colour, price or availability"
          badgeCount={filterCount}
          glass
          onPress={() => {
            setFiltersOpen(true);
          }}
        />
      </View>

      <RefreshableScrollView
        testID="search-scroll"
        style={styles.flex}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        onRefresh={refreshResults}
        // Only the settled results can be refreshed: never while the customer is typing.
        refreshEnabled={!showDiscovery && !tooShort && !fieldFocused && committed !== ''}
      >
        {showDiscovery ? (
          <DiscoveryBody
            sections={discovery.data ?? []}
            loading={discovery.isPending}
            failed={discovery.isError}
            error={discovery.error}
            onRetry={() => void discovery.refetch()}
            recents={recents.queries}
            onRecent={runSearch}
            onClearRecents={recents.clear}
            fieldFocused={fieldFocused}
          />
        ) : tooShort ? (
          <Text style={styles.hint}>{`Type at least ${String(MIN_SEARCH_LENGTH)} letters.`}</Text>
        ) : (
          <Results
            items={results.items}
            total={results.total}
            // While the debounce is pending the skeleton names what is being typed.
            query={committed === '' ? draft : committed}
            cardWidth={gridCard}
            loading={results.query.isPending}
            fetchingMore={results.query.isFetchingNextPage}
            failed={results.query.isError}
            hasNextPage={results.query.hasNextPage}
            error={results.query.error}
            onRetry={() => void results.query.refetch()}
            sort={chosenSort}
            sorts={sorts}
            onSort={(next) => {
              setSort(next);
            }}
            onLoadMore={loadMore}
            onClear={clearAll}
          />
        )}
      </RefreshableScrollView>

      <FilterSheet
        visible={filtersOpen}
        onClose={() => {
          setFiltersOpen(false);
        }}
        categories={categories.data ?? []}
        categoriesLoading={categories.status === 'pending'}
        selectedCategory={refine.category}
        brands={brands.data ?? []}
        brandsLoading={brands.status === 'pending'}
        selectedBrand={refine.brand}
        inStock={refine.inStock}
        facets={facets}
        price={{ minTaka: refine.minTaka, maxTaka: refine.maxTaka }}
        onApply={(next) => {
          setRefine({
            category: next.category,
            brand: next.brand,
            inStock: next.inStock,
            sizes: next.sizes ?? [],
            colors: next.colors ?? [],
            minTaka: next.minTaka,
            maxTaka: next.maxTaka,
          });
        }}
        onReset={() => {
          setRefine(NO_REFINEMENTS);
        }}
      />
    </ScreenFrame>
  );
}

/* ---------------------------------------------------------------- discovery */

function DiscoveryBody({
  sections,
  loading,
  failed,
  error,
  onRetry,
  recents,
  onRecent,
  onClearRecents,
  fieldFocused,
}: {
  sections: readonly DiscoverySection[];
  loading: boolean;
  failed: boolean;
  error: unknown;
  onRetry: () => void;
  recents: readonly string[];
  onRecent: (query: string) => void;
  onClearRecents: () => void;
  fieldFocused: boolean;
}) {
  // While the empty field has focus, this device's own history is the most useful thing to show.
  if (fieldFocused && recents.length > 0) {
    return <RecentSearches queries={recents} onSelect={onRecent} onClear={onClearRecents} />;
  }
  if (loading) return <ListSkeleton rows={3} label="Loading suggestions" />;
  if (failed) {
    return (
      <View style={styles.hintBlock}>
        <Text style={styles.hint}>{describeApiError(error).message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading suggestions again"
          onPress={onRetry}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (sections.length === 0) {
    return (
      <Text style={styles.hint}>Search the shop: type a product, a brand or a category above.</Text>
    );
  }
  return <DiscoveryRails sections={sections} />;
}

/** The suggestion rails, so the card width can follow the screen like Home's rows do. */
function DiscoveryRails({ sections }: { sections: readonly DiscoverySection[] }) {
  // These rails sit inside the page's own padding rather than bleeding to the edges.
  const cardWidth = useRowCardWidth(false);
  return (
    <View style={styles.rails}>
      {sections.map((section) => (
        <View key={section.key} style={styles.rail}>
          <SectionHeader title={section.title} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={cardWidth + GRID_GAP}
            contentContainerStyle={styles.railContent}
            accessibilityLabel={section.title}
          >
            {section.items.map(({ product }) => (
              <ProductCard key={product.id} product={product} width={cardWidth} />
            ))}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ results */

function Results({
  items,
  total,
  query,
  cardWidth,
  loading,
  fetchingMore,
  failed,
  hasNextPage,
  error,
  onRetry,
  sort,
  sorts,
  onSort,
  onLoadMore,
  onClear,
}: {
  items: readonly ProductSummary[];
  total: number | null;
  query: string;
  cardWidth: number;
  loading: boolean;
  fetchingMore: boolean;
  failed: boolean;
  hasNextPage: boolean;
  error: unknown;
  onRetry: () => void;
  sort: CatalogSort;
  /** The orders that make sense for this search: best match only while nothing narrows it. */
  sorts: readonly CatalogSort[];
  onSort: (next: CatalogSort) => void;
  onLoadMore: () => void;
  onClear: () => void;
}) {
  if (failed && items.length === 0) {
    return <QueryStateView state="error" error={error} onRetry={onRetry} retrying={loading} />;
  }
  if (loading) return <ListSkeleton rows={3} label={`Searching for ${query}`} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={`No products match “${query}”`}
        description="Try a different word, or clear the search and browse."
        action={{ label: 'Start a new search', onPress: onClear }}
      />
    );
  }
  return (
    <View style={styles.results}>
      <ResultsBar
        summary={total === null ? null : productCountLabel(total)}
        options={sorts}
        selected={sort}
        onSelect={onSort}
      />
      <View style={styles.grid}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} width={cardWidth} />
        ))}
      </View>
      {hasNextPage ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Load more results"
          disabled={fetchingMore}
          onPress={onLoadMore}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>{fetchingMore ? 'Loading more…' : 'Load more'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /*
   * The search bar's metrics. This screen is headerless, so ScreenFrame pads the status bar once
   * (HEADERLESS_STACK_EDGES) and this row is the first thing under it. A 12dp lead lifts the
   * field clear of the status bar without pushing it down the page — the field is already 48dp,
   * so the row stays inside the first thumb-reach band. The sides use the screen padding, so the
   * back glyph (BackButton insets its own
   * 44dp target) lines up with the content column below rather than 2dp left of it.
   */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  field: { flex: 1 },
  content: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[10],
  },
  hint: { color: theme.colors.mutedForeground, ...theme.text.body },
  hintBlock: { gap: theme.spacing[2], alignItems: 'flex-start' },
  linkButton: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
  },
  linkText: { color: theme.colors.link, ...theme.text.bodyStrong },
  rails: { gap: theme.layout.sectionGap },
  rail: { gap: theme.spacing[3] },
  railContent: { gap: GRID_GAP, paddingRight: theme.spacing[5] },
  results: { gap: theme.spacing[3] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
});

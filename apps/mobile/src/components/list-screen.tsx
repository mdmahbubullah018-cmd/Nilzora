import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, type FlatListProps } from 'react-native';
import { theme } from '@/theme';
import { RefreshableFlatList } from './pull-to-refresh/pull-to-refresh';
import { ScreenFrame, ScreenTitle, type ScreenFrameProps } from './screen';

export interface ListScreenProps<T>
  extends
    Omit<
      FlatListProps<T>,
      | 'refreshControl'
      | 'refreshing'
      | 'onRefresh'
      | 'ListHeaderComponent'
      | 'contentContainerStyle'
      | 'CellRendererComponent'
    >,
    Pick<ScreenFrameProps, 'edges'> {
  title?: string;
  /** Rendered above the title (a logo row, for example); scrolls with the list. */
  header?: ReactNode;
  /** Rendered between the title and the first row (filters, a summary); scrolls with the list. */
  listHeader?: ReactElement | null;
  /** Enables the branded pull-to-refresh: pass useManualRefresh's `onRefresh`. */
  onRefresh?: () => unknown;
  /** Extra space under the last row, so the floating tab bar never covers it. */
  bottomSpace?: number;
}

/**
 * Screen whose body is a virtualised FlatList: safe area, title, keyboard handling and the
 * branded pull-to-refresh, in the same frame as <Screen>. Use it for orders, product
 * listings and anything that can grow; the list state (loading, error, empty) goes in
 * `ListEmptyComponent` using <QueryStateView>. Pass `numColumns` for a grid.
 */
export function ListScreen<T>({
  title,
  header,
  listHeader,
  edges,
  onRefresh,
  bottomSpace = 0,
  ...list
}: ListScreenProps<T>) {
  const heading =
    header || title || listHeader ? (
      <>
        {header}
        {title ? <ScreenTitle>{title}</ScreenTitle> : null}
        {listHeader}
      </>
    ) : null;

  return (
    <ScreenFrame edges={edges}>
      <RefreshableFlatList<T>
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...list}
        ListHeaderComponent={heading ?? undefined}
        contentContainerStyle={
          bottomSpace > 0
            ? [styles.content, { paddingBottom: theme.spacing[10] + bottomSpace }]
            : styles.content
        }
        onRefresh={onRefresh}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[10],
    gap: theme.layout.itemGap,
  },
});

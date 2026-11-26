import type { SizeChart } from '@nilzora/contracts';
import { ChevronRight, Ruler } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheet } from '@/components/bottom-sheet';
import { ZoomableImage } from '@/components/zoomable-image';
import { theme } from '@/theme';

/*
 * The product's size guide: one row under the options that opens a bottom sheet with the
 * chart exactly as the store wrote it. Wide charts scroll sideways inside the sheet. The row
 * whose first entry matches a value the customer has chosen (e.g. "M") is highlighted, so the
 * chosen size is easy to find; that is only a reading aid and never changes the choice.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;
const CELL_WIDTH = 104;

/** A chart that is one picture, when its picture address is known. */
function pictureOf(chart: SizeChart): string | null {
  return chart.mode === 'image' && typeof chart.imageUrl === 'string' && chart.imageUrl !== ''
    ? chart.imageUrl
    : null;
}

const UNIT_NAME: Record<NonNullable<SizeChart['unit']>, string> = {
  cm: 'centimetres (cm)',
  in: 'inches (in)',
  mm: 'millimetres (mm)',
};

/** The chart when it has something to show (a table, or a picture); null for none or an empty one. */
export function shownSizeChart(chart: SizeChart | null | undefined): SizeChart | null {
  if (!chart) return null;
  if (pictureOf(chart) !== null) return chart;
  if (chart.mode === 'image' || chart.columns.length === 0 || chart.rows.length === 0) return null;
  return chart;
}

/** The index of the row naming one of the chosen values, or -1. */
export function highlightedRow(chart: SizeChart, chosenValues: readonly string[]): number {
  const wanted = new Set(chosenValues.map((value) => value.trim().toLocaleLowerCase()));
  if (wanted.size === 0) return -1;
  return chart.rows.findIndex((row) => wanted.has((row[0] ?? '').trim().toLocaleLowerCase()));
}

/** How a screen reader reads one row: "M: Chest (cm) 96, Length (cm) 72". */
export function spokenRow(chart: SizeChart, row: readonly string[]): string {
  const [head = '', ...cells] = row;
  const parts = cells.map((cell, index) => {
    const column = chart.columns[index + 1] ?? '';
    return `${column} ${cell === '' ? 'not given' : cell}`.trim();
  });
  const name = head === '' ? 'Row' : head;
  return parts.length === 0 ? name : `${name}: ${parts.join(', ')}`;
}

export function SizeChartTable({
  chart,
  highlight = -1,
}: {
  chart: SizeChart;
  highlight?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      accessibilityLabel={
        chart.columns.length > 2 ? 'Size chart. Scroll sideways to see every column.' : 'Size chart'
      }
      contentContainerStyle={styles.tableScroll}
      testID="size-chart-table"
    >
      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]} accessibilityRole="header">
          {chart.columns.map((column, index) => (
            <Text
              key={`h-${String(index)}`}
              style={[styles.cell, styles.headCell, index === 0 ? styles.firstCell : null]}
            >
              {column}
            </Text>
          ))}
        </View>
        {chart.rows.map((row, rowIndex) => {
          const selected = rowIndex === highlight;
          return (
            <View
              key={`r-${String(rowIndex)}`}
              accessible
              accessibilityLabel={`${spokenRow(chart, row)}${selected ? ', your choice' : ''}`}
              style={[styles.row, selected ? styles.selectedRow : null]}
            >
              {row.map((cell, cellIndex) => (
                <Text
                  key={`c-${String(cellIndex)}`}
                  style={[
                    styles.cell,
                    cellIndex === 0 ? styles.firstCell : null,
                    cell === '' ? styles.emptyCell : null,
                  ]}
                >
                  {cell === '' ? '–' : cell}
                </Text>
              ))}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export interface SizeGuideProps {
  chart: SizeChart;
  /** The values the customer has chosen so far, e.g. ["M", "Navy"]. */
  chosenValues: readonly string[];
}

export function SizeGuide({ chart, chosenValues }: SizeGuideProps) {
  const [open, setOpen] = useState(false);
  const highlight = highlightedRow(chart, chosenValues);
  const rowCount = chart.rows.length;
  const picture = pictureOf(chart);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Size guide"
        accessibilityHint="Opens the measurements for each size"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen(true);
        }}
        android_ripple={RIPPLE}
        style={({ pressed }) => [styles.trigger, pressed ? styles.triggerPressed : null]}
        testID="size-guide-trigger"
      >
        <View style={styles.triggerLabel}>
          <Ruler size={18} color={theme.colors.link} accessible={false} />
          <Text style={styles.triggerText}>Size guide</Text>
          <Text style={styles.triggerCaption}>
            {picture !== null
              ? 'chart'
              : `${String(rowCount)} ${rowCount === 1 ? 'size' : 'sizes'}`}
          </Text>
        </View>
        <ChevronRight size={16} color={theme.colors.mutedForeground} accessible={false} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Size guide"
        testID="size-guide-sheet"
      >
        <Text style={styles.intro}>
          {picture !== null
            ? 'Pinch or double-tap the chart to look closer.'
            : 'Compare these measurements before you choose a size.'}
        </Text>
        {chart.unit && picture === null ? (
          <Text style={styles.unit}>Measurements are in {UNIT_NAME[chart.unit]}.</Text>
        ) : null}
        {picture !== null ? (
          // A sheet is its own window, so the zoom needs its own gesture root.
          <GestureHandlerRootView style={styles.picture}>
            <ZoomableImage
              uri={picture}
              accessibilityLabel="Size chart"
              testID="size-chart-picture"
            />
          </GestureHandlerRootView>
        ) : (
          <SizeChartTable chart={chart} highlight={highlight} />
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  triggerPressed: { opacity: 0.72 },
  triggerLabel: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  triggerText: { color: theme.colors.link, fontSize: 14, fontWeight: theme.fontWeights.semibold },
  triggerCaption: { color: theme.colors.mutedForeground, fontSize: 13 },
  intro: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  unit: { color: theme.colors.foreground, fontSize: 13, fontWeight: theme.fontWeights.semibold },
  picture: { height: 420, borderRadius: theme.radii.lg, overflow: 'hidden' },
  tableScroll: { flexGrow: 1 },
  table: {
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headRow: { borderTopWidth: 0, backgroundColor: theme.colors.softBackground },
  selectedRow: { backgroundColor: theme.colors.iconSurface },
  cell: {
    width: CELL_WIDTH,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  headCell: { fontWeight: theme.fontWeights.semibold },
  firstCell: { width: 88, fontWeight: theme.fontWeights.semibold },
  emptyCell: { color: theme.colors.mutedForeground },
});

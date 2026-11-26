import type { SizeChart } from '@nilzora/contracts';

/*
 * The product's size chart, exactly as the store wrote it: the column headings and rows the
 * API returned, nothing converted or added. The first column names the row (usually the
 * size), so it is read as the row's heading and stays in view while a wide chart scrolls
 * sideways on a phone. The scroll area can be focused, so a keyboard can scroll it too.
 */

/** A chart that is one picture, when its picture address is known. */
function isPictureChart(chart: SizeChart): chart is SizeChart & { imageUrl: string } {
  return chart.mode === 'image' && typeof chart.imageUrl === 'string' && chart.imageUrl !== '';
}

/** The chart when it has something to show (a table, or a picture); null for none or an empty one. */
export function shownSizeChart(chart: SizeChart | null | undefined): SizeChart | null {
  if (!chart) return null;
  if (isPictureChart(chart)) return chart;
  if (chart.mode === 'image' || chart.columns.length === 0 || chart.rows.length === 0) return null;
  return chart;
}

const UNIT_NAME: Record<NonNullable<SizeChart['unit']>, string> = {
  cm: 'centimetres (cm)',
  in: 'inches (in)',
  mm: 'millimetres (mm)',
};

/** The id the "Size guide" link next to the options jumps to. */
export const SIZE_GUIDE_ID = 'size-guide';

export function SizeChartTable({
  chart,
  productName,
  idPrefix = SIZE_GUIDE_ID,
}: {
  chart: SizeChart;
  productName: string;
  /** Keeps the caption's id unique when the chart is drawn twice on one page. */
  idPrefix?: string;
}) {
  const [first, ...rest] = chart.columns;
  if (isPictureChart(chart)) {
    return (
      <figure
        role="region"
        aria-labelledby={`${idPrefix}-caption`}
        className="grid gap-2 rounded-2xl border border-border bg-surface p-3"
      >
        <figcaption id={`${idPrefix}-caption`} className="sr-only">
          Size chart for {productName}
        </figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- already-optimised WebP from the media service */}
        <img
          src={chart.imageUrl}
          alt={`Size chart for ${productName}`}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[70vh] w-full object-contain"
        />
        <a
          href={chart.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="justify-self-center text-sm font-semibold text-link underline-offset-4 hover:underline"
        >
          Open the chart full size
        </a>
      </figure>
    );
  }
  return (
    <div className="grid gap-2">
      {chart.unit ? (
        <p className="text-xs text-muted-foreground">
          Measurements are in {UNIT_NAME[chart.unit]}.
        </p>
      ) : null}
      <div
        role="region"
        aria-labelledby={`${idPrefix}-caption`}
        tabIndex={0}
        className="max-w-full overflow-x-auto rounded-2xl border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <table className="w-full min-w-max border-collapse text-sm">
          <caption id={`${idPrefix}-caption`} className="sr-only">
            Size chart for {productName}
            {chart.unit ? `, measurements in ${UNIT_NAME[chart.unit]}` : ''}
            {chart.columns.length > 2 ? '. Scroll sideways to see every column.' : ''}
          </caption>
          <thead className="bg-surface-muted">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-surface-muted px-4 py-3 text-left font-semibold whitespace-nowrap text-foreground"
              >
                {first}
              </th>
              {rest.map((column, index) => (
                <th
                  key={`h-${String(index)}`}
                  scope="col"
                  className="px-4 py-3 text-left font-semibold whitespace-nowrap text-foreground"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, rowIndex) => {
              const [head = '', ...cells] = row;
              return (
                <tr key={`r-${String(rowIndex)}`} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-semibold whitespace-nowrap text-foreground"
                  >
                    {head || <span className="sr-only">Not given</span>}
                  </th>
                  {cells.map((cell, cellIndex) => (
                    <td
                      key={`c-${String(cellIndex)}`}
                      className="px-4 py-3 whitespace-nowrap text-foreground tabular-nums"
                    >
                      {cell === '' ? (
                        <span aria-label="Not given" className="text-muted-foreground">
                          –
                        </span>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The "Size guide" section of the product page. */
export function SizeGuideSection({
  chart,
  productName,
}: {
  chart: SizeChart;
  productName: string;
}) {
  return (
    <section
      id={SIZE_GUIDE_ID}
      aria-labelledby={`${SIZE_GUIDE_ID}-heading`}
      className="grid scroll-mt-32 content-start gap-4 border-t border-border pt-8"
    >
      <div className="grid gap-1">
        <h2
          id={`${SIZE_GUIDE_ID}-heading`}
          className="font-display text-xl font-semibold tracking-tight text-foreground"
        >
          Size guide
        </h2>
        <p className="text-sm text-muted-foreground">
          Compare these measurements before you choose a size.
        </p>
      </div>
      <SizeChartTable chart={chart} productName={productName} />
    </section>
  );
}

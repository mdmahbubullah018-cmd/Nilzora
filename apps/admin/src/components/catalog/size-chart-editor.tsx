'use client';

import {
  SIZE_CHART_CELL_MAX,
  SIZE_CHART_MAX_COLUMNS,
  SIZE_CHART_MAX_ROWS,
  SIZE_CHART_UNITS,
  type SizeChartUnit,
} from '@nilzora/contracts';
import { Button, NativeSelect, Textarea } from '@nilzora/ui';
import { Columns3, ImageIcon, Plus, Rows3, Ruler, Table2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { MediaPicker } from '@/components/media/media-picker';
import { EmptyPanel } from './catalog-ui';
import { SIZE_CHART_SEPARATOR, sizeChartCell, sizeChartToText } from './product-validation';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

interface Grid {
  columns: string[];
  rows: string[][];
}

/** The text form read back leniently (the Server Action checks it strictly). */
export function gridFromText(text: string): Grid | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('@'));
  if (lines.length === 0) return null;
  const cells = (line: string) =>
    line.split(SIZE_CHART_SEPARATOR).map((cell) => cell.trim().slice(0, SIZE_CHART_CELL_MAX));
  const [head = '', ...body] = lines;
  const columns = cells(head).slice(0, SIZE_CHART_MAX_COLUMNS);
  const rows = body.slice(0, SIZE_CHART_MAX_ROWS).map((line) => {
    const row = cells(line).slice(0, columns.length);
    return [...row, ...Array<string>(columns.length - row.length).fill('')];
  });
  return { columns, rows };
}

/** The unit the text says its measurements are in ("@unit: cm"), or "" for none. */
function unitFromText(text: string): SizeChartUnit | '' {
  const found = /^@unit\s*:\s*(\w+)/im.exec(text)?.[1]?.toLowerCase();
  return (SIZE_CHART_UNITS as readonly string[]).includes(found ?? '')
    ? (found as SizeChartUnit)
    : '';
}

/** The picture key the text names ("@image: library/..."), or "". */
function imageFromText(text: string): string {
  return /^@image\s*:\s*(\S+)/im.exec(text)?.[1] ?? '';
}

type ChartMode = 'table' | 'image';

/** The settings lines and the table, in the one text field the form posts. */
function composeChart(
  grid: Grid | null,
  unit: SizeChartUnit | '',
  mode: ChartMode,
  imageKey: string,
): string {
  const settings = unit === '' ? [] : [`@unit: ${unit}`];
  if (mode === 'image')
    return imageKey === '' ? '' : [...settings, `@image: ${imageKey}`].join('\n');
  const table = grid ? sizeChartToText({ columns: grid.columns, rows: grid.rows }) : '';
  return table === '' ? '' : [...settings, table].join('\n');
}

/** Starting points: only the size column and the measurements differ between product types. */
const PRESETS: readonly {
  label: string;
  unit: SizeChartUnit;
  columns: string[];
  sizes: string[];
}[] = [
  {
    label: 'Clothing (S to XXL)',
    unit: 'in',
    columns: ['Size', 'Chest', 'Length', 'Shoulder'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    label: 'Waist (28 to 38)',
    unit: 'in',
    columns: ['Size', 'Waist', 'Hip', 'Inseam'],
    sizes: ['28', '30', '32', '34', '36', '38'],
  },
  {
    label: 'Shoes (38 to 43)',
    unit: 'cm',
    columns: ['Size', 'Foot length'],
    sizes: ['38', '39', '40', '41', '42', '43'],
  },
];

const cellClass =
  'h-9 w-full min-w-24 rounded-lg border border-input-border bg-surface px-2.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-ring max-sm:h-11';

export interface SizeChartEditorProps {
  id: string;
  name?: string;
  form?: string;
  /** The chart in its text form ("@unit" / "@image" lines, then one row per line, cells separated by "|"). */
  initial: string;
  /** Lets a picture chart be chosen from the media library; without it the key is typed. */
  csrf?: CsrfInput | undefined;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  onChange?: (text: string) => void;
}

/**
 * A small table editor for a product's size chart: named columns and rows of entries,
 * at most 8 columns and 30 rows. The chart travels as text in one field; without
 * JavaScript that text is edited directly.
 */
export function SizeChartEditor({
  id,
  name = 'sizeChart',
  form,
  initial,
  csrf,
  onChange,
  ...aria
}: SizeChartEditorProps) {
  const tx = useTx();
  const interactive = useInteractive();
  const [gridState, setGrid] = useState<Grid | null>(() => gridFromText(initial));
  const [unit, setUnit] = useState<SizeChartUnit | ''>(() => unitFromText(initial));
  const [imageKey, setImageKey] = useState(() => imageFromText(initial));
  const [mode, setMode] = useState<ChartMode>(() =>
    imageFromText(initial) === '' ? 'table' : 'image',
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  if (!interactive) {
    return (
      <Textarea
        id={id}
        name={name}
        form={form}
        rows={5}
        defaultValue={initial}
        spellCheck={false}
        className="font-mono"
        {...aria}
      />
    );
  }

  const update = (next: Grid | null) => {
    setGrid(next);
    onChange?.(composeChart(next, unit, mode, imageKey));
  };
  const changeSettings = (next: {
    unit?: SizeChartUnit | '';
    mode?: ChartMode;
    imageKey?: string;
  }) => {
    const u = next.unit ?? unit;
    const m = next.mode ?? mode;
    const k = next.imageKey ?? imageKey;
    setUnit(u);
    setMode(m);
    setImageKey(k);
    onChange?.(composeChart(gridState, u, m, k));
  };
  const text = composeChart(gridState, unit, mode, imageKey);
  const hasChart = mode === 'image' || gridState !== null;

  if (!hasChart) {
    return (
      <div className="rounded-xl border border-dashed border-hairline">
        <input type="hidden" name={name} form={form} value="" />
        <EmptyPanel
          icon={Ruler}
          title={tx('No size chart')}
          description={tx(
            'Add one for clothing, shoes or anything sold in sizes. Shoppers see it on the product page.',
          )}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                id={id}
                type="button"
                variant="outline"
                className="max-sm:min-h-11"
                onClick={() => update({ columns: ['Size', ''], rows: [['', '']] })}
              >
                <Plus aria-hidden="true" strokeWidth={1.75} />
                <AutoText>Add a size chart</AutoText>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="max-sm:min-h-11"
                onClick={() => changeSettings({ mode: 'image' })}
              >
                <ImageIcon aria-hidden="true" strokeWidth={1.75} />
                <AutoText>Use a picture instead</AutoText>
              </Button>
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="max-sm:min-h-11"
                  onClick={() => {
                    const next = {
                      columns: preset.columns,
                      rows: preset.sizes.map((size) => [
                        size,
                        ...preset.columns.slice(1).map(() => ''),
                      ]),
                    };
                    setGrid(next);
                    setUnit(preset.unit);
                    onChange?.(composeChart(next, preset.unit, 'table', imageKey));
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          }
          className="py-8"
        />
      </div>
    );
  }

  // A picture chart keeps no table of its own; switching back starts a blank one.
  const grid: Grid = gridState ?? { columns: ['Size', ''], rows: [['', '']] };

  const setColumn = (index: number, value: string) =>
    update({
      ...grid,
      columns: grid.columns.map((column, i) => (i === index ? sizeChartCell(value) : column)),
    });
  const setCell = (row: number, column: number, value: string) =>
    update({
      ...grid,
      rows: grid.rows.map((cells, r) =>
        r === row ? cells.map((cell, c) => (c === column ? sizeChartCell(value) : cell)) : cells,
      ),
    });
  const addColumn = () =>
    update({ columns: [...grid.columns, ''], rows: grid.rows.map((cells) => [...cells, '']) });
  const removeColumn = (index: number) => {
    if (grid.columns.length === 1) return update(null);
    update({
      columns: grid.columns.filter((_, i) => i !== index),
      rows: grid.rows.map((cells) => cells.filter((_, i) => i !== index)),
    });
  };
  const addRow = () =>
    update({ ...grid, rows: [...grid.rows, Array<string>(grid.columns.length).fill('')] });
  const removeRow = (index: number) =>
    update({ ...grid, rows: grid.rows.filter((_, i) => i !== index) });

  const heading = (index: number) => grid.columns[index] || `column ${String(index + 1)}`;

  return (
    <div className="grid gap-3" aria-describedby={aria['aria-describedby']}>
      <input type="hidden" name={name} form={form} value={text} />
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={tx('Chart type')}
          className="inline-flex rounded-lg border border-hairline p-0.5"
        >
          {(['table', 'image'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={mode === choice}
              onClick={() => changeSettings({ mode: choice })}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium max-sm:min-h-11 ${mode === choice ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {choice === 'table' ? (
                <Table2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
              ) : (
                <ImageIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
              )}
              {choice === 'table' ? tx('Measurement table') : tx('Chart picture')}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            <AutoText>Measurements in</AutoText>
          </span>
          <NativeSelect
            value={unit}
            onChange={(event) =>
              changeSettings({ unit: event.currentTarget.value as SizeChartUnit | '' })
            }
            className="h-9 w-48 max-sm:h-11"
          >
            <option value="">{tx('Not shown')}</option>
            <option value="cm">{tx('Centimetres (cm)')}</option>
            <option value="in">{tx('Inches (in)')}</option>
            <option value="mm">{tx('Millimetres (mm)')}</option>
          </NativeSelect>
        </label>
      </div>
      {mode === 'image' ? (
        <div className="grid gap-3 rounded-xl border border-hairline p-3">
          <p className="text-sm text-muted-foreground">
            <AutoText>
              Shoppers see this picture instead of a table. Use a clear, readable photo or drawing
              of the size chart.
            </AutoText>
          </p>
          {imageKey !== '' && preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
            <img
              src={preview}
              alt={tx('The chart picture')}
              className="max-h-64 w-full max-w-md rounded-lg border border-border object-contain"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {csrf ? (
              <Button
                type="button"
                variant="outline"
                className="max-sm:min-h-11"
                onClick={() => setPicking(true)}
              >
                <ImageIcon aria-hidden="true" strokeWidth={1.75} />
                {imageKey === '' ? tx('Choose a picture') : tx('Replace the picture')}
              </Button>
            ) : null}
            <input
              id={id}
              value={imageKey}
              onChange={(event) => changeSettings({ imageKey: event.currentTarget.value.trim() })}
              placeholder="library/…"
              aria-label={tx('Chart picture key')}
              aria-invalid={aria['aria-invalid'] && imageKey === '' ? true : undefined}
              className={`${cellClass} max-w-xs font-mono`}
            />
          </div>
          {csrf ? (
            <MediaPicker
              open={picking}
              onOpenChange={setPicking}
              csrf={csrf}
              selectedKey={imageKey}
              onPick={(picture) => {
                setPreview(picture.thumbUrl);
                changeSettings({ imageKey: picture.key });
              }}
            />
          ) : null}
        </div>
      ) : null}
      {mode === 'table' ? (
        <>
          <div className="nz-scroll overflow-x-auto rounded-xl border border-hairline">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                <AutoText>Size chart</AutoText>
              </caption>
              <thead className="bg-neutral-soft">
                <tr>
                  {grid.columns.map((column, index) => (
                    <th key={`h-${String(index)}`} scope="col" className="p-2 text-left align-top">
                      <div className="flex items-center gap-1">
                        <input
                          id={index === 0 ? id : undefined}
                          value={column}
                          onChange={(event) => setColumn(index, event.currentTarget.value)}
                          maxLength={SIZE_CHART_CELL_MAX}
                          placeholder={index === 0 ? 'Size' : 'Heading'}
                          aria-label={`Column ${String(index + 1)} heading`}
                          aria-invalid={
                            aria['aria-invalid'] && column.trim() === '' ? true : undefined
                          }
                          className={`${cellClass} font-semibold`}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-9 shrink-0 text-muted-foreground max-sm:size-11"
                          aria-label={`Remove the ${heading(index)} column`}
                          onClick={() => removeColumn(index)}
                        >
                          <X aria-hidden="true" strokeWidth={1.75} />
                        </Button>
                      </div>
                    </th>
                  ))}
                  <th scope="col" className="w-12 p-2">
                    <span className="sr-only">
                      <AutoText>Row actions</AutoText>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((cells, row) => (
                  <tr key={`r-${String(row)}`} className="border-t border-hairline">
                    {cells.map((cell, column) => (
                      <td key={`c-${String(column)}`} className="p-2">
                        <input
                          value={cell}
                          onChange={(event) => setCell(row, column, event.currentTarget.value)}
                          maxLength={SIZE_CHART_CELL_MAX}
                          aria-label={`Row ${String(row + 1)}, ${heading(column)}`}
                          className={cellClass}
                        />
                      </td>
                    ))}
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground max-sm:size-11"
                        aria-label={`Remove row ${String(row + 1)}`}
                        onClick={() => removeRow(row)}
                      >
                        <Trash2 aria-hidden="true" strokeWidth={1.75} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:min-h-11"
              onClick={addRow}
              disabled={grid.rows.length >= SIZE_CHART_MAX_ROWS}
            >
              <Rows3 aria-hidden="true" strokeWidth={1.75} />
              <AutoText>Add row</AutoText>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-sm:min-h-11"
              onClick={addColumn}
              disabled={grid.columns.length >= SIZE_CHART_MAX_COLUMNS}
            >
              <Columns3 aria-hidden="true" strokeWidth={1.75} />
              <AutoText>Add column</AutoText>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground max-sm:min-h-11 sm:ml-auto"
              onClick={() => update(null)}
            >
              <Trash2 aria-hidden="true" strokeWidth={1.75} />
              <AutoText>Remove size chart</AutoText>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {grid.columns.length} of {SIZE_CHART_MAX_COLUMNS} columns · {grid.rows.length} of{' '}
            {SIZE_CHART_MAX_ROWS} rows
          </p>
        </>
      ) : null}
    </div>
  );
}

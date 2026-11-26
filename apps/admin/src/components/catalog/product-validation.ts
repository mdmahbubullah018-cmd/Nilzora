import {
  createProductRequestSchema,
  PRODUCT_TAG_LIMIT,
  productTagsSchema,
  SIZE_CHART_CELL_MAX,
  SIZE_CHART_MAX_COLUMNS,
  SIZE_CHART_MAX_ROWS,
  sizeChartInputSchema,
  type CreateProductRequest,
  type SizeChart,
  type SizeChartInput,
  type UpdateProductRequest,
} from '@nilzora/contracts';
import {
  fieldErrorsFrom,
  slugify,
  takaToPoisha,
  wholeNumber,
  type FieldErrors,
  type FormValues,
} from './form-values';

/*
 * The product form's rules, shared by the Server Actions and the form itself: the form
 * runs them while staff type (so mistakes show beside the field before anything is
 * sent), the Server Action runs exactly the same checks again, and the API validates a
 * third time. Every check goes through the contract schemas, so the three never drift.
 * Free of server and Next.js imports.
 */

export const PRODUCT_FIELD_MESSAGES: FieldErrors = {
  categoryId: 'Choose a category.',
  slug: 'Use lower-case letters, digits and single hyphens, e.g. cotton-panjabi.',
  name: 'Enter the product name in 160 characters or fewer.',
  summary: 'Keep the summary under 300 characters.',
  description: 'Keep the description under 5,000 characters.',
  price: 'Enter the price in taka, from ৳0.01 to ৳1,00,00,000, e.g. 1250 or 1250.50.',
  compareAtPrice: 'Enter a former price higher than the price, or leave it empty.',
  maxOrderQuantity: 'Enter a whole number from 1 to 100.',
  sku: 'Use 2 to 40 letters, digits or hyphens, starting with a letter or digit.',
  initialStock: 'Enter a whole number of units from 0 to 10,00,000.',
  tags: `Use up to ${String(PRODUCT_TAG_LIMIT)} tags of lower-case letters, numbers, spaces and hyphens.`,
  sizeChart: 'Check the size chart: name every column and give every row one entry per column.',
};

/** Contract field names that the forms call differently. */
export const PRODUCT_RENAMES = {
  priceMinor: 'price',
  compareAtPriceMinor: 'compareAtPrice',
} as const;

export type ProductSection = 'content' | 'pricing' | 'ordering';
export const PRODUCT_SECTIONS: readonly ProductSection[] = ['content', 'pricing', 'ordering'];

export const CONTENT_FIELDS = ['categoryId', 'slug', 'name', 'summary', 'description'] as const;
export const PRICING_FIELDS = ['price', 'compareAtPrice'] as const;
export const ORDERING_FIELDS = ['maxOrderQuantity', 'isFeatured'] as const;

/**
 * Optional fields: sent only by forms that show them. Left out, the API keeps what the
 * product has (older forms and read-only sections never clear them by accident). The
 * size chart is content (reviewed, locked while on sale); tags are merchandising,
 * changed like the price.
 */
export const OPTIONAL_SECTION_FIELDS: Record<ProductSection, readonly string[]> = {
  content: ['sizeChart'],
  pricing: [],
  ordering: ['tags'],
};

export const SECTION_FIELDS: Record<ProductSection, readonly string[]> = {
  content: CONTENT_FIELDS,
  pricing: PRICING_FIELDS,
  ordering: ORDERING_FIELDS,
};

export const CREATE_FIELDS = [
  ...CONTENT_FIELDS,
  ...PRICING_FIELDS,
  ...ORDERING_FIELDS,
  'sku',
  'initialStock',
] as const;

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

// ---------------------------------------------------------------------------
// Tags: one text field, comma separated ("summer sale, eid-2026")
// ---------------------------------------------------------------------------

/** The tags in a comma-separated field, normalised and de-duplicated by the contract. */
export function parseTags(text: string): Checked<string[]> {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const parsed = productTagsSchema.safeParse(parts);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]?.message;
  return { ok: false, errors: { tags: issue ? `${issue}.` : PRODUCT_FIELD_MESSAGES.tags } };
}

export function tagsToText(tags: readonly string[] | undefined): string {
  return (tags ?? []).join(', ');
}

// ---------------------------------------------------------------------------
// Size chart: one text field, one row per line, cells separated by "|"
// ---------------------------------------------------------------------------

/** The separator between cells in the size chart's text form. */
export const SIZE_CHART_SEPARATOR = '|';

/** A cell as the text form can hold it: no separator and no line breaks. */
export function sizeChartCell(text: string): string {
  return text.replace(/[|\r\n]+/g, '/').slice(0, SIZE_CHART_CELL_MAX);
}

/**
 * A chart's settings travel as lines that start with "@" before the table: "@unit: cm" says what
 * the measurements are in, and "@image: library/..." makes the chart one picture instead of a table.
 */
const DIRECTIVE = /^@(unit|image)\s*:\s*(.*)$/i;

/** "@unit: cm\nSize | Chest\nM | 96" from a chart (null and empty charts become ""). */
export function sizeChartToText(chart: SizeChart | SizeChartInput | null | undefined): string {
  if (!chart) return '';
  const lines: string[] = [];
  if (chart.unit) lines.push(`@unit: ${chart.unit}`);
  if (chart.mode === 'image' && chart.imageKey) {
    lines.push(`@image: ${chart.imageKey}`);
    return lines.join('\n');
  }
  if (chart.columns.length === 0) return '';
  const line = (cells: readonly string[]) =>
    cells.map((cell) => sizeChartCell(cell).trim()).join(` ${SIZE_CHART_SEPARATOR} `);
  return [...lines, line(chart.columns), ...chart.rows.map(line)].join('\n');
}

/**
 * The chart in the text form: the first line names the columns, every other line is a
 * row. Short rows are padded with empty entries; an empty text removes the chart.
 */
export function parseSizeChart(text: string): Checked<SizeChartInput | null> {
  const all = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // The "@unit" and "@image" lines are settings, not table rows.
  let unit: string | undefined;
  let imageKey: string | undefined;
  const lines: string[] = [];
  for (const line of all) {
    const directive = DIRECTIVE.exec(line);
    if (!directive) {
      lines.push(line);
      continue;
    }
    const value = (directive[2] ?? '').trim();
    if ((directive[1] ?? '').toLowerCase() === 'unit') unit = value.toLowerCase();
    else imageKey = value;
  }
  if (all.length === 0) return { ok: true, value: null };
  const settings = {
    ...(unit === undefined || unit === '' ? {} : { unit }),
  };
  if (imageKey !== undefined) {
    const picture = sizeChartInputSchema.safeParse({
      columns: [],
      rows: [],
      mode: 'image',
      imageKey,
      ...settings,
    });
    if (picture.success) return { ok: true, value: picture.data };
    return {
      ok: false,
      errors: { sizeChart: `${picture.error.issues[0]?.message ?? 'Check the chart picture'}.` },
    };
  }
  if (lines.length === 0) return { ok: true, value: null };
  const cells = (line: string) => line.split(SIZE_CHART_SEPARATOR).map((cell) => cell.trim());
  const [head = '', ...body] = lines;
  const columns = cells(head);
  if (columns.length > SIZE_CHART_MAX_COLUMNS) {
    return {
      ok: false,
      errors: { sizeChart: `Use at most ${String(SIZE_CHART_MAX_COLUMNS)} columns.` },
    };
  }
  if (body.length > SIZE_CHART_MAX_ROWS) {
    return {
      ok: false,
      errors: { sizeChart: `Use at most ${String(SIZE_CHART_MAX_ROWS)} rows.` },
    };
  }
  const rows: string[][] = [];
  for (const line of body) {
    const row = cells(line);
    if (row.length > columns.length) {
      return {
        ok: false,
        errors: { sizeChart: 'A row has more entries than there are columns.' },
      };
    }
    rows.push([...row, ...Array<string>(columns.length - row.length).fill('')]);
  }
  const parsed = sizeChartInputSchema.safeParse({ columns, rows, ...settings });
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0]?.message;
  return {
    ok: false,
    errors: { sizeChart: issue ? `${issue}.` : PRODUCT_FIELD_MESSAGES.sizeChart },
  };
}

// ---------------------------------------------------------------------------
// Prices and numbers
// ---------------------------------------------------------------------------

/**
 * Prices as poisha. Amounts that are not taka figures are reported per field before the
 * contract sees them (it would only see "not a number").
 */
export function pricesFrom(values: FormValues): {
  priceMinor?: number;
  compareAtPriceMinor?: number | null;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const priceMinor = takaToPoisha(values.price ?? '');
  if (priceMinor === undefined) errors.price = PRODUCT_FIELD_MESSAGES.price;
  const compareText = values.compareAtPrice ?? '';
  const compareAtPriceMinor = compareText === '' ? null : takaToPoisha(compareText);
  if (compareAtPriceMinor === undefined) {
    errors.compareAtPrice = PRODUCT_FIELD_MESSAGES.compareAtPrice;
  }
  return {
    ...(priceMinor === undefined ? {} : { priceMinor }),
    ...(compareAtPriceMinor === undefined ? {} : { compareAtPriceMinor }),
    errors,
  };
}

function maxQuantityFrom(values: FormValues, errors: FieldErrors): number | undefined {
  const quantity = wholeNumber(values.maxOrderQuantity ?? '');
  if (quantity === undefined) errors.maxOrderQuantity = PRODUCT_FIELD_MESSAGES.maxOrderQuantity;
  return quantity;
}

type OptionalFields = Pick<CreateProductRequest, 'tags' | 'sizeChart'>;

/** The optional fields a form sent, parsed; refusals are added to `errors`. */
function optionalFields(values: FormValues, errors: FieldErrors): OptionalFields {
  const extra: OptionalFields = {};
  if (values.tags !== undefined) {
    const tags = parseTags(values.tags);
    if (tags.ok) extra.tags = tags.value;
    else Object.assign(errors, tags.errors);
  }
  if (values.sizeChart !== undefined) {
    const chart = parseSizeChart(values.sizeChart);
    if (chart.ok) extra.sizeChart = chart.value;
    else Object.assign(errors, chart.errors);
  }
  return extra;
}

/**
 * A blank address is made from the name: without a name there is nothing to report
 * about the address, and a name with no latin letters needs the address typed.
 */
export function withDerivedSlug(errors: FieldErrors, values: FormValues): FieldErrors {
  if (values.slug || errors.slug === undefined) return errors;
  const rest: FieldErrors = { ...errors };
  delete rest.slug;
  if (!values.name) return rest;
  return {
    ...rest,
    slug: 'Type an address: the name has no letters a–z or digits to make one from.',
  };
}

/** Every field of the create form, checked as the API will check it. */
export function checkCreateProduct(values: FormValues): Checked<CreateProductRequest> {
  const { errors, ...prices } = pricesFrom(values);
  const maxOrderQuantity = maxQuantityFrom(values, errors);
  const initialStock = values.initialStock === '' ? 0 : wholeNumber(values.initialStock ?? '');
  if (initialStock === undefined) errors.initialStock = PRODUCT_FIELD_MESSAGES.initialStock;
  const extra = optionalFields(values, errors);

  const parsed = createProductRequestSchema.safeParse({
    categoryId: values.categoryId,
    // A blank address is made from the name.
    slug: values.slug || slugify(values.name ?? ''),
    name: values.name,
    summary: values.summary,
    description: values.description,
    priceMinor: prices.priceMinor ?? 0,
    compareAtPriceMinor: prices.compareAtPriceMinor ?? null,
    maxOrderQuantity: maxOrderQuantity ?? 0,
    isFeatured: values.isFeatured === 'on',
    sku: values.sku,
    initialStock: initialStock ?? 0,
    ...extra,
  });
  if (!parsed.success || Object.keys(errors).length > 0) {
    const contractErrors = parsed.success
      ? {}
      : fieldErrorsFrom(parsed.error.issues, PRODUCT_FIELD_MESSAGES, PRODUCT_RENAMES);
    // Tags and the chart carry their own, more precise messages.
    return { ok: false, errors: withDerivedSlug({ ...contractErrors, ...errors }, values) };
  }
  return { ok: true, value: parsed.data };
}

/** One section's changes, before they are merged into the product as the API has it. */
export function checkSection(
  section: ProductSection,
  values: FormValues,
): Checked<Partial<UpdateProductRequest>> {
  const errors: FieldErrors = {};
  switch (section) {
    case 'content': {
      const extra = optionalFields(
        values.sizeChart === undefined ? {} : { sizeChart: values.sizeChart },
        errors,
      );
      if (Object.keys(errors).length > 0) return { ok: false, errors };
      return {
        ok: true,
        value: {
          categoryId: values.categoryId ?? '',
          slug: values.slug ?? '',
          name: values.name ?? '',
          summary: values.summary ?? '',
          description: values.description ?? '',
          ...extra,
        },
      };
    }
    case 'pricing': {
      const { errors: priceErrors, ...prices } = pricesFrom(values);
      if (Object.keys(priceErrors).length > 0) return { ok: false, errors: priceErrors };
      return { ok: true, value: prices };
    }
    case 'ordering': {
      const maxOrderQuantity = maxQuantityFrom(values, errors);
      const extra = optionalFields(values.tags === undefined ? {} : { tags: values.tags }, errors);
      if (maxOrderQuantity === undefined || Object.keys(errors).length > 0) {
        return { ok: false, errors };
      }
      return {
        ok: true,
        value: { maxOrderQuantity, isFeatured: values.isFeatured === 'on', ...extra },
      };
    }
  }
}

/**
 * Inline checks for the edit form: every shown section's fields against the contract,
 * with the prices checked against each other. The Server Action checks the merged
 * product again (e.g. a new price against a former price it did not show).
 */
export function checkEditFields(
  sections: readonly ProductSection[],
  values: FormValues,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const section of sections) {
    const checked = checkSection(section, values);
    if (!checked.ok) Object.assign(errors, checked.errors);
  }
  const shape = createProductRequestSchema.shape;
  if (sections.includes('content')) {
    // The contract's own content rules (name, address, category, texts).
    const content = {
      categoryId: shape.categoryId.safeParse(values.categoryId ?? ''),
      slug: shape.slug.safeParse(values.slug ?? ''),
      name: shape.name.safeParse(values.name ?? ''),
      summary: shape.summary.safeParse(values.summary ?? ''),
      description: shape.description.safeParse(values.description ?? ''),
    };
    for (const [field, result] of Object.entries(content)) {
      if (!result.success) errors[field] ??= PRODUCT_FIELD_MESSAGES[field];
    }
  }
  if (sections.includes('pricing') && errors.price === undefined) {
    const price = takaToPoisha(values.price ?? '');
    const compare = values.compareAtPrice ? takaToPoisha(values.compareAtPrice) : null;
    if (!shape.priceMinor.safeParse(price).success) errors.price = PRODUCT_FIELD_MESSAGES.price;
    else if (compare != null && price !== undefined && compare <= price) {
      errors.compareAtPrice ??= PRODUCT_FIELD_MESSAGES.compareAtPrice;
    }
  }
  if (sections.includes('ordering') && errors.maxOrderQuantity === undefined) {
    const quantity = wholeNumber(values.maxOrderQuantity ?? '');
    if (!shape.maxOrderQuantity.safeParse(quantity).success) {
      errors.maxOrderQuantity = PRODUCT_FIELD_MESSAGES.maxOrderQuantity;
    }
  }
  return errors;
}

/** The create form's inline checks (the same as the Server Action's). */
export function checkCreateFields(values: FormValues): FieldErrors {
  const checked = checkCreateProduct(values);
  return checked.ok ? {} : checked.errors;
}

/** The discount a former price implies, in whole percent, or null. */
export function discountPercent(priceText: string, compareText: string): number | null {
  const price = takaToPoisha(priceText);
  const compare = takaToPoisha(compareText);
  if (price === undefined || compare === undefined || compare <= price) return null;
  return Math.round(((compare - price) / compare) * 100);
}

import {
  dataHeader,
  dhakaDateTime,
  numberOf,
  percentText,
  takaOf,
  type ReportValue,
  type TabularData,
} from './format';

/*
 * CSV (RFC 4180): fields separated by commas, records by CRLF, a field quoted when it
 * holds a comma, a quote, CR or LF, and quotes inside doubled. The file starts with a
 * UTF-8 byte-order mark so Excel opens Bengali text correctly.
 *
 * Spreadsheet formula injection: a text field that begins with = + - @, a tab or a CR
 * would be run as a formula when the file is opened in a spreadsheet, so such a field is
 * prefixed with a single quote and shown as the text it is. Numbers written for number
 * columns (counts, money, percentages) are never prefixed.
 */

const BOM = '﻿';
const CRLF = '\r\n';
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** Neutralises a text cell a spreadsheet would read as a formula. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One field, quoted when RFC 4180 requires it. */
export function csvField(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cell(
  type: TabularData['columns'][number]['type'],
  value: ReportValue | undefined,
): string {
  if (value === null || value === undefined) return '';
  const number = numberOf(value);
  switch (type) {
    case 'money':
      return number === null ? csvField(guardFormula(String(value))) : takaOf(number).toFixed(2);
    case 'count':
      return number === null ? csvField(guardFormula(String(value))) : String(Math.trunc(number));
    case 'percent':
      return number === null ? csvField(guardFormula(String(value))) : percentText(number);
    case 'datetime':
      return csvField(guardFormula(dhakaDateTime(String(value))));
    case 'date':
    case 'text':
      return csvField(guardFormula(String(value)));
  }
}

/** The whole table as a CSV file (UTF-8 with BOM, CRLF line ends). */
export function writeCsv(table: TabularData): Buffer {
  const lines = [
    table.columns.map((column) => csvField(guardFormula(dataHeader(column)))).join(','),
  ];
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => cell(column.type, row[column.key])).join(','));
  }
  return Buffer.from(BOM + lines.join(CRLF) + CRLF, 'utf8');
}

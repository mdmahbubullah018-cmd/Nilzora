import {
  dataHeader,
  dhakaDateTime,
  numberOf,
  percentText,
  takaOf,
  takaText,
  type TabularData,
} from './format';
import { writeZip } from './zip';

/*
 * A minimal Office Open XML workbook (ECMA-376): one worksheet, written as a ZIP of the
 * six parts Excel, LibreOffice and Google Sheets need. Text uses inline strings (no shared
 * string table). The header row is bold on a light fill and frozen; counts, money and
 * percentages are real numbers (money in taka with a "#,##0.00" format, counts "#,##0",
 * percentages "0.0%"); dates and Dhaka date-times are ISO text. Column widths follow the
 * content. Cells hold values only, never formulas.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Style indexes in styles.xml (cellXfs). */
const STYLE = { text: 0, header: 1, money: 2, count: 3, percent: 4 } as const;

/** Characters XML 1.0 cannot carry are dropped; the five markup characters are escaped. */
function xmlCharacter(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

export function xmlText(value: string): string {
  let kept = '';
  for (const char of value) {
    if (xmlCharacter(char.codePointAt(0) ?? 0)) kept += char;
  }
  return kept
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function stringCell(ref: string, text: string, style: number = STYLE.text): string {
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${String(style)}"` : ''}><is><t${preserve}>${xmlText(text)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${String(style)}"><v>${String(value)}</v></c>`;
}

const STYLES = `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function contentTypes(): string {
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

const ROOT_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>
</Relationships>`;

/** Excel sheet names: at most 31 characters, none of : \ / ? * [ ]. */
export function sheetName(title: string): string {
  const cleaned = title
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned === '' ? 'Report' : cleaned;
}

function workbook(name: string): string {
  return `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

/** Widths in characters, from the header and the longest value (sampled), 8 to 60. */
function columnWidths(table: TabularData, texts: string[][]): number[] {
  return table.columns.map((column, index) => {
    let longest = dataHeader(column).length;
    for (const row of texts.slice(0, 1000)) longest = Math.max(longest, row[index]?.length ?? 0);
    return Math.min(60, Math.max(8, longest + 2));
  });
}

function worksheet(table: TabularData): string {
  const texts: string[][] = [];
  const rows: string[] = [];
  const lastColumn = columnName(Math.max(0, table.columns.length - 1));

  rows.push(
    `<row r="1">${table.columns
      .map((column, index) => stringCell(`${columnName(index)}1`, dataHeader(column), STYLE.header))
      .join('')}</row>`,
  );

  table.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const cells: string[] = [];
    const rowTexts: string[] = [];
    table.columns.forEach((column, index) => {
      const ref = `${columnName(index)}${String(r)}`;
      const value = row[column.key];
      if (value === null || value === undefined) {
        rowTexts.push('');
        return;
      }
      const number = numberOf(value);
      if (column.type === 'money' && number !== null) {
        cells.push(numberCell(ref, takaOf(number), STYLE.money));
        rowTexts.push(takaText(number));
      } else if (column.type === 'count' && number !== null) {
        cells.push(numberCell(ref, Math.trunc(number), STYLE.count));
        rowTexts.push(Math.trunc(number).toLocaleString('en-US'));
      } else if (column.type === 'percent' && number !== null) {
        cells.push(numberCell(ref, number, STYLE.percent));
        rowTexts.push(percentText(number));
      } else {
        const text = column.type === 'datetime' ? dhakaDateTime(String(value)) : String(value);
        cells.push(stringCell(ref, text));
        rowTexts.push(text);
      }
    });
    texts.push(rowTexts);
    rows.push(`<row r="${String(r)}">${cells.join('')}</row>`);
  });

  const widths = columnWidths(table, texts);
  const cols = widths
    .map(
      (width, index) =>
        `<col min="${String(index + 1)}" max="${String(index + 1)}" width="${String(width)}" customWidth="1"/>`,
    )
    .join('');
  const lastRow = String(Math.max(1, table.rows.length + 1));

  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** The table as an .xlsx workbook with one sheet named after `title`. */
export function writeXlsx(table: TabularData, title: string, modified: Date = new Date()): Buffer {
  const part = (text: string) => Buffer.from(text, 'utf8');
  return writeZip(
    [
      { name: '[Content_Types].xml', data: part(contentTypes()) },
      { name: '_rels/.rels', data: part(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: part(workbook(title)) },
      { name: 'xl/_rels/workbook.xml.rels', data: part(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: part(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: part(worksheet(table)) },
    ],
    modified,
  );
}

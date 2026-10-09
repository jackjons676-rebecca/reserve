// ساخت فایل اکسل واقعی (.xlsx) — بدون هیچ کتابخانه بیرونی.
// یک فایل xlsx در واقع ZIP چند فایل XML است؛ اینجا همان ساختار تولید می‌شود.
//
// نکته‌های راست‌چین:
//  - فونت با پشتیبانی فارسی تعریف می‌شود
//  - جهت متن راست‌به‌چپ در سبک‌ها و خود شیت اعلام می‌شود
//  - رشته‌ها به‌صورت inlineStr نوشته می‌شوند تا نیازی به فایل رشته مشترک نباشد

import { createZip } from './zip.js';

const FONT_NAME = 'Tahoma';

// شماره سبک‌ها، هم‌ترتیب با cellXfs در پایین همین فایل
const S = { PLAIN: 0, HEADER: 1, TEXT: 2, NUMBER: 3, PERCENT: 4, TITLE: 5, SUBTITLE: 6 };

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // کاراکترهای کنترلی نامعتبر در XML
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** تبدیل شماره ستون به حرف: ۰ → A، ۲۶ → AA */
export function colName(index) {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** نشانی سلول، مثل B7 */
function ref(col, row) {
  return `${colName(col)}${row}`;
}

function textCell(value, col, row, style = S.TEXT) {
  return `<c r="${ref(col, row)}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function numCell(value, col, row, style = S.NUMBER) {
  return `<c r="${ref(col, row)}" s="${style}"><v>${Number(value)}</v></c>`;
}

/**
 * ساخت فایل اکسل.
 * sheets: [{ name, title, subtitle, freeze, columns:[{title,width,type}], rows:[[...]] }]
 * type: 'text' | 'number' | 'percent'
 */
export function buildWorkbook(sheets) {
  const files = [
    { name: '[Content_Types].xml', data: contentTypes(sheets.length) },
    { name: '_rels/.rels', data: rootRels() },
    { name: 'docProps/app.xml', data: appProps() },
    { name: 'docProps/core.xml', data: coreProps(sheets[0]?.name ?? '') },
    { name: 'xl/workbook.xml', data: workbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels(sheets.length) },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: buildSheet(s) })),
  ];
  return createZip(files);
}

function buildSheet(sheet) {
  const cols = sheet.columns ?? [];
  const lastCol = Math.max(0, cols.length - 1);

  const colsXml = cols.length
    ? `<cols>${cols.map((c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const body = [];
  let row = 1;

  // عنوان و زیرعنوان، روی عرض کل شیت ادغام می‌شوند
  if (sheet.title) {
    body.push(`<row r="${row}" ht="28" customHeight="1">${
      textCell(sheet.title, 0, row, S.TITLE)}</row>`);
    row += 1;
  }
  if (sheet.subtitle) {
    body.push(`<row r="${row}">${textCell(sheet.subtitle, 0, row, S.SUBTITLE)}</row>`);
    row += 1;
  }
  if (sheet.title || sheet.subtitle) {
    body.push(`<row r="${row}"/>`);
    row += 1;
  }

  // سرستون‌ها
  const headerRow = row;
  body.push(`<row r="${row}" ht="24" customHeight="1">${
    cols.map((c, i) => textCell(c.title, i, row, S.HEADER)).join('')}</row>`);
  row += 1;

  for (const data of sheet.rows) {
    const cells = data.map((value, i) => {
      if (value === null || value === undefined || value === '') return '';
      const type = cols[i]?.type ?? 'text';
      if (type === 'percent') return numCell(value, i, row, S.PERCENT);
      // اگر ستون متنی اعلام نشده ولی مقدار واقعاً عدد است،
      // به‌صورت عددی نوشته می‌شود تا در اکسل قابل جمع‌زدن باشد.
      // رشته‌ها (مانند شماره تلفن) دست‌نخورده متن می‌مانند.
      if (type === 'text' && typeof value === 'number' && Number.isFinite(value)) {
        return numCell(value, i, row, S.NUMBER);
      }
      if (type === 'text') return textCell(value, i, row, S.TEXT);
      return numCell(value, i, row, S.NUMBER);
    }).join('');
    body.push(`<row r="${row}">${cells}</row>`);
    row += 1;
  }

  const lastRow = Math.max(headerRow, row - 1);
  const autoFilter = `<autoFilter ref="A${headerRow}:${colName(lastCol)}${lastRow}"/>`;

  // سرستون‌ها هنگام پیمایش صفحه‌های طولانی ثابت بمانند
  const pane = sheet.freeze === false ? ''
    : `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`;

  const merges = [];
  if (sheet.title) merges.push(`<mergeCell ref="A1:${colName(lastCol)}1"/>`);
  if (sheet.subtitle) merges.push(`<mergeCell ref="A2:${colName(lastCol)}2"/>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0" tabSelected="1">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="19"/>
${colsXml}
<sheetData>${body.join('')}</sheetData>
${autoFilter}
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="${FONT_NAME}"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="${FONT_NAME}"/><family val="2"/></font>
<font><sz val="11"/><name val="${FONT_NAME}"/><family val="2"/></font>
<font><b/><sz val="15"/><name val="${FONT_NAME}"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F6F5C"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFD5D5D5"/></left>
<right style="thin"><color rgb="FFD5D5D5"/></right>
<top style="thin"><color rgb="FFD5D5D5"/></top>
<bottom style="thin"><color rgb="FFD5D5D5"/></bottom>
<diagonal/>
</border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function contentTypes(sheetCount) {
  const overrides = Array.from({ length: sheetCount }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${overrides}
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookRels(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rels}
<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const entries = sheets.map((s, i) =>
    `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/>
<sheets>${entries}</sheets>
</workbook>`;
}

function appProps() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>سامانه رزرو سالن</Application>
</Properties>`;
}

function coreProps(name) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(name)}</dc:title>
<dc:creator>سامانه رزرو سالن</dc:creator>
<cp:lastModifiedBy>سامانه رزرو سالن</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

export { S };

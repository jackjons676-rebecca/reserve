import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { buildWorkbook, colName } from '../src/xlsx.js';

test('نام ستون‌ها', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(1), 'B');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(colName(27), 'AB');
  assert.equal(colName(51), 'AZ');
  assert.equal(colName(52), 'BA');
});

/**
 * Expand-Archive فقط پسوند .zip را می‌پذیرد،
 * پس فایل با همان پسوند ذخیره می‌شود.
 * هر تست پوشه خودش را دارد تا تست‌های موازی روی هم نیفتند.
 */
function unpack(name, buf) {
  const dir = `tmp/xlsx-${name}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/book.zip`, buf);
  const out = `${dir}/out`;
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Remove-Item -Recurse -Force '${out}' -ErrorAction SilentlyContinue; ` +
    `Expand-Archive -Path '${dir}/book.zip' -DestinationPath '${out}' -Force`,
  ], { stdio: 'pipe' });
  return (p) => readFileSync(`${out}/${p}`, 'utf8');
}

test('فایل اکسل تولید می‌شود و ویندوز آن را باز می‌کند', () => {
  const buf = buildWorkbook([{
    name: 'گزارش',
    columns: [{ title: 'سالن' }, { title: 'تعداد', type: 'number' }],
    rows: [['تالار اول', 12], ['تالار دوم', 7]],
  }]);
  const xml = unpack('probe', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /<sheetData>/);
  assert.match(xml, /تالار اول/);
  assert.match(xml, /<v>12<\/v>/);
});

test('عدد در ستون متنی هم به‌صورت عدد نوشته می‌شود', () => {
  const buf = buildWorkbook([{
    name: 'گ',
    columns: [{ title: 'مقدار' }],
    rows: [[12]],
  }]);
  const xml = unpack('numtext', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /<v>12<\/v>/, 'عدد باید عدد بماند تا در اکسل قابل جمع باشد');
});

test('شماره تلفن به‌صورت رشته می‌ماند', () => {
  const buf = buildWorkbook([{
    name: 'گ',
    columns: [{ title: 'تلفن' }],
    rows: [['09121234567']],
  }]);
  const xml = unpack('phone', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /09121234567/);
  assert.doesNotMatch(xml, /<v>09121234567<\/v>/, 'تلفن نباید عدد شود');
});

test('همه سلول‌ها نشانی معتبر دارند — هیچ r خالی نمانده', () => {
  const buf = buildWorkbook([{
    name: 'گزارش',
    columns: [{ title: 'الف' }, { title: 'ب' }, { title: 'ج' }],
    rows: [['یک', 'دو', 'سه'], ['چهار', 'پنج', 'شش']],
  }]);
  const xml = unpack('refs', buf)('xl/worksheets/sheet1.xml');

  assert.doesNotMatch(xml, /<c r=""/, 'هیچ سلولی نباید نشانی خالی داشته باشد');
  // سه سرستون به‌علاوه شش سلول داده
  const refs = [...xml.matchAll(/<c r="([A-Z]+\d+)"/g)].map((m) => m[1]);
  assert.equal(refs.length, 9, 'سه سرستون و شش سلول داده');
  for (const r of refs) {
    assert.match(r, /^[A-Z]+[1-9]\d*$/, `نشانی نامعتبر: ${r}`);
  }
  assert.equal(new Set(refs).size, refs.length, 'نشانی تکراری');
});

test('XML هر فایل قابل تجزیه است', () => {
  const buf = buildWorkbook([{
    name: 'گزارش',
    title: 'عنوان گزارش',
    subtitle: 'مهر ۱۴۰۵',
    columns: [{ title: 'الف' }, { title: 'ب' }],
    rows: [['یک', 3]],
  }]);
  const read = unpack('xmlvalid', buf);

  for (const part of [
    '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
    'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    const xml = read(part);
    assert.doesNotThrow(() => new DOMParserProbe(xml), `${part} باید XML معتبر باشد`);
  }
});

/** تجزیه ساده XML برای اطمینان از جفت‌بودن برچسب‌ها */
function DOMParserProbe(xml) {
  const stack = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tag.exec(xml)) !== null) {
    const [, closing, name, , selfClose] = m;
    if (closing) {
      const open = stack.pop();
      if (open !== name) throw new Error(`برچسب ناهماهنگ: ${open} در برابر ${name}`);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`برچسب بازمانده: ${stack.join(', ')}`);
  return true;
}

test('حقیقه‌های XML در متن بسته می‌شود', () => {
  const buf = buildWorkbook([{
    name: 'گزارش',
    columns: [{ title: 'عنوان' }],
    rows: [['کارگاه <ویژه> & "تخصصی"']],
  }]);
  const xml = unpack('escape', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /&lt;ویژه&gt;/);
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;تخصصی&quot;/);
  assert.doesNotMatch(xml, /<ویژه>/, 'برچسب نباید خام وارد شود');
});

test('سبک راست‌چین و فونت فارسی تعریف شده', () => {
  const buf = buildWorkbook([{ name: 'گ', columns: [{ title: 'الف' }], rows: [['ب']] }]);
  const read = unpack('style', buf);

  const styles = read('xl/styles.xml');
  assert.match(styles, /Tahoma/, 'فونت فارسی تعریف شده');
  assert.match(styles, /readingOrder="2"/, 'راست‌به‌چپ بودن متن');

  const sheet = read('xl/worksheets/sheet1.xml');
  assert.match(sheet, /rightToLeft="1"/, 'جهت شیت راست‌چین');
});

test('درصد به‌صورت کسر ذخیره می‌شود', () => {
  const buf = buildWorkbook([{
    name: 'گ',
    columns: [{ title: 'درصد', type: 'percent' }],
    rows: [[0.42]],
  }]);
  const xml = unpack('percent', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /<v>0\.42<\/v>/, 'اکسل درصد را به‌صورت کسر می‌خواهد');
});

test('چند شیت در یک فایل', () => {
  const buf = buildWorkbook([
    { name: 'سالن‌ها', columns: [{ title: 'نام' }], rows: [['الف']] },
    { name: 'دانشکده‌ها', columns: [{ title: 'نام' }], rows: [['ب']] },
  ]);
  const read = unpack('multi', buf);

  assert.match(read('xl/worksheets/sheet1.xml'), /الف/);
  assert.match(read('xl/worksheets/sheet2.xml'), /ب/);
  assert.match(read('xl/workbook.xml'), /سالن‌ها/);
  assert.match(read('xl/workbook.xml'), /دانشکده‌ها/);
  assert.match(read('[Content_Types].xml'), /sheet2\.xml/);
});

test('مقادیر خالی سلول نمی‌سازند', () => {
  const buf = buildWorkbook([{
    name: 'گ',
    columns: [{ title: 'الف' }, { title: 'ب' }],
    rows: [['مقدار', null], ['', undefined]],
  }]);
  const xml = unpack('empty', buf)('xl/worksheets/sheet1.xml');
  // دو سرستون به‌علاوه تنها یک سلول داده
  const cells = [...xml.matchAll(/<c r="/g)];
  assert.equal(cells.length, 3, 'دو سرستون و یک سلول داده');
});

test('عنوان روی عرض شیت ادغام می‌شود', () => {
  const buf = buildWorkbook([{
    name: 'گ',
    title: 'گزارش درصد استفاده',
    columns: [{ title: 'الف' }, { title: 'ب' }, { title: 'ج' }],
    rows: [['یک', 1, 2]],
  }]);
  const xml = unpack('merge', buf)('xl/worksheets/sheet1.xml');
  assert.match(xml, /mergeCell ref="A1:C1"/);
});

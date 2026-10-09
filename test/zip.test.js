import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createZip, crc32 } from '../src/zip.js';

test('CRC32 با مقدار شناخته‌شده', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC32 استاندارد');
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('امضای فایل ZIP', () => {
  const zip = createZip([{ name: 'a.txt', data: 'سلام' }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // دنبال امضای پایان دفترچه بگرد
  let end = -1;
  for (let i = 0; i < zip.length - 4; i += 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  assert.ok(end > 0, 'امضای پایان باید موجود باشد');
  assert.equal(zip.readUInt16LE(end + 8), 1, 'تعداد فایل‌ها');
});

test('ZIP واقعاً توسط ویندوز باز می‌شود و محتوا درست است', () => {
  const zip = createZip([
    { name: 'first.txt', data: 'محتوای فارسی اول' },
    { name: 'nested/second.txt', data: 'second content' },
  ]);

  // پوشه مخصوص این تست تا با تست‌های موازی قاطی نشود
  const dir = 'tmp/zip-open';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/book.zip`, zip);

  // Expand-Archive فقط ZIP معتبر را باز می‌کند
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Remove-Item -Recurse -Force '${dir}/out' -ErrorAction SilentlyContinue; ` +
    `Expand-Archive -Path '${dir}/book.zip' -DestinationPath '${dir}/out' -Force`,
  ], { stdio: 'pipe' });

  const first = readFileSync(`${dir}/out/first.txt`, 'utf8');
  const second = readFileSync(`${dir}/out/nested/second.txt`, 'utf8');
  assert.equal(first, 'محتوای فارسی اول');
  assert.equal(second, 'second content');
});

test('فایل خالی هم درست بسته‌بندی می‌شود', () => {
  const zip = createZip([{ name: 'empty.txt', data: '' }]);
  const dir = 'tmp/zip-empty';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/book.zip`, zip);
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Remove-Item -Recurse -Force '${dir}/out' -ErrorAction SilentlyContinue; ` +
    `Expand-Archive -Path '${dir}/book.zip' -DestinationPath '${dir}/out' -Force`,
  ], { stdio: 'pipe' });
  assert.equal(readFileSync(`${dir}/out/empty.txt`, 'utf8'), '');
});

test('داده بزرگ فشرده می‌شود', () => {
  const big = 'کارگاه آموزشی '.repeat(500);
  const zip = createZip([{ name: 'big.txt', data: big }]);
  assert.ok(zip.length < Buffer.byteLength(big), 'باید کوچک‌تر از ورودی باشد');
  const dir = 'tmp/zip-big';
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/book.zip`, zip);
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Remove-Item -Recurse -Force '${dir}/out' -ErrorAction SilentlyContinue; ` +
    `Expand-Archive -Path '${dir}/book.zip' -DestinationPath '${dir}/out' -Force`,
  ], { stdio: 'pipe' });
  assert.equal(readFileSync(`${dir}/out/big.txt`, 'utf8'), big);
});

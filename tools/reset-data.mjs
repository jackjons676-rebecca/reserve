#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
//  پاک‌کردن کامل داده‌های محلی
//
//  کاربرد: پیش از استقرار، دیتابیس را صفر می‌کند تا سامانه با
//  داده‌های آزمایشی بالا نیاید. روی سرور هم کار می‌کند.
//
//  اجرا:
//    node tools/reset-data.mjs            → فقط پیش‌نمایش، چیزی پاک نمی‌شود
//    node tools/reset-data.mjs --confirm   → واقعاً پاک می‌کند
// ─────────────────────────────────────────────────────────────────

import { existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.RESERVE_DATA ?? join(ROOT, 'data');
const DB_FILE = process.env.RESERVE_DB ?? join(DATA_DIR, 'reserve.db');
const BACKUP_DIR = join(dirname(DB_FILE), 'backups');

const confirmed = process.argv.includes('--confirm');
const keepBackups = process.argv.includes('--keep-backups');

const fileSize = (p) => {
  try { return (statSync(p).size / 1024).toFixed(0) + ' کیلوبایت'; }
  catch { return ''; }
};

console.log('پوشه داده :', DATA_DIR);
console.log('پایگاه‌داده:', DB_FILE);

if (!existsSync(DB_FILE)) {
  console.log('\nپایگاه‌داده‌ای وجود ندارد. کاری لازم نیست.');
  process.exit(0);
}

// شمارش رزروها و کاربران تا بدانید چه چیزی از بین می‌رود
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  const n = (q) => { try { return db.prepare(q).get().n; } catch { return '؟'; } };
  console.log('\nداده‌هایی که پاک می‌شود:');
  console.log('  رزروها :', n('SELECT COUNT(*) AS n FROM bookings'));
  console.log('  سالن‌ها :', n('SELECT COUNT(*) AS n FROM halls'));
  console.log('  کاربران:', n('SELECT COUNT(*) AS n FROM users'));
  db.close();
} catch (err) {
  console.log('\n(شمارش ممکن نشد:', err.message, ')');
}

const backups = existsSync(BACKUP_DIR)
  ? readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db'))
  : [];
console.log('  پشتیبان‌ها:', backups.length, 'فایل');

if (!confirmed) {
  console.log('\nاین فقط پیش‌نمایش بود. برای پاک کردن واقعی:');
  console.log('  node tools/reset-data.mjs --confirm');
  if (backups.length) {
    console.log('\nبرای حذف پشتیبان‌ها هم (اختیاری):');
    console.log('  node tools/reset-data.mjs --confirm --purge-backups');
  }
  process.exit(0);
}

// ── پاک کردن واقعی ──
const purgeBackups = process.argv.includes('--purge-backups');

for (const suffix of ['', '-wal', '-shm', '.restoring']) {
  const p = DB_FILE + suffix;
  try { rmSync(p, { force: true }); } catch { /* نبود */ }
}
console.log('\nپایگاه‌داده پاک شد.');

if (purgeBackups && !keepBackups && existsSync(BACKUP_DIR)) {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  console.log('پوشه پشتیبان‌ها هم پاک شد.');
}

console.log('\nحالا با اجرای این دستور سامانه از صفر بالا می‌آید و صفحه');
console.log('ساخت «مدیر کل» را نشان می‌دهد:');
console.log('  node server.js');
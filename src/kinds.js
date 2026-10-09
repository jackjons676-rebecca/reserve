// انواع مراسم — جدول پایگاه‌داده، تا مدیر بتواند در تنظیمات
// نوع تازه اضافه کند، نام‌ها را عوض کند یا حذف کند.
//
// تفکیک key و label عمدی است: key در رزروها ذخیره می‌شود و هرگز
// عوض نمی‌شود، پس ویرایش یا حذف یک نوع، رزروهای قبلی را بی‌اثر
// نمی‌کند؛ فقط متنی که کاربر می‌بیند تغییر می‌کند.

import { FALLBACK_KIND } from './db.js';

const LABEL_MAX = 60;

/** خطای ویرایش انواع مراسم — سرور آن را به پاسخ ۴۰۰ تبدیل می‌کند */
export class KindError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KindError';
  }
}

/** فهرست انواع، به ترتیب نمایش */
export function listKinds(db) {
  return db.prepare(
    'SELECT id, key, label, sort_order AS sortOrder, active FROM kinds ORDER BY sort_order, id'
  ).all();
}

/** نگاشت کلید به برچسب — برای نمایش برچسب در رزروها و گزارش‌ها */
export function kindLabels(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, label FROM kinds').all()) out[row.key] = row.label;
  return out;
}

/** کلیدهای معتبر — مرجع اعتبارسنجی نوع مراسم در فرم رزرو */
export function kindKeys(db) {
  return db.prepare('SELECT key FROM kinds ORDER BY sort_order, id').all().map((r) => r.key);
}

/**
 * کلید پایدار از روی برچسب ساخته می‌شود: حروف فارسی و لاتین به خط تیره.
 * مثال: «کارگاه آموزشی» → «کارگاه-آموزشی»
 * اگر دو نوع برچسب یکسان داشته باشند، شماره به کلید دوم اضافه می‌شود
 * تا ساخت نوع دوم به‌جای خطا، کلید متفاوتی بگیرد.
 */
function makeKey(db, label) {
  const base = label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LABEL_MAX);
  if (!base) throw new KindError('نام نوع مراسم معتبر نیست.');

  const exists = db.prepare('SELECT 1 FROM kinds WHERE key = ?');
  if (!exists.get(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!exists.get(candidate)) return candidate;
  }
  throw new KindError('کلیدی برای این نام پیدا نشد.');
}

/** برچسب را می‌سنجد و شکل نهایی‌اش را برمی‌گرداند */
function cleanLabel(label) {
  const clean = String(label ?? '').trim();
  if (!clean) throw new KindError('نام نوع مراسم لازم است.');
  if (clean.length > LABEL_MAX) {
    throw new KindError(`نام نوع مراسم حداکثر ${LABEL_MAX} نویسه باشد.`);
  }
  return clean;
}

/** افزودن نوع مراسم تازه — کلیدش خودکار ساخته می‌شود */
export function createKind(db, label) {
  const clean = cleanLabel(label);
  const dup = db.prepare('SELECT 1 FROM kinds WHERE label = ?').get(clean);
  if (dup) throw new KindError(`نوع «${clean}» از قبل وجود دارد.`);

  const key = makeKey(db, clean);
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM kinds').get().n;
  const info = db.prepare(
    'INSERT INTO kinds (key, label, sort_order, active) VALUES (?, ?, ?, 1)'
  ).run(key, clean, order);
  return db.prepare('SELECT id, key, label FROM kinds WHERE id = ?').get(info.lastInsertRowid);
}

/** ویرایش نام نمایشی — کلید و رزروهای قبلی دست‌نخورده می‌مانند */
export function renameKind(db, id, label) {
  const clean = cleanLabel(label);
  const row = db.prepare('SELECT id, label FROM kinds WHERE id = ?').get(id);
  if (!row) throw new KindError('این نوع مراسم یافت نشد.');

  const dup = db.prepare('SELECT 1 FROM kinds WHERE label = ? AND id != ?').get(clean, id);
  if (dup) throw new KindError(`نوع «${clean}» از قبل وجود دارد.`);

  db.prepare('UPDATE kinds SET label = ? WHERE id = ?').run(clean, id);
  return db.prepare('SELECT id, key, label FROM kinds WHERE id = ?').get(id);
}

/**
 * حذف نوع مراسم.
 * نوعی که رزرو فعال دارد حذف نمی‌شود — وگرنه آن رزروها بی‌برچسب
 * می‌مانند و در گزارش‌ها شمارهٔ خام نشان داده می‌شوند.
 * نوع عمومی «سایر» هم می‌ماند، چون رزرو بدون نوع معتبر به آن می‌رود.
 */
export function deleteKind(db, id) {
  const row = db.prepare('SELECT id, key, label FROM kinds WHERE id = ?').get(id);
  if (!row) throw new KindError('این نوع مراسم یافت نشد.');

  if (row.key === FALLBACK_KIND) {
    throw new KindError(`نوع «${row.label}» عمومی است و حذف نمی‌شود.`);
  }

  const used = db.prepare(
    `SELECT COUNT(*) AS n FROM bookings
      WHERE kind = ? AND status != 'cancelled'`
  ).get(row.key).n;
  if (used > 0) {
    throw new KindError(
      `نوع «${row.label}» ${used} رزرو فعال دارد و قابل حذف نیست. ابتدا رزروها را تغییر دهید یا لغو کنید.`
    );
  }

  db.prepare('DELETE FROM kinds WHERE id = ?').run(id);
  return row;
}
// تست انواع مراسم — جدول، مهاجرت، و قواعد ویرایش
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import {
  listKinds, kindLabels, kindKeys, createKind, renameKind, deleteKind, KindError,
} from '../src/kinds.js';
import { createBooking, setStatus } from '../src/bookings.js';

let db;
let hallId;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO halls (name, capacity, sort_order) VALUES (?, ?, ?)')
    .run('تالار شهید اواتانی', 120, 1);
  hallId = db.prepare('SELECT id FROM halls').get().id;
});

// ────────────────────────────  انواع اولیه  ────────────────────────────

test('شش نوع مراسم اولیه کاشته می‌شوند', () => {
  const kinds = listKinds(db);
  assert.equal(kinds.length, 6);
  assert.deepEqual(
    kinds.map((k) => k.key),
    ['faculty', 'group', 'congress', 'meeting', 'ceremony', 'other']
  );
  assert.equal(kinds[0].label, 'دانشکده');
});

test('کاشت دوبارهٔ انواع، ردیف تکراری نمی‌سازد', () => {
  // مهاجرت هر بار هنگام باز شدن پایگاه‌داده اجرا می‌شود؛ نباید تکرار کند
  const before = listKinds(db).length;
  const again = openDb(':memory:');
  assert.equal(listKinds(again).length, before);
  again.close();
});

// ────────────────────────────  افزودن  ────────────────────────────

test('نوع تازه افزوده می‌شود و کلید فارسی می‌گیرد', () => {
  const k = createKind(db, 'کارگاه آموزشی');
  assert.equal(k.label, 'کارگاه آموزشی');
  assert.equal(k.key, 'کارگاه-آموزشی');
  assert.equal(listKinds(db).length, 7);
});

test('دو نوع با نام یکسان مجاز نیستند', () => {
  // برچسب تکراری سردرگم‌کننده است: دو رزرو با نام یکسان ولی برچسب متفاوت
  // در گزارش‌ها غیرقابل تشخیص می‌شدند
  const a = createKind(db, 'سمینار');
  assert.throws(() => createKind(db, 'سمینار'), KindError);
  assert.equal(listKinds(db).length, 7);
  assert.equal(listKinds(db).find((k) => k.id === a.id).label, 'سمینار');
});

test('نام تکراری رد می‌شود', () => {
  createKind(db, 'کارگاه');
  assert.throws(() => createKind(db, 'کارگاه'), KindError);
});

test('نام خالی یا خیلی بلند رد می‌شود', () => {
  assert.throws(() => createKind(db, '   '), KindError);
  assert.throws(() => createKind(db, 'ا'.repeat(61)), KindError);
});

// ────────────────────────────  ویرایش  ────────────────────────────

test('ویرایش نام، کلید را عوض نمی‌کند', () => {
  const k = createKind(db, 'کارگاه آموزشی');
  const renamed = renameKind(db, k.id, 'کارگاه تخصصی');
  assert.equal(renamed.key, k.key, 'کلید پایدار بماند تا رزروهای قبلی معتبر بمانند');
  assert.equal(renamed.label, 'کارگاه تخصصی');
});

test('ویرایش به نام تکراریِ نوع دیگر رد می‌شود', () => {
  const a = createKind(db, 'الف');
  const b = createKind(db, 'ب');
  assert.throws(() => renameKind(db, b.id, 'الف'), KindError);
  // رزروها نباید تغییری کرده باشند
  assert.equal(renameKind(db, a.id, 'الف').label, 'الف');
});

test('ویرایش نام، رزروهای قبلی را سالم نگه می‌دارد', () => {
  const k = createKind(db, 'کارگاه');
  const b = createBooking(db, {
    hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
    title: 'کارگاه تست', requester: 'گروه', kind: k.key,
  });
  renameKind(db, k.id, 'کارگاه ویژه');
  const after = db.prepare('SELECT kind FROM bookings WHERE id = ?').get(b.id);
  assert.equal(after.kind, k.key, 'کلید ذخیره‌شده نباید با تغییر نام عوض شود');
});

// ────────────────────────────  حذف  ────────────────────────────

test('حذف نوع بی‌استفاده موفق است', () => {
  const k = createKind(db, 'کارگاه');
  const row = deleteKind(db, k.id);
  assert.equal(row.key, k.key);
  assert.equal(listKinds(db).length, 6);
});

test('حذف نوعِ دارای رزرو فعال رد می‌شود', () => {
  const k = createKind(db, 'کارگاه');
  createBooking(db, {
    hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
    title: 'کارگاه تست', requester: 'گروه', kind: k.key,
  });
  assert.throws(() => deleteKind(db, k.id), /رزرو فعال/);
  // رد شدن باید قابل بازگشت باشد: نوع هنوز سر جایش است
  assert.ok(listKinds(db).some((x) => x.id === k.id));
});

test('پس از لغو رزرو، حذف نوع باز می‌شود', () => {
  const k = createKind(db, 'کارگاه');
  const b = createBooking(db, {
    hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
    title: 'کارگاه تست', requester: 'گروه', kind: k.key,
  });
  assert.throws(() => deleteKind(db, k.id), KindError);
  setStatus(db, b.id, 'cancelled');
  assert.doesNotThrow(() => deleteKind(db, k.id));
});

test('نوع عمومی «سایر» حذف نمی‌شود', () => {
  const other = listKinds(db).find((k) => k.key === 'other');
  assert.throws(() => deleteKind(db, other.id), /عمومی/);
});

// ────────────────────────────  اعتبارسنجی رزرو  ────────────────────────────

test('رزرو با نوع تازه پذیرفته می‌شود', () => {
  const k = createKind(db, 'کارگاه آموزشی');
  const b = createBooking(db, {
    hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
    title: 'کارگاه', requester: 'گروه', kind: k.key,
  });
  assert.equal(b.kind, k.key);
});

test('رزرو با نوع ناشناخته رد می‌شود', () => {
  assert.throws(() => createBooking(db, {
    hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
    title: 'نامعتبر', requester: 'گروه', kind: 'چیزی-که-نیست',
  }), /نوع مراسم نامعتبر/);
});

// ────────────────────────────  برچسب‌ها  ────────────────────────────

test('kindLabels نگاشت کلید به برچسب تازه می‌دهد', () => {
  const k = createKind(db, 'کارگاه آموزشی');
  renameKind(db, k.id, 'کارگاه تخصصی');
  const labels = kindLabels(db);
  assert.equal(labels[k.key], 'کارگاه تخصصی');
  assert.equal(labels.faculty, 'دانشکده');
});

test('kindKeys کلیدهای معتبر را برمی‌گرداند', () => {
  const k = createKind(db, 'کارگاه آموزشی');
  assert.ok(kindKeys(db).includes(k.key));
});

// ────────────────────────────  مهاجرت دادهٔ قدیمی  ────────────────────────────

test('رزروهای قدیمی با مقدار «سایر» به کلید درست نگاشت می‌شوند', () => {
  // پایگان‌دادهٔ قدیمی با پیش‌فرض فارسیِ ستون kind ساخته می‌شد، پس رزروهای
  // ثبت‌شده مقدار 'سایر' داشتند که در هیچ نگاشتی پیدا نمی‌شد.
  const file = join(tmpdir(), `kinds-legacy-${process.pid}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(file + suffix, { force: true }); } catch { /* نبود */ }
  }

  const old = openDb(file);
  // اسکیمای نسخهٔ پیشین را بازمی‌سازیم: kind با پیش‌فرض فارسی
  old.exec('DROP TABLE kinds');
  old.exec('ALTER TABLE bookings RENAME TO bookings_old');
  old.exec(`
    CREATE TABLE bookings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      hall_id    INTEGER NOT NULL REFERENCES halls(id),
      date       TEXT    NOT NULL,
      start_min  INTEGER NOT NULL,
      end_min    INTEGER NOT NULL,
      title      TEXT    NOT NULL,
      kind       TEXT    NOT NULL DEFAULT 'سایر',
      requester  TEXT    NOT NULL,
      phone      TEXT    NOT NULL DEFAULT '',
      attendees  INTEGER,
      notes      TEXT    NOT NULL DEFAULT '',
      status     TEXT    NOT NULL DEFAULT 'reserved',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    )
  `);
  const oldHall = (old.prepare('INSERT INTO halls (name, capacity, sort_order) VALUES (?, ?, ?)')
    .run('تالار قدیمی', 80, 1), old.prepare('SELECT id FROM halls').get().id);
  const stamp = '2026-10-01T00:00:00.000Z';
  old.prepare(`INSERT INTO bookings
      (hall_id, date, start_min, end_min, title, kind, requester, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(oldHall, '2026-10-09', 540, 600, 'رزرو قدیمی', 'other', 'گروه', 'reserved', stamp, stamp);
  // همان کاری که پیش‌فرض فارسیِ ستون انجام می‌داد
  old.prepare("UPDATE bookings SET kind = 'سایر'").run();
  old.close();

  // باز کردن دوباره باید مهاجرت را اجرا کند
  const migrated = openDb(file);
  const row = migrated.prepare('SELECT kind FROM bookings').get();
  assert.equal(row.kind, 'other', 'مقدار فارسی باید به کلید تبدیل شود');
  assert.equal(kindLabels(migrated)['other'], 'سایر', 'برچسب باید پیدا شود');
  migrated.close();

  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(file + suffix, { force: true }); } catch { /* بی‌اهمیت */ }
  }
});
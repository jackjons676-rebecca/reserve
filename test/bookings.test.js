import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBooking, updateBooking, setStatus, findConflicts, getBooking,
  BookingError, STATUSES, overlaps, timeToMinutes, minutesToTime, durationHours,
} from '../src/bookings.js';

let db;
let hallId;

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO halls (name, capacity, sort_order) VALUES (?, ?, ?)')
    .run('تالار شهید اواتانی', 120, 1);
  hallId = db.prepare('SELECT id FROM halls').get().id;
});

const booking = (over = {}) => ({
  hallId, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
  title: 'جلسه', requester: 'دانشکده پزشکی', ...over,
});

test('تبدیل ساعت', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('23:59'), 1439);
  assert.equal(timeToMinutes('9:05'), 545, 'تک‌رقمی هم پذیرفته شود');
  assert.equal(timeToMinutes('24:00'), null);
  assert.equal(timeToMinutes('09:60'), null);
  assert.equal(timeToMinutes('abc'), null);
  assert.equal(minutesToTime(570), '09:30');
  assert.equal(minutesToTime(0), '00:00');
});

test('محاسبه مدت', () => {
  assert.equal(durationHours(540, 600), 1);
  assert.equal(durationHours(540, 660), 2);
});

test('تشخیص هم‌پوشانی در سطح تابع', () => {
  assert.equal(overlaps(540, 600, 570, 660), true, 'نیمه‌هم‌پوشان');
  assert.equal(overlaps(540, 660, 570, 600), true, 'کاملاً داخل');
  assert.equal(overlaps(570, 660, 540, 600), true, 'کاملاً داخل، معکوس');
  assert.equal(overlaps(540, 660, 540, 600), true, 'شروع یکسان');
  assert.equal(overlaps(540, 600, 600, 660), false, 'لمسی: پایان یکی = شروع دیگری');
  assert.equal(overlaps(600, 660, 540, 600), false, 'لمسی، معکوس');
  assert.equal(overlaps(540, 600, 601, 660), false, 'با فاصله');
  assert.equal(overlaps(540, 720, 600, 660), true, 'دربرگیرنده');
});

test('ثبت رزرو ساده', () => {
  const b = createBooking(db, booking());
  assert.ok(b.id > 0);
  assert.equal(b.hall_name, 'تالار شهید اواتانی');
  assert.equal(b.start_min, 540);
  assert.equal(b.end_min, 660);
  assert.equal(b.status, STATUSES.RESERVED);
});

test('تداخل کامل جلوگیری می‌شود', () => {
  createBooking(db, booking());
  assert.throws(
    () => createBooking(db, booking({ title: 'مراسم دیگر', startTime: '10:00', endTime: '12:00' })),
    (e) => e instanceof BookingError && /تداخل/.test(e.message)
  );
});

test('رزرو مجاور مجاز است — پایان یکی برابر شروع دیگری', () => {
  createBooking(db, booking());
  const b = createBooking(db, booking({ startTime: '11:00', endTime: '13:00' }));
  assert.equal(b.id > 0, true);
  const before = createBooking(db, booking({ startTime: '07:00', endTime: '09:00' }));
  assert.equal(before.id > 0, true);
});

test('رزرو لغوشده مانع رزرو جدید نیست', () => {
  const first = createBooking(db, booking());
  setStatus(db, first.id, STATUSES.CANCELLED);
  const second = createBooking(db, booking());
  assert.equal(second.id > 0, true);
});

test('رزرو لغوشده سالن را اشغال نگه نمی‌دارد', () => {
  const first = createBooking(db, booking());
  setStatus(db, first.id, STATUSES.CANCELLED);
  // پس از لغو، همان بازه باید آزاد باشد
  const second = createBooking(db, booking({ startTime: '10:30', endTime: '11:30' }));
  assert.ok(second.id > 0);
});

test('وضعیت‌های حذف‌شده پذیرفته نمی‌شوند', () => {
  // «تحویل شد» و «تحویل گرفته شد» حذف شده‌اند
  assert.ok(!('HANDED' in STATUSES), 'HANDED باید از وضعیت‌ها حذف شده باشد');
  assert.ok(!('RETURNED' in STATUSES), 'RETURNED باید از وضعیت‌ها حذف شده باشد');
  const b = createBooking(db, booking());
  for (const gone of ['handed', 'returned']) {
    assert.throws(() => setStatus(db, b.id, gone), BookingError, `وضعیت ${gone} باید رد شود`);
  }
});

test('مهاجرت، نخستین مدیر قدیمی را به مدیر کل ارتقا می‌دهد', () => {
  // یک پایگاه‌دادهٔ واقعی روی دیسک می‌سازیم که فقط یک مدیر دارد و
  // هیچ مدیر کلی ندارد — دقیقاً وضعیت نسخه‌های پیشین.
  const file = join(tmpdir(), `reserve-migrate-${process.pid}.db`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(file + suffix, { force: true }); } catch { /* نبود */ }
  }

  const legacy = openDb(file);
  legacy.prepare(`
    INSERT INTO users (username, full_name, role, pin_salt, pin_hash, active, created_at)
    VALUES ('oldadmin', 'مدیر قدیمی', 'admin', 's', 'h', 1, '2020-01-01')
  `).run();
  legacy.prepare(`
    INSERT INTO users (username, full_name, role, pin_salt, pin_hash, active, created_at)
    VALUES ('olduser', 'کاربر قدیمی', 'user', 's', 'h', 1, '2020-01-01')
  `).run();
  legacy.close();

  // باز کردن دوباره، مهاجرت را اجرا می‌کند
  const migrated = openDb(file);
  const rows = migrated.prepare('SELECT username, role FROM users ORDER BY id').all();
  migrated.close();

  assert.equal(rows.find((r) => r.username === 'oldadmin').role, 'super',
    'نخستین مدیر باید مدیر کل شود');
  assert.equal(rows.find((r) => r.username === 'olduser').role, 'user',
    'کاربر عادی نباید دست بخورد');

  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(file + suffix, { force: true }); } catch { /* بی‌اهمیت */ }
  }
});

test('ویرایش رزرو تداخل دیگری را رد می‌کند', () => {
  const a = createBooking(db, booking());
  const b = createBooking(db, booking({ startTime: '11:00', endTime: '13:00' }));
  assert.throws(() => updateBooking(db, a.id, { endTime: '12:00' }), BookingError);
  // جابه‌جایی به بازه آزاد باید بپذیرد
  const moved = updateBooking(db, a.id, { startTime: '13:30', endTime: '14:30' });
  assert.equal(moved.start_min, 810);
  assert.ok(b.id > 0);
});

test('ویرایش بدون تغییر بازه با رزرو خودش تداخل ندارد', () => {
  const a = createBooking(db, booking());
  const updated = updateBooking(db, a.id, { title: 'عنوان تازه' });
  assert.equal(updated.title, 'عنوان تازه');
});

test('ویرایش به بازه آزاد بعد از لغو رزرو دیگر ممکن است', () => {
  const a = createBooking(db, booking());
  const b = createBooking(db, booking({ startTime: '11:00', endTime: '13:00' }));
  setStatus(db, b.id, STATUSES.CANCELLED);
  const merged = updateBooking(db, a.id, { endTime: '13:30' });
  assert.equal(merged.end_min, 810);
});

test('یک سالن دیگر در همان ساعت تداخل نیست', () => {
  db.prepare('INSERT INTO halls (name, sort_order) VALUES (?, ?)').run('سالن دوم', 2);
  const other = db.prepare('SELECT id FROM halls WHERE name = ?').get('سالن دوم').id;
  createBooking(db, booking());
  const b = createBooking(db, booking({ hallId: other }));
  assert.ok(b.id > 0);
});

test('روز دیگر در همان ساعت تداخل نیست', () => {
  createBooking(db, booking());
  const b = createBooking(db, booking({ date: '2026-10-10' }));
  assert.ok(b.id > 0);
});

test('اعتبارسنجی ورودی — همه خطاها یکجا', () => {
  assert.throws(() => createBooking(db, booking({ title: '   ' })), /عنوان/);
  assert.throws(() => createBooking(db, booking({ requester: '' })), /درخواست‌دهنده/);
  assert.throws(() => createBooking(db, booking({ endTime: '08:00' })), /بعد از ساعت شروع/);
  assert.throws(() => createBooking(db, booking({ date: '2026-13-45' })), /تاریخ/);
  assert.throws(() => createBooking(db, booking({ attendees: -5 })), /حاضران/);
});

test('خطاهای اعتبارسنجی با هم جمع می‌شوند', () => {
  try {
    createBooking(db, booking({ title: '', requester: '', endTime: '08:00' }));
    assert.fail('باید خطا می‌داد');
  } catch (e) {
    assert.match(e.message, /عنوان/);
    assert.match(e.message, /درخواست‌دهنده/);
    assert.match(e.message, /ساعت پایان/);
  }
});

test('پیام خطای تداخل شامل جزئیات رزرو قبلی است', () => {
  createBooking(db, booking({ title: 'کارگاه', requester: 'گروه الف' }));
  try {
    createBooking(db, booking({ startTime: '10:00', endTime: '11:00' }));
    assert.fail('باید خطا می‌داد');
  } catch (e) {
    assert.equal(e.conflicts.length, 1);
    assert.equal(e.conflicts[0].title, 'کارگاه');
    assert.equal(e.conflicts[0].requester, 'گروه الف');
  }
});

test('درگیری هم‌زمان: دو درخواست، فقط یکی موفق می‌شود', () => {
  createBooking(db, booking());
  // شبیه‌سازی اینکه رزرو دوم در همان بازه بخواهد ثبت شود
  const conflicts = findConflicts(db, {
    hallId, date: '2026-10-09', startMin: 570, endMin: 630,
  });
  assert.equal(conflicts.length, 1);
  assert.throws(() => createBooking(db, booking({ startTime: '09:30', endTime: '10:30' })), BookingError);
});

test('تغییر وضعیت و حذف', () => {
  const b = createBooking(db, booking());
  assert.equal(setStatus(db, b.id, STATUSES.CANCELLED).status, STATUSES.CANCELLED);
  assert.throws(() => setStatus(db, b.id, 'نامعتبر'), BookingError);
  assert.throws(() => setStatus(db, 9999, STATUSES.CANCELLED), /یافت نشد/);
  assert.equal(getBooking(db, b.id).status, STATUSES.CANCELLED);
});

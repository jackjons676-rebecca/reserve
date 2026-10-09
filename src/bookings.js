// منطق رزرو: اعتبارسنجی و جلوگیری سخت‌گیرانه از تداخل زمانی
//
// تداخل زمانی داخل یک تراکنش دیتابیس بررسی می‌شود، نه فقط در رابط کاربری.
// یعنی حتی اگر دو تب مرورگر هم‌زمان باز باشند، رزرو تداخلی ثبت نمی‌شود.

import { DEFAULT_KINDS, FALLBACK_KIND } from './db.js';
import { kindKeys } from './kinds.js';

export const STATUSES = {
  RESERVED: 'reserved',   // رزرو شده
  CANCELLED: 'cancelled', // لغو شده
};

export const STATUS_LABELS = {
  reserved: 'رزرو شده',
  cancelled: 'لغو شده',
};

/**
 * انواع مراسم در جدول kinds هستند و مدیر می‌تواند آن‌ها را در تنظیمات
 * تغییر دهد؛ فهرست اولیه در src/db.js (DEFAULT_KINDS) می‌آید.
 * این مقدار فقط برای وقتی است که کلید مرجع در دسترس نباشد
 * — مثلاً گزارش‌های اکسل که با db کار نمی‌کنند.
 */
export const KIND_LABELS = Object.fromEntries(DEFAULT_KINDS);

/** وضعیت‌هایی که سالن را اشغال نگه می‌دارند */
const BLOCKING = [STATUSES.RESERVED];

export class BookingError extends Error {
  constructor(message, conflicts = []) {
    super(message);
    this.name = 'BookingError';
    this.conflicts = conflicts;
  }
}

/** 'HH:MM' → دقیقه از نیمه‌شب */
export function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** دقیقه از نیمه‌شب → 'HH:MM' */
export function minutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** بازه‌ها هم‌پوشانی دارند؟ شروع_جدید < پایان_قبلی و پایان_جدید > شروع_قبلی */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/** مدت یک رزرو بر حسب ساعت */
export function durationHours(startMin, endMin) {
  return (endMin - startMin) / 60;
}

function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** رزروهایی که با بازه داده‌شده در همان سالن و همان روز تداخل دارند */
export function findConflicts(db, { hallId, date, startMin, endMin, excludeId = null }) {
  const sql = `
    SELECT id, title, requester, start_min, end_min, status
      FROM bookings
     WHERE hall_id = ?
       AND date = ?
       AND status IN (${BLOCKING.map(() => '?').join(',')})
       AND start_min < ?
       AND end_min > ?
       AND (? IS NULL OR id != ?)
     ORDER BY start_min`;
  return db.prepare(sql).all(
    hallId, date, ...BLOCKING, endMin, startMin, excludeId, excludeId
  );
}

/**
 * ثبت رزرو جدید. در صورت تداخل زمانی، BookingError پرتاب می‌شود.
 * از آنجا که بررسی و درج داخل یک تراکنش انجام می‌شود،
 * دو درخواست هم‌زمان هرگز نمی‌توانند هر دو موفق شوند.
 */
export function createBooking(db, input, createdBy = null) {
  // کلیدهای معتبر نوع مراسم از جدول kinds خوانده می‌شوند، نه از یک
  // فهرست ثابت در کد — مدیر می‌تواند در تنظیمات نوع تازه بسازد.
  const v = validate(input, kindKeys(db));
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    const conflicts = findConflicts(db, {
      hallId: v.hallId, date: v.date, startMin: v.startMin, endMin: v.endMin,
    });
    if (conflicts.length) {
      db.exec('ROLLBACK');
      throw new BookingError('این بازه با رزرو دیگری تداخل دارد.', conflicts);
    }

    const info = db.prepare(`
      INSERT INTO bookings
        (hall_id, date, start_min, end_min, title, kind, requester,
         phone, attendees, notes, status, created_at, updated_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      v.hallId, v.date, v.startMin, v.endMin, v.title, v.kind, v.requester,
      v.phone, v.attendees, v.notes, v.status, now, now,
      createdBy == null ? null : Number(createdBy)
    );

    db.exec('COMMIT');
    return getBooking(db, info.lastInsertRowid);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* تراکنش از قبل بسته شده */ }
    throw err;
  }
}

/** ویرایش رزرو — تداخل دوباره بررسی می‌شود */
export function updateBooking(db, id, patch) {
  const current = getBooking(db, id);
  if (!current) throw new BookingError('رزرو یافت نشد.');
  if (current.status === STATUSES.CANCELLED && patch.status !== STATUSES.CANCELLED) {
    // رزرو لغوشده دوباره فعال می‌شود، پس باید تداخل دوباره بررسی شود
  }

  const merged = {
    hallId: patch.hallId ?? current.hall_id,
    date: patch.date ?? current.date,
    startTime: patch.startTime ?? minutesToTime(current.start_min),
    endTime: patch.endTime ?? minutesToTime(current.end_min),
    title: patch.title ?? current.title,
    kind: patch.kind ?? current.kind,
    requester: patch.requester ?? current.requester,
    phone: patch.phone ?? current.phone,
    attendees: patch.attendees ?? current.attendees,
    notes: patch.notes ?? current.notes,
    status: patch.status ?? current.status,
  };
  const v = validate(merged, kindKeys(db));

  db.exec('BEGIN IMMEDIATE');
  try {
    if (BLOCKING.includes(v.status)) {
      const conflicts = findConflicts(db, {
        hallId: v.hallId, date: v.date, startMin: v.startMin, endMin: v.endMin, excludeId: id,
      });
      if (conflicts.length) {
        db.exec('ROLLBACK');
        throw new BookingError('این بازه با رزرو دیگری تداخل دارد.', conflicts);
      }
    }

    db.prepare(`
      UPDATE bookings SET
        hall_id=?, date=?, start_min=?, end_min=?, title=?, kind=?, requester=?,
        phone=?, attendees=?, notes=?, status=?, updated_at=?
      WHERE id=?
    `).run(
      v.hallId, v.date, v.startMin, v.endMin, v.title, v.kind, v.requester,
      v.phone, v.attendees, v.notes, v.status, new Date().toISOString(), id
    );

    db.exec('COMMIT');
    return getBooking(db, id);
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* تراکنش از قبل بسته شده */ }
    throw err;
  }
}

/** تغییر وضعیت بدون بررسی تداخل (برای لغو یا تحویل) */
export function setStatus(db, id, status) {
  if (!Object.values(STATUSES).includes(status)) {
    throw new BookingError('وضعیت نامعتبر است.');
  }
  if (!getBooking(db, id)) throw new BookingError('رزرو یافت نشد.');

  db.prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), id);
  return getBooking(db, id);
}

export function deleteBooking(db, id) {
  const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  return info.changes > 0;
}

export function getBooking(db, id) {
  return db.prepare(`
    SELECT b.*, h.name AS hall_name, u.full_name AS created_by_name
      FROM bookings b
      JOIN halls h ON h.id = b.hall_id
      LEFT JOIN users u ON u.id = b.created_by
     WHERE b.id = ?`).get(id) ?? null;
}

/**
 * اعتبارسنجی و نرمال‌سازی ورودی.
 * همه خطاهای ممکن یکجا جمع می‌شوند تا کاربر مجبور نباشد
 * فرم را چند بار پر کند.
 */
export function validate(input, validKinds = Object.keys(KIND_LABELS)) {
  const errors = [];

  const hallId = Number(input.hallId);
  if (!Number.isInteger(hallId) || hallId <= 0) errors.push('سالن انتخاب نشده است.');

  const date = String(input.date ?? '');
  if (!isValidDate(date)) errors.push('تاریخ نامعتبر است.');

  const startMin = timeToMinutes(input.startTime);
  if (startMin === null) errors.push('ساعت شروع نامعتبر است.');

  const endMin = timeToMinutes(input.endTime);
  if (endMin === null) errors.push('ساعت پایان نامعتبر است.');

  if (startMin !== null && endMin !== null && endMin <= startMin) {
    errors.push('ساعت پایان باید بعد از ساعت شروع باشد.');
  }

  const title = String(input.title ?? '').trim();
  if (!title) errors.push('عنوان مراسم لازم است.');
  if (title.length > 200) errors.push('عنوان خیلی طولانی است.');

  const requester = String(input.requester ?? '').trim();
  if (!requester) errors.push('نام درخواست‌دهنده لازم است.');

  // انواع معتبر از جدول kinds خوانده می‌شود، چون مدیر می‌تواند آن‌ها را
  // در تنظیمات تغییر دهد؛ فهرست ثابت کد دیگر مرجع نیست.
  const kind = String(input.kind ?? FALLBACK_KIND);
  if (!validKinds.includes(kind)) errors.push('نوع مراسم نامعتبر است.');

  const status = String(input.status ?? STATUSES.RESERVED);
  if (!Object.values(STATUSES).includes(status)) errors.push('وضعیت نامعتبر است.');

  let attendees = null;
  if (input.attendees !== '' && input.attendees != null) {
    attendees = Number(input.attendees);
    if (!Number.isInteger(attendees) || attendees < 0) {
      errors.push('تعداد حاضران باید عدد صحیح باشد.');
    }
  }

  if (errors.length) throw new BookingError(errors.join('\n'));

  return {
    hallId, date, startMin, endMin, title,
    kind: validKinds.includes(kind) ? kind : FALLBACK_KIND,
    requester,
    phone: String(input.phone ?? '').trim(),
    attendees,
    notes: String(input.notes ?? '').trim(),
    status,
  };
}

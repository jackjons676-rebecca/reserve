// گزارش‌های آماری
//
// مبنای محاسبه درصد استفاده: ساعات کاری از تنظیمات خوانده می‌شود.
// ساعت‌های خارج از روزهای کاری و خارج از بازه کاری، در مخرج نمی‌آیند.

import { allSettings } from './db.js';
import { timeToMinutes, minutesToTime, STATUSES, STATUS_LABELS } from './bookings.js';
import { kindLabels } from './kinds.js';
import { jalaliMonthDays, jalaliLabel, WEEKDAYS } from './jalali.js';

// فقط رزروهای فعال در آمار می‌آیند؛ رزرو لغوشده نه زمان اشغالی دارد نه آمار
const ACTIVE_STATUSES = [STATUSES.RESERVED];

/** بازه روز کاری بر حسب دقیقه، یا null اگر تنظیم نشده باشد */
export function workWindow(settings) {
  const start = timeToMinutes(settings.day_start);
  const end = timeToMinutes(settings.day_end);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** فهرست روزهای کاری (۰ یکشنبه تا ۶ شنبه) */
export function workDays(settings) {
  const raw = String(settings.work_days ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return raw.length ? new Set(raw) : new Set([1, 2, 3, 4, 5]);
}

/** شماره روز هفته یک تاریخ میلادی: ۰ یکشنبه تا ۶ شنبه */
function weekdayOf(iso) {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

/**
 * مجموع ساعات کاری قابل رزرو در یک بازه تاریخ.
 * فقط روزهای کاری و فقط بازه کاری روز شمرده می‌شود.
 */
export function capacityMinutes(dates, settings) {
  const win = workWindow(settings);
  if (!win) return 0;
  const days = workDays(settings);
  const perDay = win.end - win.start;
  return dates.filter((iso) => days.has(weekdayOf(iso))).length * perDay;
}

/** بازه تاریخ‌های یک ماه شمسی */
export function monthDates(jy, jm) {
  return jalaliMonthDays(jy, jm);
}

/**
 * درصد استفاده هر سالن در بازه داده‌شده.
 * برای هر سالن: ساعت‌های رزروشده تقسیم بر ساعات کاری همان سالن در آن بازه.
 */
export function utilizationReport(db, dates, settings) {
  const halls = db.prepare(
    'SELECT id, name, capacity FROM halls WHERE active = 1 ORDER BY sort_order, id'
  ).all();
  const total = capacityMinutes(dates, settings);

  if (!halls.length) return { halls: [], capacityMinutes: total };

  const start = dates[0];
  const end = dates[dates.length - 1];

  const rows = db.prepare(`
    SELECT hall_id,
           COUNT(*)                AS bookings,
           SUM(end_min - start_min) AS minutes
      FROM bookings
     WHERE date >= ? AND date <= ?
       AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
     GROUP BY hall_id
  `).all(start, end, ...ACTIVE_STATUSES);

  const byHall = new Map(rows.map((r) => [r.hall_id, r]));
  const details = db.prepare(`
    SELECT b.hall_id, b.date, b.start_min, b.end_min
      FROM bookings b
     WHERE b.date >= ? AND b.date <= ?
       AND b.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).all(start, end, ...ACTIVE_STATUSES);

  const dayCount = dates.filter((iso) => workDays(settings).has(weekdayOf(iso))).length;
  const perDay = workWindow(settings);
  const perHallCapacity = perDay ? dayCount * (perDay.end - perDay.start) : 0;

  const usage = new Map();
  for (const d of details) {
    if (!usage.has(d.hall_id)) usage.set(d.hall_id, new Set());
    usage.get(d.hall_id).add(d.date);
  }

  return {
    capacityMinutes: total,
    workDays: dayCount,
    halls: halls.map((h) => {
      const stat = byHall.get(h.id);
      const minutes = stat?.minutes ?? 0;
      return {
        hallId: h.id,
        name: h.name,
        capacity: h.capacity,
        bookings: stat?.bookings ?? 0,
        minutes,
        hours: round1(minutes / 60),
        activeDays: usage.get(h.id)?.size ?? 0,
        utilization: perHallCapacity ? round1((minutes / perHallCapacity) * 100) : 0,
      };
    }),
  };
}

/** گزارش بر اساس درخواست‌دهنده (دانشکده، گروه و ...) */
export function requesterReport(db, dates) {
  const rows = db.prepare(`
    SELECT requester,
           COUNT(*)                 AS bookings,
           SUM(end_min - start_min) AS minutes
      FROM bookings
     WHERE date >= ? AND date <= ?
       AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
     GROUP BY requester
     ORDER BY minutes DESC, bookings DESC
  `).all(dates[0], dates[dates.length - 1], ...ACTIVE_STATUSES);

  // یک درخواست‌دهنده می‌تواند زیر چند نوع مراسم رزرو داشته باشد. قبلاً
  // یک نوعِ دلخواه از میان رزروهایش برداشته می‌شد و در ستون «نوع»
  // نشان داده می‌شد — چیزی که بی‌معنا بود. حالا همهٔ انواع فهرست می‌شوند.
  const kindRows = db.prepare(`
    SELECT requester, kind
      FROM bookings
     WHERE date >= ? AND date <= ?
       AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
     GROUP BY requester, kind
  `).all(dates[0], dates[dates.length - 1], ...ACTIVE_STATUSES);

  const labels = kindLabels(db);
  const kindsBy = new Map();
  for (const k of kindRows) {
    if (!kindsBy.has(k.requester)) kindsBy.set(k.requester, []);
    kindsBy.get(k.requester).push(k.kind);
  }

  return rows.map((r) => {
    const kinds = kindsBy.get(r.requester) ?? [];
    const kindLabels = kinds.map((k) => labels[k] ?? k);
    return {
      requester: r.requester,
      kinds,
      // یک نوع، یا چند نوع وقتی درخواست‌دهنده متنوع رزرو داشته باشد
      kindLabel: kindLabels.join('، ') || '—',
      bookings: r.bookings,
      minutes: r.minutes,
      hours: round1(r.minutes / 60),
      // میانگین هر رزرو = مجموع ساعت ÷ تعداد رزرو
      avgHours: r.bookings ? round1(r.minutes / 60 / r.bookings) : 0,
    };
  });
}

/** بیشترین استفاده در کدام بازه ساعتی روز انجام می‌شود */
export function peakHoursReport(db, dates) {
  const rows = db.prepare(`
    SELECT start_min, end_min
      FROM bookings
     WHERE date >= ? AND date <= ?
       AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).all(dates[0], dates[dates.length - 1], ...ACTIVE_STATUSES);

  // تقسیم‌بندی به بازه‌های یک‌ساعته، بر پایه پوشش هر رزرو
  const buckets = new Map();
  for (const r of rows) {
    for (let m = r.start_min; m < r.end_min; m += 60) {
      const hour = Math.floor(m / 60);
      buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, count]) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      start: minutesToTime(hour * 60),
      end: minutesToTime(hour * 60 + 60),
      bookings: count,
    }));
}

/** ریز رزروها با امکان فیلتر */
export function detailReport(db, dates, filter = {}) {
  const where = ['b.date >= ?', 'b.date <= ?'];
  const params = [dates[0], dates[dates.length - 1]];

  if (filter.hallId) {
    where.push('b.hall_id = ?');
    params.push(Number(filter.hallId));
  }
  if (filter.status) {
    where.push('b.status = ?');
    params.push(filter.status);
  }
  if (filter.kind) {
    where.push('b.kind = ?');
    params.push(filter.kind);
  }
  if (filter.requester) {
    where.push('b.requester = ?');
    params.push(filter.requester);
  }

  const rows = db.prepare(`
    SELECT b.*, h.name AS hall_name
      FROM bookings b JOIN halls h ON h.id = b.hall_id
     WHERE ${where.join(' AND ')}
     ORDER BY b.date, b.start_min
  `).all(...params);

  const labels = kindLabels(db);
  return rows.map((r) => ({
    id: r.id,
    hallId: r.hall_id,
    hallName: r.hall_name,
    date: r.date,
    dateLabel: jalaliLabel(r.date),
    start: minutesToTime(r.start_min),
    end: minutesToTime(r.end_min),
    startMin: r.start_min,
    endMin: r.end_min,
    title: r.title,
    kind: r.kind,
    kindLabel: labels[r.kind] ?? r.kind,
    requester: r.requester,
    phone: r.phone,
    attendees: r.attendees,
    notes: r.notes,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    hours: round1((r.end_min - r.start_min) / 60),
  }));
}

/** فهرست درخواست‌دهنده‌های موجود، برای پر کردن فیلترها */
export function requesterOptions(db) {
  return db.prepare(
    'SELECT DISTINCT requester FROM bookings ORDER BY requester'
  ).all().map((r) => r.requester);
}

/** وضعیت لحظه‌ای هر سالن در یک روز */
export function dayBoard(db, iso) {
  const halls = db.prepare(
    'SELECT id, name, capacity FROM halls WHERE active = 1 ORDER BY sort_order, id'
  ).all();

  const rows = db.prepare(`
    SELECT b.*, h.name AS hall_name
      FROM bookings b JOIN halls h ON h.id = b.hall_id
     WHERE b.date = ?
       AND b.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
     ORDER BY b.start_min
  `).all(iso, ...ACTIVE_STATUSES);

  const byHall = new Map();
  const labels = kindLabels(db);
  for (const r of rows) {
    if (!byHall.has(r.hall_id)) byHall.set(r.hall_id, []);
    byHall.get(r.hall_id).push({
      id: r.id,
      title: r.title,
      kind: r.kind,
      kindLabel: labels[r.kind] ?? r.kind,
      requester: r.requester,
      phone: r.phone,
      attendees: r.attendees,
      notes: r.notes,
      status: r.status,
      statusLabel: STATUS_LABELS[r.status] ?? r.status,
      start: minutesToTime(r.start_min),
      end: minutesToTime(r.end_min),
      startMin: r.start_min,
      endMin: r.end_min,
    });
  }

  return halls.map((h) => ({ ...h, bookings: byHall.get(h.id) ?? [] }));
}

/** خلاصه کلی یک بازه */
export function summary(db, dates, settings) {
  const from = dates[0];
  const to = dates[dates.length - 1];

  const totals = db.prepare(`
    SELECT COUNT(*) AS bookings,
           SUM(end_min - start_min) AS minutes,
           SUM(status = '${STATUSES.CANCELLED}') AS cancelled
      FROM bookings
     WHERE date >= ? AND date <= ?
  `).get(from, to);

  const active = db.prepare(`
    SELECT COUNT(*) AS bookings, SUM(end_min - start_min) AS minutes
      FROM bookings
     WHERE date >= ? AND date <= ?
       AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
  `).get(from, to, ...ACTIVE_STATUSES);

  const capacity = capacityMinutes(dates, settings);

  return {
    from, to,
    days: dates.length,
    bookings: active?.bookings ?? 0,
    cancelled: totals?.cancelled ?? 0,
    hours: round1((active?.minutes ?? 0) / 60),
    capacityHours: round1(capacity / 60),
    utilization: capacity ? round1(((active?.minutes ?? 0) / capacity) * 100) : 0,
  };
}

function round1(n) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

export { round1, ACTIVE_STATUSES, WEEKDAYS };

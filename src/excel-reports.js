// ساخت فایل اکسل هر گزارش — لایه بین کوئری‌های گزارش و نویسنده xlsx

import { buildWorkbook } from './xlsx.js';
import {
  utilizationReport, requesterReport, peakHoursReport, detailReport, summary,
} from './reports.js';
import { jalaliFromISO } from './jalali.js';
import { allSettings } from './db.js';
import { minutesToTime, timeToMinutes } from './bookings.js';

export const EXCEL_KINDS = ['utilization', 'requester', 'peak', 'detail'];

/** عنوان و بازه زمانی بالای هر گزارش */
function headerFor(kind, dates, settings) {
  const range = rangeLabel(dates);
  const titles = {
    utilization: 'گزارش درصد استفاده از سالن‌ها',
    requester: 'گزارش استفاده به تفکیک درخواست‌دهنده',
    peak: 'گزارش ساعت‌های پرتردد',
    detail: 'ریز رزروها',
  };
  return {
    title: titles[kind] ?? 'گزارش',
    subtitle: `بازه: ${range}  |  تهیه‌شده در ${todayLabel()}`,
  };
}

function rangeLabel(dates) {
  if (!dates.length) return '—';
  const a = jalaliFromISO(dates[0]);
  const b = jalaliFromISO(dates[dates.length - 1]);
  if (dates.length === 1) return `${a.jd} ${a.jMonth} ${a.jy}`;
  return `${a.jd} ${a.jMonth} ${a.jy} تا ${b.jd} ${b.jMonth} ${b.jy}`;
}

function todayLabel() {
  const j = jalaliFromISO(new Date().toISOString().slice(0, 10));
  return `${j.jd} ${j.jMonth} ${j.jy}`;
}

/**
 * ساخت فایل اکسل برای یکی از گزارش‌ها.
 * filter شامل hallId / status / eventKind / requester برای گزارش ریز
 */
export function buildExcelReport(kind, db, dates, settings, filter = {}) {
  switch (kind) {
    case 'utilization': return utilizationSheet(db, dates, settings);
    case 'requester': return requesterSheet(db, dates, settings);
    case 'peak': return peakSheet(db, dates, settings);
    case 'detail': return detailSheet(db, dates, filter);
    default: throw new Error(`گزارش نامعتبر: ${kind}`);
  }
}

// ────────────────────────────  درصد استفاده  ────────────────────────────

function utilizationSheet(db, dates, settings) {
  const rep = utilizationReport(db, dates, settings);
  const { title, subtitle } = headerFor('utilization', dates, settings);

  const columns = [
    { title: 'ردیف', width: 7, type: 'number' },
    { title: 'نام سالن', width: 26 },
    { title: 'ظرفیت', width: 10, type: 'number' },
    { title: 'تعداد رزرو', width: 12, type: 'number' },
    { title: 'روزهای فعال', width: 12, type: 'number' },
    { title: 'ساعت استفاده', width: 14, type: 'number' },
    { title: 'درصد استفاده', width: 14, type: 'percent' },
  ];

  const rows = rep.halls.map((h, i) => [
    i + 1, h.name, h.capacity, h.bookings, h.activeDays, h.hours,
    Math.round((h.utilization / 100) * 1000) / 1000,
  ]);

  // جمع کل
  if (rows.length) {
    const totalBookings = rep.halls.reduce((s, h) => s + h.bookings, 0);
    const totalMinutes = rep.halls.reduce((s, h) => s + h.minutes, 0);
    const overall = rep.capacityMinutes && rep.halls.length
      ? (totalMinutes / (rep.capacityMinutes * rep.halls.length)) : 0;
    rows.push([
      '', 'جمع کل', '', totalBookings, '',
      Math.round((totalMinutes / 60) * 10) / 10,
      Math.round(overall * 1000) / 1000,
    ]);
  }

  const sum = summary(db, dates, settings);

  const notes = [
    { title: 'شاخص', width: 30 },
    { title: 'مقدار', width: 20 },
  ];
  const noteRows = [
    ['ساعات کاری کل مجتمع', round1(sum.capacityHours)],
    ['ساعات رزروشده (بدون احتساب تداخل)', round1(sum.hours)],
    ['درصد کل بهره‌برداری', Math.round((sum.utilization / 100) * 1000) / 1000],
    ['تعداد رزرو فعال', sum.bookings],
    ['تعداد رزرو لغوشده', sum.cancelled],
    ['روزهای کاری ماه', rep.workDays ?? '—'],
  ];

  return buildWorkbook([
    { name: 'درصد استفاده', title, subtitle, columns, rows, freeze: true },
    { name: 'شاخص‌ها', title: 'شاخص‌های کلی', subtitle, columns: notes, rows: noteRows, freeze: false },
  ]);
}

// ────────────────────────────  درخواست‌دهنده  ────────────────────────────

function requesterSheet(db, dates, settings) {
  const rows = requesterReport(db, dates);
  const { title, subtitle } = headerFor('requester', dates, settings);

  const columns = [
    { title: 'ردیف', width: 7, type: 'number' },
    { title: 'درخواست‌دهنده', width: 32 },
    { title: 'نوع', width: 12 },
    { title: 'تعداد رزرو', width: 12, type: 'number' },
    { title: 'ساعت استفاده', width: 14, type: 'number' },
    { title: 'میانگین هر نوبت (ساعت)', width: 20, type: 'number' },
  ];

  const data = rows.map((r, i) => [
    i + 1,
    r.requester,
    r.kindLabel,
    r.bookings,
    r.hours,
    r.bookings ? round1(r.minutes / 60 / r.bookings) : 0,
  ]);

  const totalBookings = rows.reduce((s, r) => s + r.bookings, 0);
  const totalHours = round1(rows.reduce((s, r) => s + r.minutes, 0) / 60);
  if (data.length) {
    data.push(['', 'جمع کل', '', totalBookings, totalHours,
      totalBookings ? round1(totalHours / totalBookings) : 0]);
  }

  return buildWorkbook([
    { name: 'درخواست‌دهندگان', title, subtitle, columns, rows: data, freeze: true },
  ]);
}

// ────────────────────────────  ساعت پرتردد  ────────────────────────────

function peakSheet(db, dates, settings) {
  const rows = peakHoursReport(db, dates);
  const { title, subtitle } = headerFor('peak', dates, settings);

  const columns = [
    { title: 'بازه ساعتی', width: 16 },
    { title: 'از', width: 10 },
    { title: 'تا', width: 10 },
    { title: 'تعداد رزرو', width: 12, type: 'number' },
    { title: 'سهم از کل', width: 12, type: 'percent' },
  ];

  const total = rows.reduce((s, r) => s + r.bookings, 0);
  const data = rows.map((r) => [
    r.label, r.start, r.end, r.bookings,
    total ? Math.round((r.bookings / total) * 1000) / 1000 : 0,
  ]);

  return buildWorkbook([
    { name: 'ساعت پرتردد', title, subtitle, columns, rows: data, freeze: true },
  ]);
}

// ────────────────────────────  ریز رزروها  ────────────────────────────

function detailSheet(db, dates, filter) {
  const rows = detailReport(db, dates, {
    hallId: filter.hallId,
    status: filter.status,
    kind: filter.eventKind,
    requester: filter.requester,
  });
  const { title, subtitle } = headerFor('detail', dates, allSettings(db));

  const columns = [
    { title: 'ردیف', width: 7, type: 'number' },
    { title: 'تاریخ', width: 18 },
    { title: 'روز هفته', width: 11 },
    { title: 'سالن', width: 24 },
    { title: 'از ساعت', width: 10 },
    { title: 'تا ساعت', width: 10 },
    { title: 'مدت (ساعت)', width: 12, type: 'number' },
    { title: 'عنوان مراسم', width: 32 },
    { title: 'نوع', width: 12 },
    { title: 'درخواست‌دهنده', width: 24 },
    { title: 'تلفن', width: 16 },
    { title: 'تعداد حاضران', width: 13, type: 'number' },
    { title: 'وضعیت', width: 14 },
    { title: 'توضیحات', width: 34 },
  ];

  const data = rows.map((r, i) => [
    i + 1,
    r.dateLabel,
    weekdayName(r.date),
    r.hallName,
    r.start,
    r.end,
    r.hours,
    r.title,
    r.kindLabel,
    r.requester,
    r.phone,
    r.attendees ?? '',
    r.statusLabel,
    r.notes,
  ]);

  return buildWorkbook([
    { name: 'ریز رزروها', title, subtitle, columns, rows: data, freeze: true },
  ]);
}

const WEEK = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
function weekdayName(iso) {
  return WEEK[new Date(iso + 'T00:00:00Z').getUTCDay()];
}

function round1(n) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

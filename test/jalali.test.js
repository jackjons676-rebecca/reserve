import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toJalali, toGregorian, isoFromJalali, jalaliFromISO,
  jalaliMonthLength, jalaliMonthDays, isJalaliLeap,
} from '../src/jalali.js';

// تاریخ‌های لنگر: میلادی ↔ شمسی
const CASES = [
  { iso: '2026-10-09', jy: 1405, jm: 7, jd: 17 },  // ۱۷ مهر ۱۴۰۵
  { iso: '2024-03-20', jy: 1403, jm: 1, jd: 1 },   // ۱ فروردین ۱۴۰۳ (سال کبیسه)
  { iso: '2025-03-21', jy: 1404, jm: 1, jd: 1 },   // ۱ فروردین ۱۴۰۴
  { iso: '2026-03-21', jy: 1405, jm: 1, jd: 1 },   // ۱ فروردین ۱۴۰۵
  { iso: '2026-03-20', jy: 1404, jm: 12, jd: 29 },  // آخرین روز اسفند ۱۴۰۴
  { iso: '2025-03-20', jy: 1403, jm: 12, jd: 30 },  // آخرین روز اسفند ۱۴۰۳ (کبیسه، ۳۰ روز)
  { iso: '2026-07-22', jy: 1405, jm: 4, jd: 31 },  // ۳۱ تیر
  { iso: '2026-06-21', jy: 1405, jm: 3, jd: 31 },  // ۳۱ خرداد
];

test('میلادی به شمسی', () => {
  for (const c of CASES) {
    const [y, m, d] = c.iso.split('-').map(Number);
    assert.deepEqual(toJalali(y, m, d), { jy: c.jy, jm: c.jm, jd: c.jd }, `برای ${c.iso}`);
  }
});

test('شمسی به میلادی', () => {
  for (const c of CASES) {
    const g = toGregorian(c.jy, c.jm, c.jd);
    const iso = `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
    assert.equal(iso, c.iso, `برای ${c.jy}/${c.jm}/${c.jd}`);
  }
});

test('سال کبیسه و طول اسفند', () => {
  assert.equal(isJalaliLeap(1403), true);
  assert.equal(isJalaliLeap(1404), false);
  assert.equal(isJalaliLeap(1408), true);
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
});

test('طول ماه‌های شمسی', () => {
  assert.equal(jalaliMonthLength(1405, 1), 31, 'فروردین');
  assert.equal(jalaliMonthLength(1405, 4), 31, 'تیر');
  assert.equal(jalaliMonthLength(1405, 6), 31, 'شهریور');
  assert.equal(jalaliMonthLength(1405, 7), 30, 'مهر');
  assert.equal(jalaliMonthLength(1405, 8), 30, 'آبان');
  assert.equal(jalaliMonthLength(1405, 11), 30, 'بهمن');
});

test('رفت و برگشت روی یک سال کامل، هر روز', () => {
  // از ۱ فروردین ۱۴۰۵ تا ۳۰ اسفند ۱۴۰۵، هر روز باید درست باشد
  let iso = '2026-03-21';
  const start = Date.parse(iso + 'T00:00:00Z');
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(start + i * 86400000);
    const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    assert.equal(isoFromJalali(j.jy, j.jm, j.jd), iso, `اختلاف در روز ${i}`);
    iso = new Date(start + (i + 1) * 86400000).toISOString().slice(0, 10);
  }
});

test('رفت و برگشت در سال کبیسه هم درست است', () => {
  let iso = '2024-03-20';
  const start = Date.parse(iso + 'T00:00:00Z');
  for (let i = 0; i < 366; i += 1) {
    const d = new Date(start + i * 86400000);
    const j = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    assert.equal(isoFromJalali(j.jy, j.jm, j.jd), iso, `اختلاف در روز ${i} سال کبیسه`);
    iso = new Date(start + (i + 1) * 86400000).toISOString().slice(0, 10);
  }
});

test('فهرست روزهای ماه شمسی', () => {
  const days = jalaliMonthDays(1405, 1);
  assert.equal(days.length, 31);
  assert.equal(days[0], '2026-03-21', 'اول فروردین ۱۴۰۵');
  assert.equal(days[30], '2026-04-20', 'آخر فروردین ۱۴۰۵');

  const esfand = jalaliMonthDays(1403, 12);
  assert.equal(esfand.length, 30, 'اسفند ۱۴۰۳ کبیسه است');
  assert.equal(esfand[29], '2025-03-20');
});

test('نام ماه و روز هفته', () => {
  const j = jalaliFromISO('2026-10-09');
  assert.equal(j.jy, 1405);
  assert.equal(j.jMonth, 'مهر');
});

// مقایسه با تقویم رسمی فارسی Node (Intl)، روز به روز، از ۲۰۲۰ تا ۲۰۳۰
const FA_FORMAT = new Intl.DateTimeFormat('en-u-ca-persian', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
});

function intlJalali(iso) {
  const parts = FA_FORMAT.formatToParts(new Date(iso + 'T00:00:00Z'));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { jy: get('year'), jm: get('month'), jd: get('day') };
}

test('تطابق کامل با تقویم رسمی فارسی، هر روز از ۲۰۲۰ تا ۲۰۳۰', () => {
  const start = Date.parse('2020-01-01T00:00:00Z');
  const days = Math.round((Date.parse('2030-12-31T00:00:00Z') - start) / 86400000);
  for (let i = 0; i <= days; i += 1) {
    const iso = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const [y, m, d] = iso.split('-').map(Number);
    assert.deepEqual(toJalali(y, m, d), intlJalali(iso), `اختلاف در ${iso}`);
  }
});

test('طول ماه شمسی درست است و مرز ماه‌ها جای درست', () => {
  for (let jy = 1398; jy <= 1410; jy += 1) {
    for (let jm = 1; jm <= 12; jm += 1) {
      const len = jalaliMonthLength(jy, jm);
      assert.equal(jalaliMonthDays(jy, jm).length, len, `طول ماه ${jy}/${jm}`);

      // آخرین روز این ماه، طبق تقویم رسمی
      const lastIso = jalaliMonthDays(jy, jm)[len - 1];
      const [gy, gm, gd] = lastIso.split('-').map(Number);
      assert.deepEqual(toJalali(gy, gm, gd), { jy, jm, jd: len },
        `آخرین روز ماه ${jy}/${jm} اشتباه است`);

      // فردای آخرین روز، باید اول ماه بعد باشد
      const t = new Date(lastIso + 'T00:00:00Z');
      const tmr = new Date(t.getTime() + 86400000).toISOString().slice(0, 10);
      const [ty, tm, td] = tmr.split('-').map(Number);
      const n = toJalali(ty, tm, td);
      const expected = jm === 12 ? { jy: jy + 1, jm: 1, jd: 1 } : { jy, jm: jm + 1, jd: 1 };
      assert.deepEqual(n, expected, `مرز ماه ${jy}/${jm} درست نیست`);
    }
  }
});


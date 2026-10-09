// تبدیل تاریخ شمسی (هجری خورشیدی) و میلادی
// قاعده چرخه ۳۳ ساله: در هر چرخه ۸ سال کبیسه است، پس هر چرخه ۱۲۱۵۳ روز دارد.
// محاسبه با عدد صحیح انجام می‌شود تا هیچ سرریزی یا گرد کردنی رخ ندهد.
// هم در سرور و هم در مرورگر استفاده می‌شود تا نمایش و ذخیره هرگز اختلاف نکند.

const MS_PER_DAY = 86400000;

// باقیمانده سال‌های کبیسه در چرخه ۳۳ ساله
const LEAP_RESIDUES = [1, 5, 9, 13, 17, 22, 26, 30];
const CYCLE_DAYS = 12153; // ۳۳ × ۳۶۵ + ۸ روز کبیسه

// روزهای گذشته از ۱ فروردین تا اولین روز هر ماه، در سال کبیسه‌نبودن
// فروردین تا شهریور ۳۱ روز، مهر تا بهمن ۳۰ روز، اسفند ۲۹ یا ۳۰ روز
const DAYS_BEFORE_MONTH = [0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336];

// لنگر: ۱ فروردین ۱۴۰۳ برابر ۲۰ مارس ۲۰۲۴ میلادی
const ANCHOR_JY = 1403;
const ANCHOR_JM = 1;
const ANCHOR_JD = 1;
const ANCHOR_ORDINAL = Date.UTC(2024, 2, 20) / MS_PER_DAY;

function div(a, b) {
  return Math.floor(a / b);
}

function mod(a, b) {
  return a - Math.floor(a / b) * b;
}

function isJalaliLeap(jy) {
  return LEAP_RESIDUES.includes(mod(jy, 33));
}

/** تعداد روزهای ماه شمسی (۱ تا ۱۲) */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

/** روزهای گذشته از ۱ فروردین ۱ شمسی تا اولین روز سال jy */
function daysBeforeJalaliYear(jy) {
  const y = jy - 1; // سال‌های کامل گذشته
  let leaps = 0;
  for (const r of LEAP_RESIDUES) {
    if (r <= mod(y, 33)) leaps += 1;
  }
  return div(y, 33) * CYCLE_DAYS + mod(y, 33) * 365 + leaps;
}

/** اولین روز ماه، بر حسب روز گذشته از ۱ فروردین
 *  ماه‌های ۱ تا ۱۱ در سال کبیسه و غیرکبیسه جای یکسانی دارند؛
 *  روز اضافه سال کبیسه فقط طول اسفند را زیاد می‌کند. */
function monthStart(jm) {
  return DAYS_BEFORE_MONTH[jm - 1];
}

/** شماره ترتیبی روز: روزهای گذشته از ۱ فروردین ۱ شمسی */
function daysFromJalaliEpoch(jy, jm, jd) {
  return daysBeforeJalaliYear(jy) + monthStart(jm) + (jd - 1);
}

/** تاریخ شمسی → شماره ترتیبی (روزهای گذشته از ۱۹۷۰) */
export function fromJalaliOrdinal(jy, jm, jd) {
  const n = daysFromJalaliEpoch(jy, jm, jd);
  return ANCHOR_ORDINAL + (n - daysFromJalaliEpoch(ANCHOR_JY, ANCHOR_JM, ANCHOR_JD));
}

/** شماره ترتیبی → تاریخ شمسی */
export function jalaliFromOrdinal(ordinal) {
  const n = ordinal - ANCHOR_ORDINAL + daysFromJalaliEpoch(ANCHOR_JY, ANCHOR_JM, ANCHOR_JD);

  // حدس اولیه سال بر پایه طول میانگین سال، سپس اصلاح
  let jy = Math.floor(n / 365.2422) + ANCHOR_JY + 1;
  while (daysBeforeJalaliYear(jy) > n) jy -= 1;
  while (daysBeforeJalaliYear(jy + 1) <= n) jy += 1;

  const rest = n - daysBeforeJalaliYear(jy);
  let jm = 1;
  while (jm < 12 && rest >= monthStart(jm + 1)) jm += 1;

  return { jy, jm, jd: rest - monthStart(jm) + 1 };
}

/** میلادی → شمسی */
export function toJalali(gy, gm, gd) {
  return jalaliFromOrdinal(Date.UTC(gy, gm - 1, gd) / MS_PER_DAY);
}

/** شمسی → میلادی */
export function toGregorian(jy, jm, jd) {
  const d = new Date(fromJalaliOrdinal(jy, jm, jd) * MS_PER_DAY);
  return { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
}

const JAL_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** نام ماه شمسی */
export function jalaliMonthName(jm) {
  return JAL_MONTHS[jm - 1];
}

/** 'YYYY-MM-DD' میلادی → {jy, jm, jd, jMonth, weekday} */
export function jalaliFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const j = toJalali(y, m, d);
  const weekday = WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
  return { ...j, jMonth: JAL_MONTHS[j.jm - 1], weekday };
}

/** {jy, jm, jd} شمسی → 'YYYY-MM-DD' میلادی */
export function isoFromJalali(jy, jm, jd) {
  const g = toGregorian(jy, jm, jd);
  return `${String(g.gy).padStart(4, '0')}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

/** فهرست تاریخ‌های میلادی یک ماه شمسی */
export function jalaliMonthDays(jy, jm) {
  const len = jalaliMonthLength(jy, jm);
  return Array.from({ length: len }, (_, i) => isoFromJalali(jy, jm, i + 1));
}

/** امروز به 'YYYY-MM-DD' میلادی بر اساس وقت محلی */
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** متن شمسی خوانا، مثل «۱۷ مهر ۱۴۰۵» */
export function jalaliLabel(iso) {
  const j = jalaliFromISO(iso);
  return `${j.jd} ${j.jMonth} ${j.jy}`;
}

export { JAL_MONTHS, WEEKDAYS, isJalaliLeap };

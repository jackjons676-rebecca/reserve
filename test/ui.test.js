// بررسی ایستای رابط کاربری — بدون مرورگر
//
// هدف: پیدا کردن خطاهایی که فقط در مرورگر خودش را نشان می‌دهند:
// شناسه‌های ناموجود، خطای نحوی جاوااسکریپت، و ناهماهنگی نام فیلد.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync('public/index.html', 'utf8');
const appJs = readFileSync('public/js/app.js', 'utf8');
const css = readFileSync('public/css/style.css', 'utf8');
const manifest = readFileSync('public/manifest.webmanifest', 'utf8');

/** شناسه‌های موجود در HTML */
function htmlIds() {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** شناسه‌هایی که app.js با $('...') به آن‌ها ارجاع می‌دهد */
function referencedIds() {
  return [...appJs.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
}

/**
 * شناسه‌هایی که خودِ جاوااسکریپت در DOM می‌سازد.
 * اینها در HTML نیستند ولی باید در کدی که آنها را می‌سازد
 * واقعاً به همان شناسه ساخته شده باشند.
 */
function dynamicallyBuiltIds() {
  const ids = new Set();
  // el('...', ..., id) یا .id = '...'
  for (const m of appJs.matchAll(/\.id\s*=\s*'([^']+)'/g)) ids.add(m[1]);
  for (const m of appJs.matchAll(/\bel\([^,]+,[^,]+,\s*'([^']+)'\)/g)) ids.add(m[1]);
  // شناسه‌های ثابتی که مستقیم به عنوان سوم به el داده می‌شوند
  for (const m of appJs.matchAll(/,\s*'(f[A-Z]\w*)'\)/g)) ids.add(m[1]);
  return ids;
}

test('هر شناسه‌ای که در جاوااسکریپت صدا زده می‌شود وجود دارد', () => {
  const staticIds = htmlIds();
  const built = dynamicallyBuiltIds();
  const missing = [...new Set(referencedIds())]
    .filter((id) => !staticIds.has(id) && !built.has(id));
  assert.deepEqual(missing, [], `شناسه‌های ناموجود: ${missing.join(', ')}`);
});

test('جاوااسکریپت از نظر نحوی بی‌خطاست', async () => {
  // تجزیه ماژول بدون اجرا
  await import('../public/js/app.js?parse-check').catch((e) => {
    // خطاهای مربوط به DOM یا fetch طبیعی‌اند؛ فقط خطای نحوی مهم است
    if (e instanceof SyntaxError) throw e;
  });
});

test('همه شناسه‌های HTML یکتا هستند', () => {
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], [], 'شناسه تکراری');
});

test('صفحه راست‌چین و فارسی است', () => {
  assert.match(html, /<html lang="fa" dir="rtl">/);
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
});

test('ماژول تاریخ شمسی از مسیر مشترک با سرور وارد می‌شود', () => {
  assert.match(appJs, /from '\/src\/jalali\.js'/,
    'مرورگر باید همان فایلی را بخواند که سرور اجرا می‌کند');
});

test('نماها و دکمه‌های اصلی وجود دارند', () => {
  for (const view of ['today', 'calendar', 'reports', 'settings']) {
    assert.ok(htmlIds().has(`view-${view}`), `نمای ${view} وجود ندارد`);
  }
  for (const id of ['bookingModal', 'detailModal', 'toast', 'gate', 'app']) {
    assert.ok(htmlIds().has(id), `${id} وجود ندارد`);
  }
});

test('فیلدهای فرم رزرو کامل هستند', () => {
  for (const id of [
    'bkHall', 'bkDate', 'bkStart', 'bkEnd', 'bkTitle',
    'bkKind', 'bkRequester', 'bkPhone', 'bkAttendees', 'bkNotes',
  ]) {
    assert.ok(htmlIds().has(id), `فیلد ${id} وجود ندارد`);
  }
});

test('شیوه‌نامه حالت‌های لازم را دارد', () => {
  for (const cls of [
    '.hall.is-open', '.slot.is-now', '.modal.is-open',
    '.toast.is-on', '.cal-chip--reserved', '.cal-chip--cancelled',
    '.day-head', '.jdate', '.user-row',
  ]) {
    assert.ok(css.includes(cls), `کلاس ${cls} در شیوه‌نامه نیست`);
  }
  // وزن‌های فونت وزیر باید بارگذاری شوند، وگرنه مرورگر به فونت پیش‌فرض می‌افتد
  assert.ok(css.includes('@font-face'), 'قانون font-face برای فونت وزیر لازم است');
  assert.ok(css.includes('Vazirmatn-Regular'), 'وزن معمولی فونت وزیر تعریف نشده');
});

test('نوع محتوای فایل فونت درست تعریف شده است', () => {
  // اگر ttf بدون نوع درست سرو شود، بعضی مرورگرها فونت را رد می‌کنند
  // و بی‌صدا به فونت پیش‌فرض برمی‌گردند.
  const server = readFileSync('server.js', 'utf8');
  for (const [ext, type] of [['.woff2', 'font/woff2'], ['.ttf', 'font/ttf']]) {
    assert.ok(server.includes(`'${ext}': '${type}'`),
      `پسوند ${ext} باید با نوع ${type} سرو شود`);
  }
});

test('انتخابگر تاریخ شمسی به‌جای ورودی میلادی', () => {
  // input[type=date] همیشه میلادی نشان می‌دهد، پس نباید جایی مانده باشد
  assert.ok(!html.includes('type="date"'), 'ورودی تاریخ میلادی نباید در صفحه باشد');
  for (const id of ['dpMonth', 'dpDay', 'dpYear', 'bkMonth', 'bkDay', 'bkYear']) {
    assert.ok(htmlIds().has(id), `انتخابگر شمسی ${id} در HTML نیست`);
  }
});

test('همهٔ شناسه‌هایی که جاوااسکریپت می‌خواند در صفحه وجود دارند', () => {
  // اگر شناسه‌ای در HTML نباشد، $() مقدار null می‌دهد و
  // «Cannot set properties of null» در مرورگر می‌گیریم.
  const ids = htmlIds();

  // شناسه‌هایی که خودِ جاوااسکریپت در ساخته و به صفحه اضافه می‌کند
  const builtInJs = new Set(
    [...appJs.matchAll(/(\w+)\.id = '(\w+)'/g)].map((m) => m[2]),
  );

  // و آن‌هایی که در HTML نیستند ولی با ?. خوانده می‌شوند (فیلترها)
  const optional = new Set(
    [...appJs.matchAll(/\$\('(\w+)'\)\?\./g)].map((m) => m[1]),
  );

  const used = [...new Set([...appJs.matchAll(/\$\('([a-zA-Z0-9_]+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) =>
    !ids.has(id) && !builtInJs.has(id) && !optional.has(id));

  assert.deepEqual(missing, [],
    `این شناسه‌ها در صفحه نیستند و $() مقدار null می‌دهد: ${missing.join(', ')}`);
});

test('انتخابگر تاریخ، فیلد ذخیرهٔ مقدار یکسان برای هر دو دارد', () => {
  // dp و bk هر دو از readJDate/setJDate استفاده می‌کنند که نام
  // فیلد را از پیش‌وند می‌سازد؛ پس باید در هر دو یکسان باشد.
  const suffixes = [...new Set([...appJs.matchAll(/\$\(pref \+ '(\w+)'\)/g)].map((m) => m[1]))];
  assert.ok(suffixes.includes('Value'), 'فیلد مقدار باید از pref ساخته شود');
  for (const pref of ['dp', 'bk']) {
    for (const s of suffixes) {
      assert.ok(htmlIds().has(pref + s),
        `${pref}${s} در HTML نیست ولی کد از آن استفاده می‌کند`);
    }
  }
  // نام قدیمی نباید جایی مانده باشد
  assert.ok(!html.includes('bkDateValue'), 'شناسهٔ قدیمی bkDateValue باید حذف شده باشد');
  assert.ok(!appJs.includes('bkDateValue'), 'کد نباید به bkDateValue اشاره کند');
});

test('ورودی‌های سالن با data-field قابل پیدا کردن هستند', () => {
  // ذخیرهٔ سالن‌ها نباید به متن راهنمای input وابسته باشد
  for (const f of ['name', 'capacity', 'notes']) {
    // renderHallsEditor ویژگی را به شکل dataset.field می‌نویسد
    assert.ok(appJs.includes(`.dataset.field = '${f}'`), `ورودی ${f} بدون data-field ساخته می‌شود`);
    assert.ok(appJs.includes(`[data-field="${f}"]`),
      `ذخیرهٔ سالن باید ورودی ${f} را با data-field پیدا کند`);
  }
  // نشانه‌های قدیمی که شکننده بودند نباید بمانند
  assert.ok(!appJs.includes("placeholder^="), 'نباید به متن راهنمای input وابسته باشیم');
});

test('پیمانه وب‌اپلیکیشن کامل است', () => {
  const m = JSON.parse(manifest);
  assert.equal(m.display, 'standalone');
  assert.equal(m.dir, 'rtl');
  assert.ok(m.icons.length >= 3, 'حداقل سه آیکون لازم است');
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  assert.equal(m.theme_color, '#1f6f5c');
});

test('رنگ سربرگ در متا و پیمانه یکسان است', () => {
  assert.match(html, /name="theme-color" content="#1f6f5c"/);
  assert.equal(JSON.parse(manifest).theme_color, '#1f6f5c');
});

test('مسیرهای API که جاوااسکریپت صدا می‌زند در سرور تعریف شده‌اند', () => {
  const server = readFileSync('server.js', 'utf8');
  const called = [...appJs.matchAll(/api\('(\/api\/[^`'$]*)/g)].map((m) => m[1]);
  const template = [...appJs.matchAll(/api\(`(\/api\/[^`?]*)/g)].map((m) => m[1]);

  for (const path of [...called, ...template]) {
    // مسیرهای پارامتری به‌صورت الگوی route ثبت شده‌اند
    const probe = path.replace(/\$\{[^}]+\}/g, 'x');
    const found = server.includes(`'${probe}'`) || server.includes(`/${probe.split('/')[2]}`);
    assert.ok(found, `مسیر ${path} در سرور تعریف نشده`);
  }
});

test('دکمه خروجی اکسل به مسیر صحیح اشاره می‌کند', () => {
  const server = readFileSync('server.js', 'utf8');
  // پسوند .xlsx باید داخل درخواست بماند، نه داخل نام پارامتر مسیر؛
  // وگرنه الگوی تنبل آن را نمی‌گیرد و خروجی ۴۰۴ می‌شود.
  assert.ok(server.includes("route('GET', '/api/export/:report'"), 'مسیر export در سرور تعریف نشده');
  assert.ok(server.includes("replace(/\\.xlsx$/, '')"), 'پسوند باید از نام گزارش جدا شود');
  assert.match(appJs, /\/api\/export\/\$\{map\[state\.report\]\}\.xlsx/,
    'دکمه اکسل باید به مسیر export برود');
});

test('وضعیت‌های رزرو در سرور و مرورگر یکسان‌اند', async () => {
  const bookings = readFileSync('src/bookings.js', 'utf8');
  // فقط دو وضعیت مانده: رزرو شده و لغو شده
  for (const status of ['reserved', 'cancelled']) {
    assert.ok(bookings.includes(`${status}:`), `وضعیت ${status} در سرور نیست`);
    assert.ok(appJs.includes(`'${status}'`) || appJs.includes(`${status}:`),
      `وضعیت ${status} در مرورگر نیست`);
  }
  // وضعیت‌های حذف‌شده نباید هیچ‌جا باقی مانده باشند
  for (const gone of ['handed', 'returned']) {
    assert.ok(!bookings.includes(gone), `وضعیت ${gone} باید حذف شده باشد`);
    assert.ok(!appJs.includes(`'${gone}'`), `وضعیت ${gone} در مرورگر باقی مانده است`);
  }
});

test('برچسب‌های فارسی مورد نیاز وجود دارند', () => {
  // دکمه‌هایی که جاوااسکریپت با متن می‌سازد
  for (const label of ['جزئیات', 'ویرایش']) {
    assert.ok(appJs.includes(label), `برچسب «${label}» در جاوااسکریپت یافت نشد`);
  }
  // دکمه‌هایی که در HTML هستند
  for (const label of ['لغو رزرو', 'ثبت رزرو جدید', 'خروجی اکسل', 'چاپ / PDF',
    'کاربران', 'بازگردانی', 'افزودن کاربر']) {
    assert.ok(html.includes(label), `برچسب «${label}» در HTML یافت نشد`);
  }
});

test('رابط کاربری چندکاربره است', () => {
  // فرم ورود باید هم نام کاربری داشته باشد هم رمز
  for (const id of ['userInput', 'pinInput', 'suUsername', 'suFullName']) {
    assert.ok(htmlIds().has(id), `ورودی ${id} در صفحه ورود نیست`);
  }
  // نام کاربر باید جایی در رابط نمایش داده شود
  assert.ok(htmlIds().has('userChip'), 'نام کاربر در نوار بالا نمایش داده نمی‌شود');
  // تب‌های مدیریتی باید علامت مشخص داشته باشند تا برای کاربر عادی پنهان شوند
  assert.equal((html.match(/nav__btn--admin/g) ?? []).length, 2,
    'دو تب گزارش و تنظیمات باید مخصوص مدیر باشند');
});

test('انواع مراسم در تنظیمات قابل ویرایش است', () => {
  for (const id of ['kindsCard', 'kindsEditor', 'addKind', 'saveKinds']) {
    assert.ok(htmlIds().has(id), `عنصر تنظیمات انواع مراسم ${id} در صفحه نیست`);
  }
  assert.ok(html.includes('انواع مراسم'), 'کارت انواع مراسم باید عنوان داشته باشد');

  // ویرایشگر باید مثل ویرایشگر سالن‌ها از data-field استفاده کند
  assert.match(appJs, /querySelector\('\[data-field="label"\]'\)/,
    'ذخیرهٔ انواع باید ورودی نام را با data-field پیدا کند');
  assert.match(appJs, /\.dataset\.field = 'label'/,
    'ورودی نام باید data-field بگیرد');
});

test('گزینه‌های نوع مراسم ثابت نیستند', () => {
  // انواع از جدول پایگاه‌داده می‌آیند و مدیر آن‌ها را تغییر می‌دهد،
  // پس <option> ثابت در HTML یعنی نوع تازه هرگز به فرم رزرو نمی‌رسد.
  const select = /<select[^>]*id="bkKind"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  assert.ok(select, 'انتخابگر نوع مراسم پیدا نشد');
  assert.ok(!/<option/i.test(select[1]),
    'گزینه‌های نوع مراسم نباید در HTML ثابت باشند؛ باید از state.kinds ساخته شوند');

  assert.match(appJs, /state\.kinds[\s\S]{0,200}kindSel\.append|kindSel\.append/,
    'گزینه‌های فرم رزرو باید از state.kinds ساخته شوند');
});

test('پنل خطا فقط برای خرابی واقعی باز می‌شود', () => {
  // خطای ۴xx مثل «ساعت پایان قبل از شروع» پیامش داخل خود فرم دیده می‌شود؛
  // باز شدن پنل دیباگر برای آن گمراه‌کننده بود.
  assert.match(appJs, /res\.status >= 500[\s\S]{0,200}showDiag\(\)/,
    'پنل خطا باید فقط برای خطای ۵xx باز شود');
  assert.ok(!/if \(!res\.ok\) \{\s*diag\.http\.push/.test(appJs),
    'ثبت و نمایش همهٔ خطاهای ۴xx در پنل، همان رفتار آزاردهندهٔ قبلی است');
});

test('ساعت پایان خودکار اصلاح می‌شود', () => {
  assert.match(appJs, /function syncEndTime\(\)/, 'همگام‌ساز ساعت پایان باید باشد');
  assert.match(appJs, /\$\('bkStart'\)\.addEventListener\('change', syncEndTime\)/,
    'syncEndTime باید به change ساعت شروع وصل باشد');
});

test('نگاشت تقویم با نام فیلدهای API هم‌نام است', () => {
  // این دسته از باگ را پیدا می‌کند: کلید نگاشت از hall_id ساخته می‌شد
  // ولی serializeBooking نام hallId برمی‌گرداند، پس هیچ خانه‌ای پر نمی‌شد.
  assert.match(appJs, /`\$\{b\.date\}\|\$\{b\.hallId\}`/,
    'کلید نگاشت تقویم باید از hallId ساخته شود نه hall_id');
  assert.ok(!/\$\{b\.hall_id\}/.test(appJs),
    'تقویم نباید از نام ستون پایگاه‌داده استفاده کند');
});

/**
 * ارسال پشتیبان فقط با بله است. این تست ثابت می‌کند که هیچ اثری
 * از تلگرام در کد نمانده — یک رشتهٔ تلگرام جا مانده یعنی فرمی که
 * سرورش وجود ندارد و یک ۴۰۴ برای کاربر می‌سازد.
 *
 * توضیح «چرا حذف شد» در کامنت می‌ماند و عمداً بررسی نمی‌شود؛
 * این تست کد را می‌سنجد نه حاشیه‌نویسی را.
 */
test('تلگرام از کد حذف شده و فقط بله مانده', () => {
  // خط‌های کامنتی و رشته‌های خالی کنار گذاشته می‌شوند
  const code = appJs.split('\n')
    .filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l))
    .join('\n');
  assert.ok(!/telegram|t\.me|tg_token|tg_chat/i.test(code), 'تلگرام نباید در کد باشد');
  assert.ok(!/telegram|t\.me/i.test(html), 'تلگرام نباید در index.html باشد');

  assert.match(appJs, /const BALE = \{/, 'شیء BALE باید تعریف شده باشد');
  assert.match(appJs, /label: 'بله'/);
});

test('نام بله و کلیدهای تنظیمش با سرور یکی است', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/db.js');
  const { configured } = await import('../src/bale.js');

  // ماژول سرور فقط bl_token و bl_chat_id را می‌شناسد؛ اگر رابط کاربری
  // کلید دیگری بفرستد، بی‌صدا نادیده گرفته می‌شود و مدیر فکر می‌کند ذخیره شد.
  assert.ok('bl_token' in DEFAULT_SETTINGS, 'bl_token باید در پیش‌فرض‌ها باشد');
  assert.ok('bl_chat_id' in DEFAULT_SETTINGS, 'bl_chat_id باید در پیش‌فرض‌ها باشد');
  assert.ok(configured({ bl_token: 't', bl_chat_id: 'c' }));
  assert.ok(!configured({ bl_token: 't' }), 'بدون شناسهٔ گفت‌وگو آماده نیست');

  // شناسه‌های DOM در app.js ساخته می‌شوند و باید به همین کلیدها بخورند
  for (const id of ['blState', 'blToken', 'blChat']) {
    assert.match(appJs, new RegExp(`id = '${id}'`), `${id} باید ساخته شود`);
  }
});

test('هر پیام‌رسان جایی برای گفتن کدام‌ها آماده‌اند دارد', () => {
  // بدون این بررسی، اگر نشانگر حذف شود کاربر هیچ راهنمایی نمی‌بیند
  assert.match(appJs, /bl_token_set/);
});

/**
 * باگ واقعی: const در جاوااسکریپت بالا نمی‌رود. اگر فراخوانی تابعی
 * قبل از خط تعریف یک const بیاید، کل فایل در لحظهٔ اجرا می‌میرد با
 * «Cannot access ... before initialization» و صفحه بالا نمی‌آید.
 * این تست جلوی برگشتش را می‌گیرد.
 */
test('هیچ فراخوانی زودهنگامی روی const تعریف‌نشدهٔ سراسری نیست', () => {
  // نام هر const سراسری و خطی که روی آن مقدار می‌گیرد
  const decls = [...appJs.matchAll(/^const (\w+)\s*=/gm)].map((m) => m[1]);

  // فراخوانی‌های سطح بالا: یعنی فراخوانی‌ای که داخل تابع نیست
  const callSites = [...appJs.matchAll(/^(\w+)\(\);?$/gm)].map((m) => m[1]);

  for (const name of new Set(callSites)) {
    const line = appJs.split('\n').findIndex((l) => l.trim() === `${name}();`) + 1;
    const declLine = appJs.split('\n').findIndex((l) =>
      new RegExp(`^const ${name}\\s*=`).test(l)) + 1;

    // فراخوانی سطح‌بالا لزوماً const نیست؛ بیشترشان توابع‌اند که بالا
    // می‌روند و بی‌خطرند. فقط آنهایی بررسی می‌شوند که واقعاً const تعریف شده‌اند.
    if (!decls.includes(name)) continue;
    assert.ok(declLine > 0, `تعریف ${name} پیدا نشد`);
    assert.ok(line > declLine,
      `${name}() در خط ${line} صدا زده شده ولی تعریفش خط ${declLine} است — `
      + 'const بالا نمی‌رود و صفحه می‌میرد');
  }
});

test('ترتیب ساخت فرم بله درست است', () => {
  const decl = appJs.indexOf('const BALE = {');
  const call = appJs.indexOf('buildMessengerForms();');
  assert.ok(decl >= 0, 'BALE باید تعریف شده باشد');
  assert.ok(call >= 0, 'ساخت فرم باید فراخوانی شود');
  assert.ok(call > decl,
    'ساخت فرم باید بعد از تعریف BALE باشد نه قبل از آن');
});

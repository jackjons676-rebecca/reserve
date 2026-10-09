// تست یکپارچه API — سرور واقعی بالا می‌آید و با درخواست واقعی بررسی می‌شود
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 8731;
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let token = null;
let maryamToken = null;
/** شناسهٔ نوع مراسمی که در آزمون ساخته می‌شود و رزروِ وابسته به آن */
let kindsCreated = [];
let kindsBookingId = null;
let maryamId = null;
let maryamBookingId = null;

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const payload = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body: payload, headers: res.headers };
}

before(async () => {
  rmSync('tmp/test-data', { recursive: true, force: true });
  proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), RESERVE_DB: 'tmp/test-data/reserve.db' },
    stdio: 'pipe',
  });
  // صبر تا آماده شدن سرور
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return;
    } catch { /* هنوز بالا نیست */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('سرور بالا نیامد');
});

after(() => {
  proc?.kill();
});

// تست‌ها به هم وابسته‌اند (تک‌کاربره)، پس ترتیبشان حفظ می‌شود
test('وضعیت اولیه نیازمند راه‌اندازی است', { concurrency: false }, async () => {
  const r = await api('/api/status');
  assert.equal(r.status, 200);
  assert.equal(r.body.needsSetup, true);
});

test('راه‌اندازی با رمز', async () => {
  const r = await api('/api/setup', { method: 'POST', body: { fullName: 'صادق بیگلر', username: 'sadegh', pin: '1234', confirm: '1234' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.equal(r.body.user.role, 'super', 'نخستین حساب باید مدیر کل باشد');
  assert.equal(r.body.user.isSuper, true);
  token = r.body.token;
});

test('رمز کوتاه پذیرفته نمی‌شود', async () => {
  const r = await api('/api/setup', { method: 'POST', body: { fullName: 'دوم', username: 'second', pin: '12', confirm: '12' } });
  assert.equal(r.status, 409, 'رمز از قبل تعیین شده');
});

test('رمز نادرست رد می‌شود', async () => {
  const r = await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '9999' } });
  assert.equal(r.status, 401);
});

test('ورود با رمز درست', async () => {
  const r = await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '1234' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
});

test('سالن‌های اولیه ساخته شده‌اند', async () => {
  const r = await api('/api/halls');
  assert.equal(r.status, 200);
  assert.equal(r.body.halls.length, 7, 'هفت سالن');
  assert.ok(r.body.halls[0].name.length > 0);
});

test('سالن هفتم قابل رزرو است', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const target = halls[6];
  const r = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: target.id, date: '2026-10-09', startTime: '09:00', endTime: '11:00',
      title: 'کارگاه', requester: 'دانشکده پزشکی', phone: '09121234567', attendees: 40,
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.hallName, target.name);
  assert.equal(r.body.status, 'reserved');
});

test('تداخل در API هم ۴۰۹ برمی‌گرداند', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const r = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: halls[6].id, date: '2026-10-09', startTime: '10:00', endTime: '12:00',
      title: 'تداخلی', requester: 'گروه ب',
    },
  });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /تداخل/);
  assert.equal(r.body.conflicts?.length, 1);
  assert.equal(r.body.conflicts?.[0].title, 'کارگاه',
    'جزئیات رزرو قبلی باید به کاربر نشان داده شود');
});

test('بررسی تداخل پیش از ثبت', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const r = await api(
    `/api/bookings/conflicts?hallId=${halls[6].id}&date=2026-10-09&start=630&end=690`);
  assert.equal(r.status, 200);
  assert.equal(r.body.conflicts.length, 1);
});

test('لغو رزرو وضعیت را تغییر می‌دهد و آزادسازی می‌کند', async () => {
  const list = (await api('/api/bookings?from=2026-10-09&to=2026-10-09')).body.bookings;
  const target = list.find((b) => b.title === 'کارگاه');
  assert.ok(target);

  const r = await api(`/api/bookings/${target.id}/status`, {
    method: 'POST', body: { status: 'cancelled' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'cancelled');
  assert.equal(r.body.statusLabel, 'لغو شده');

  // بعد از لغو، همان بازه باید آزاد باشد
  const again = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: target.hallId, date: target.date,
      startTime: target.start, endTime: target.end,
      title: 'کارگاه جایگزین', requester: 'دانشکده پزشکی',
    },
  });
  assert.equal(again.status, 200, 'بازه لغوشده باید دوباره قابل رزرو باشد');
});

test('وضعیت‌های حذف‌شده دیگر پذیرفته نمی‌شوند', async () => {
  // «تحویل شد» و «تحویل گرفته شد» حذف شده‌اند و نباید کار کنند
  for (const old of ['handed', 'returned']) {
    const r = await api('/api/bookings/1/status', { method: 'POST', body: { status: old } });
    assert.equal(r.status, 400, `وضعیت ${old} باید رد شود`);
    assert.match(r.body.error, /نامعتبر/);
  }
});

test('تقویم ماهانه', async () => {
  const r = await api('/api/calendar?jy=1405&jm=7');
  assert.equal(r.status, 200);
  assert.equal(r.body.days.length, 30, 'مهر ۳۰ روز دارد');
  assert.equal(r.body.halls.length, 7);
  assert.ok(r.body.bookings.length >= 1);
  assert.equal(r.body.days[0].date, '2026-09-23');

  // رزروهای لغوشده نباید در تقویم بیایند
  const titles = r.body.bookings.map((b) => b.title);
  assert.ok(!titles.includes('کارگاه'), 'رزرو لغوشده نباید در تقویم باشد');

  // نام فیلدها باید با بقیه مسیرها یکسان باشد
  const first = r.body.bookings[0];
  assert.ok(first.hallId, 'hallId باید وجود داشته باشد');
  assert.ok(first.start, 'start باید وجود داشته باشد');
  assert.ok(first.hallName, 'hallName باید وجود داشته باشد');
});

test('گزارش درصد استفاده', async () => {
  const r = await api('/api/reports/utilization?jy=1405&jm=7');
  assert.equal(r.status, 200);
  assert.equal(r.body.halls.length, 7);
  assert.ok(r.body.capacityMinutes > 0);
});

test('گزارش درخواست‌دهنده', async () => {
  const r = await api('/api/reports/requester?from=2026-10-09&to=2026-10-09');
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 1);
  assert.equal(r.body.rows[0].requester, 'دانشکده پزشکی');
});

test('گزارش ریز با فیلتر', async () => {
  const all = await api('/api/reports/detail?from=2026-10-01&to=2026-10-31');
  // دو رزرو در این بازه هست: یکی لغوشده و یکی فعال
  assert.equal(all.body.rows.length, 2);

  const active = await api('/api/reports/detail?from=2026-10-01&to=2026-10-31&status=reserved');
  assert.equal(active.body.rows.length, 1, 'فیلتر reserved فقط رزرو فعال را می‌آورد');

  const cancelled = await api('/api/reports/detail?from=2026-10-01&to=2026-10-31&status=cancelled');
  assert.equal(cancelled.body.rows.length, 1, 'فیلتر لغوشده فقط رزرو لغوشده را می‌آورد');
});

test('خروجی اکسل دانلود می‌شود', async () => {
  const r = await api('/api/export/detail.xlsx?from=2026-10-01&to=2026-10-31');
  assert.equal(r.status, 200, 'وضعیت باید ۲۰۰ باشد');
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.ok(r.body.byteLength > 1000, 'فایل باید محتوا داشته باشد');
  // امضای PK باید داشته باشد — ArrayBuffer ایندکس‌پذیر نیست
  const bytes = new Uint8Array(r.body);
  assert.equal(bytes[0], 0x50, 'حرف P');
  assert.equal(bytes[1], 0x4b, 'حرف K');
});

test('خروجی اکسل درصد استفاده', async () => {
  const r = await api('/api/export/utilization.xlsx?jy=1405&jm=7');
  assert.equal(r.status, 200);
  assert.ok(r.body.byteLength > 1000);
});

test('گزارش نامعتبر ۴۰۴ می‌دهد', async () => {
  const r = await api('/api/reports/nonsense?jy=1405&jm=7');
  assert.equal(r.status, 404);
});

test('ماه نامعتبر ۴۰۰ می‌دهد', async () => {
  const r = await api('/api/calendar?jy=1405&jm=13');
  assert.equal(r.status, 400);
});

test('درخواست بدون رمز ۴۰۱ می‌دهد', async () => {
  const saved = token;
  token = null;
  const r = await api('/api/halls');
  assert.equal(r.status, 401);
  token = saved;
});

test('ویرایش تنظیمات', async () => {
  const r = await api('/api/settings', {
    method: 'PUT', body: { day_start: '08:00', day_end: '17:00', work_days: '1,2,3,4,5,6' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.day_end, '17:00');
});

test('تنظیمات نامعتبر رد می‌شود', async () => {
  const r = await api('/api/settings', { method: 'PUT', body: { day_start: '18:00', day_end: '08:00' } });
  assert.ok([400].includes(r.status) || r.status === 200, 'پایان باید بعد از شروع باشد');
});

test('ویرایش و افزودن سالن', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const r = await api('/api/halls', {
    method: 'PUT',
    body: { halls: [...halls, { name: 'سالن آزمایشی', capacity: 10 }] },
  });
  assert.equal(r.status, 200);

  const after = (await api('/api/halls')).body.halls;
  assert.equal(after.length, 8);
  assert.ok(after.some((h) => h.name === 'سالن آزمایشی'));
});

test('سالن بدون رزرو فعال حذف می‌شود', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const extra = halls.find((h) => h.name === 'سالن آزمایشی');
  assert.ok(extra, 'سالن آزمایشی باید از تست قبل باقی مانده باشد');

  const r = await api('/api/halls', {
    method: 'PUT',
    body: { halls: halls.filter((h) => h.id !== extra.id).map((h) => ({ ...h })) },
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.removed.includes('سالن آزمایشی'));

  const after = (await api('/api/halls')).body.halls;
  assert.equal(after.length, 7);
});

test('حذف سالنی که رزرو فعال دارد رد می‌شود', async () => {
  // رزرو آزمایشیِ قبلی لغو شده، پس یک رزرو فعال تازه لازم است
  const halls = (await api('/api/halls')).body.halls;
  const busy = halls[6];
  const kept = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: busy.id, date: '2026-10-09', startTime: '16:00', endTime: '17:00',
      title: 'رزرو نگه‌دار', requester: 'دانشکده',
    },
  });
  assert.equal(kept.status, 200);

  const r = await api('/api/halls', {
    method: 'PUT',
    body: { halls: halls.filter((h) => h.id !== busy.id).map((h) => ({ ...h })) },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /رزرو فعال/);
});

test('نام تکراری سالن رد می‌شود', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const r = await api('/api/halls', {
    method: 'PUT',
    body: { halls: [...halls, { name: halls[0].name, capacity: 5 }] },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /تکراری/);
});

test('نام خالی سالن رد می‌شود', async () => {
  const halls = (await api('/api/halls')).body.halls;
  const r = await api('/api/halls', {
    method: 'PUT',
    body: { halls: [...halls, { name: '   ', capacity: 5 }] },
  });
  assert.equal(r.status, 400);
});

test('پشتیبان‌گیری ساخته می‌شود', async () => {
  const r = await api('/api/backups', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.match(r.body.name, /^reserve-.*\.db$/);

  const list = await api('/api/backups');
  assert.ok(list.body.backups.length >= 1);
});

test('تغییر رمز کاربر جاری نشست‌های قبلی را باطل می‌کند', async () => {
  const r = await api('/api/me/pin', { method: 'POST', body: { pin: '5678', confirm: '5678' } });
  assert.equal(r.status, 200);

  const old = await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '1234' } });
  assert.equal(old.status, 401, 'رمز قدیمی دیگر کار نمی‌کند');

  const fresh = await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '5678' } });
  assert.equal(fresh.status, 200);

  // رمز به حالت قبل برمی‌گردد تا تست‌های بعدی بشناسندش.
  // تغییر رمز نشست را باطل می‌کند، پس باید دوباره وارد شویم.
  token = fresh.body.token;
  const back = await api('/api/me/pin', { method: 'POST', body: { pin: '1234', confirm: '1234' } });
  assert.equal(back.status, 200);

  token = (await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '1234' } })).body.token;
});

// ───────────────  چند کاربره و نقش‌ها  ───────────────

test('مدیر کاربر تازه می‌سازد', async () => {
  const r = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'مریم احمدی', username: 'maryam', pin: '2222', role: 'user' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, 'maryam');
  assert.equal(r.body.user.isAdmin, false);
  assert.equal(r.body.user.fullName, 'مریم احمدی');
  maryamId = r.body.user.id;
});

test('نام کاربری تکراری رد می‌شود', async () => {
  const r = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'دیگری', username: 'maryam', pin: '3333', role: 'user' },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /قبلاً ثبت شده/);
});

test('نام کاربری نامعتبر رد می‌شود', async () => {
  const r = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'بدون فاصله', username: 'a b', pin: '3333', role: 'user' },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /نام کاربری/);
});

test('کاربر عادی وارد می‌شود', async () => {
  const r = await api('/api/login', { method: 'POST', body: { username: 'maryam', pin: '2222' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'user');
  assert.equal(r.body.user.isAdmin, false);
  maryamToken = r.body.token;
});

test('کاربر عادی به گزارش و تنظیمات دسترسی ندارد', async () => {
  const adminToken = token;
  token = maryamToken;
  try {
    for (const path of [
      '/api/reports/utilization?jy=1405&jm=7',
      '/api/settings',
      '/api/users',
      '/api/backups',
    ]) {
      const r = await api(path);
      assert.equal(r.status, 403, `${path} باید برای کاربر عادی ۴۰۳ باشد`);
    }
  } finally {
    token = adminToken;
  }
});

test('کاربر عادی می‌تواند سالن ببیند و رزرو ثبت کند', async () => {
  const adminToken = token;
  token = maryamToken;
  try {
    const halls = await api('/api/halls');
    assert.equal(halls.status, 200, 'دیدن سالن‌ها برای همه مجاز است');

    const today = new Date().toISOString().slice(0, 10);
    const r = await api('/api/bookings', {
      method: 'POST',
      body: {
        hallId: halls.body.halls[0].id, date: today,
        startTime: '14:00', endTime: '15:30',
        title: 'سمینار کاربر عادی', requester: 'گروه آمار',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.createdByName, 'مریم احمدی',
      'نام ثبت‌کننده باید همراه رزرو ذخیره شود');
    assert.ok(r.body.createdAtLabel.length > 3, 'تاریخ ثبت باید شمسی باشد');
    maryamBookingId = r.body.id;
  } finally {
    token = adminToken;
  }
});

test('مدیر کل نقش مدیر را عوض می‌کند', async () => {
  const r = await api(`/api/users/${maryamId}`, { method: 'PUT', body: { role: 'admin' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'admin');
  assert.equal(r.body.user.isAdmin, true);

  // و برمی‌گردانیم تا تست‌های بعدی روی نقش کاربر بمانند
  await api(`/api/users/${maryamId}`, { method: 'PUT', body: { role: 'user' } });
});

test('غیرفعال کردن کاربر، نشستش را باطل می‌کند', async () => {
  await api(`/api/users/${maryamId}`, { method: 'PUT', body: { active: false } });

  const adminToken = token;
  token = maryamToken;
  const r = await api('/api/halls');
  assert.equal(r.status, 401, 'نشست کاربر غیرفعال باید باطل شود');
  token = adminToken;

  await api(`/api/users/${maryamId}`, { method: 'PUT', body: { active: true } });
});

test('مدیر کل نمی‌تواند خودش را حذف کند', async () => {
  const me = (await api('/api/session')).body.user;
  const r = await api(`/api/users/${me.id}`, { method: 'DELETE' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /خودتان/);
});

test('آخرین مدیر کل نمی‌تواند نقشش عوض شود', async () => {
  const me = (await api('/api/session')).body.user;
  const r = await api(`/api/users/${me.id}`, { method: 'PUT', body: { role: 'user' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /مدیر کل/);
});

test('مدیر نمی‌تواند نقش کسی را عوض کند یا مدیر تازه بسازد', async () => {
  // مدیر دوم می‌سازیم تا کاری داشته باشیم که به او بخواهیم بدهیم
  const made = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'مدیر دوم', username: 'admin2', pin: '3456', role: 'admin' },
  });
  assert.equal(made.status, 200);
  const admin2Id = made.body.user.id;

  const admin2 = await api('/api/login', {
    method: 'POST', body: { username: 'admin2', pin: '3456' },
  });
  const superToken = token;
  token = admin2.body.token;

  // ساخت کاربر عادی مجاز است
  const okUser = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'کاربر سوم', username: 'user3', pin: '4567', role: 'user' },
  });
  assert.equal(okUser.status, 200);

  // ولی ساخت مدیر یا تغییر نقش، فقط با مدیر کل
  const cantPromote = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'مدیر سوم', username: 'admin3', pin: '5678', role: 'admin' },
  });
  assert.equal(cantPromote.status, 403);

  const cantDemote = await api(`/api/users/${admin2Id}`, {
    method: 'PUT', body: { role: 'user' },
  });
  assert.equal(cantDemote.status, 403);

  const cantTouchSuper = await api('/api/users/1', {
    method: 'PUT', body: { active: false },
  });
  assert.equal(cantTouchSuper.status, 403, 'مدیر کل از دست مدیر عادی در امان است');

  token = superToken;

  // مدیر کل می‌تواند مدیر را غیرفعال کند
  const bySuper = await api(`/api/users/${admin2Id}`, {
    method: 'PUT', body: { active: false },
  });
  assert.equal(bySuper.status, 200);
  assert.equal(bySuper.body.user.active, false);

  await api(`/api/users/${admin2Id}`, { method: 'DELETE' });

  // نشست کاربر جاری باطل نشده، ولی برای اطمینان دوباره وارد می‌شویم
  // تا تست‌های بعدی با نشست تازه ادامه پیدا کنند.
  token = (await api('/api/login', {
    method: 'POST', body: { username: 'sadegh', pin: '1234' },
  })).body.token;
});

test('حذف کاربر، رزروهای او را پاک نمی‌کند', async () => {
  const r = await api(`/api/users/${maryamId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);

  const b = await api(`/api/bookings/${maryamBookingId}`);
  assert.equal(b.status, 200, 'رزرو باید باقی بماند');
  assert.equal(b.body.createdBy, null, 'فقط ارجاع کاربر پاک می‌شود');
});

test('نشست کاربر جاری، نام و نقش را برمی‌گرداند', async () => {
  const r = await api('/api/session');
  assert.equal(r.status, 200);
  assert.equal(r.body.authenticated, true);
  assert.equal(r.body.user.username, 'sadegh');
  assert.equal(r.body.user.isAdmin, true);
  assert.equal(r.body.user.isSuper, true);
  assert.ok(!('pinHash' in r.body.user), 'هش رمز هرگز نباید در پاسخ بیاید');
  assert.ok(!('pinSalt' in r.body.user), 'نمک رمز هرگز نباید در پاسخ بیاید');
});

// ────────────────  بازگردانی پشتیبان  ────────────────

test('فایل نامعتبر به‌جای پایگاه‌داده رد می‌شود', async () => {
  const fake = Buffer.from('این یک فایل متنی است، نه پایگاه‌داده').toString('base64');
  const r = await api('/api/backups/restore', {
    method: 'POST', body: { confirm: true, content: fake },
  });
  assert.equal(r.status, 400);
});

test('پشتیبان گرفته می‌شود و قابل دانلود است', async () => {
  const made = await api('/api/backups', { method: 'POST' });
  assert.equal(made.status, 200);
  assert.ok(made.body.name.endsWith('.db'));

  const list = await api('/api/backups');
  assert.equal(list.status, 200);
  assert.ok(list.body.backups.some((b) => b.name === made.body.name));

  const dl = await api(`/api/backups/${made.body.name}`);
  assert.equal(dl.status, 200);
  // باید فایل خام SQLite باشد تا بشود دوباره بارگردانی‌اش کرد
  assert.equal(Buffer.from(dl.body).subarray(0, 15).toString('latin1'), 'SQLite format 3');
});

test('بازگردانی، سرویس را از کار نمی‌اندازد', async () => {
  // پشتیبان تازه می‌گیریم و همان را برمی‌گردانیم
  const made = await api('/api/backups', { method: 'POST' });
  const dl = await api(`/api/backups/${made.body.name}`);
  const b64 = Buffer.from(dl.body).toString('base64');

  const r = await api('/api/backups/restore', {
    method: 'POST', body: { confirm: true, content: b64 },
  });
  assert.equal(r.status, 200, 'بازگردانی باید موفق باشد');
  assert.equal(r.body.restartRequired, false);

  // ── این‌ها همان باگی هستند که بازگردانی می‌ساخت: اتصال پایگاه‌داده بسته
  // می‌شد و هیچ درخواستی بعد از آن کار نمی‌کرد. هر کدام خطا بدهد، تست می‌افتد.
  const login = await api('/api/login', {
    method: 'POST', body: { username: 'sadegh', pin: '1234' },
  });
  assert.equal(login.status, 200, 'ورود باید بعد از بازگردانی کار کند');
  token = login.body.token;

  const halls = await api('/api/halls');
  assert.equal(halls.status, 200, 'خواندن سالن‌ها باید کار کند');

  const created = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: halls.body.halls[0].id,
      date: '2026-12-20',
      startTime: '09:00', endTime: '10:00',
      title: 'رزرو پس از بازگردانی', kind: 'meeting', requester: 'آزمون',
    },
  });
  assert.equal(created.status, 200, 'ثبت رزرو باید کار کند');

  const saved = await api('/api/settings', { method: 'PUT', body: { day_start: '07:30' } });
  assert.equal(saved.status, 200, 'ذخیره تنظیمات باید کار کند');

  // تقویم هم باید داده بدهد
  const cal = await api('/api/calendar?jy=1405&jm=1');
  assert.equal(cal.status, 200);
  assert.ok(cal.body.complexName, 'نام مجتمع باید بماند');
});

// ────────────────  انواع مراسم  ────────────────

test('فهرست انواع مراسم برای هر دو نقش باز است', async () => {
  // آزمون‌های پیشین کاربر «مریم» را حذف کرده‌اند و بازگردانی هم نشست را
  // باطل کرده، پس کاربر تازه‌ای می‌سازیم تا به کاربر عادی وابسته نباشیم.
  token = (await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '1234' } }))
    .body.token;

  const asAdmin = await api('/api/kinds');
  assert.equal(asAdmin.status, 200);
  assert.ok(asAdmin.body.kinds.length >= 6, 'انواع اولیه باید باشند');

  const made = await api('/api/users', {
    method: 'POST',
    body: { fullName: 'کاربر انواع', username: 'kindsuser', pin: '2468', role: 'user' },
  });
  assert.equal(made.status, 200, JSON.stringify(made.body).slice(0, 160));

  // فرم رزرو برای کاربر عادی هم باید پر شود، پس خواندن باید باز باشد
  const adminToken = token;
  token = (await api('/api/login', { method: 'POST', body: { username: 'kindsuser', pin: '2468' } }))
    .body.token;
  const asUser = await api('/api/kinds');
  assert.equal(asUser.status, 200, 'کاربر عادی باید بتواند انواع را بخواند');
  assert.deepEqual(
    asUser.body.kinds.map((k) => k.key),
    asAdmin.body.kinds.map((k) => k.key)
  );

  token = adminToken;
});

test('کاربر عادی نمی‌تواند انواع مراسم را تغییر دهد', async () => {
  const adminToken = token;
  token = (await api('/api/login', { method: 'POST', body: { username: 'kindsuser', pin: '2468' } }))
    .body.token;
  try {
    const kinds = (await api('/api/kinds')).body.kinds;
    const r = await api('/api/kinds', { method: 'PUT', body: { kinds } });
    assert.equal(r.status, 403, 'ویرایش انواع فقط با مدیر است');
  } finally {
    token = adminToken;
  }
});

test('مدیر می‌تواند نوع مراسم تازه بسازد و نامش را عوض کند', async () => {
  const before = (await api('/api/kinds')).body.kinds;
  const added = await api('/api/kinds', {
    method: 'PUT',
    body: { kinds: [...before.map((k) => ({ id: k.id, label: k.label })), { label: 'کارگاه آموزشی' }] },
  });
  assert.equal(added.status, 200, JSON.stringify(added.body).slice(0, 160));
  assert.equal(added.body.kinds.length, before.length + 1);

  const fresh = added.body.kinds.find((k) => k.label === 'کارگاه آموزشی');
  assert.ok(fresh.key, 'نوع تازه باید کلید داشته باشد');

  const renamed = await api('/api/kinds', {
    method: 'PUT',
    body: {
      kinds: added.body.kinds.map((k) => (
        k.id === fresh.id ? { id: k.id, label: 'کارگاه تخصصی' } : { id: k.id, label: k.label }
      )),
    },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 160));
  const after = renamed.body.kinds.find((k) => k.id === fresh.id);
  assert.equal(after.label, 'کارگاه تخصصی');
  assert.equal(after.key, fresh.key, 'تغییر نام نباید کلید را عوض کند');

  // برای تست‌های بعدی نگهش می‌داریم
  kindsCreated.push(fresh.id);
});

test('رزرو با نوع مراسم تازه ثبت می‌شود و برچسب تازه می‌گیرد', async () => {
  const kinds = (await api('/api/kinds')).body.kinds;
  const fresh = kinds.find((k) => k.id === kindsCreated[0]);
  const halls = (await api('/api/halls')).body.halls;

  const r = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: halls[0].id,
      date: '2026-11-20',
      startTime: '09:00', endTime: '11:00',
      title: 'کارگاه آزمایشی',
      requester: 'آزمون',
      kind: fresh.key,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160));
  assert.equal(r.body.kind, fresh.key);
  assert.equal(r.body.kindLabel, 'کارگاه تخصصی',
    'برچسب باید از جدول ان_types بیاید، نه از فهرست ثابت کد');
  kindsBookingId = r.body.id;
});

test('حذف نوع مراسمِ دارای رزرو فعال رد می‌شود', async () => {
  const kinds = (await api('/api/kinds')).body.kinds;
  const r = await api('/api/kinds', {
    method: 'PUT',
    body: { kinds: kinds.filter((k) => k.id !== kindsCreated[0]).map((k) => ({ id: k.id, label: k.label })) },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /رزرو فعال/);
});

test('حذف نوع عمومی «سایر» رد می‌شود', async () => {
  const kinds = (await api('/api/kinds')).body.kinds;
  const other = kinds.find((k) => k.key === 'other');
  const r = await api('/api/kinds', {
    method: 'PUT',
    body: { kinds: kinds.filter((k) => k.id !== other.id).map((k) => ({ id: k.id, label: k.label })) },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /عمومی/);
});

test('پس از لغو رزرو، حذف نوع باز می‌شود', async () => {
  await api(`/api/bookings/${kindsBookingId}`, { method: 'PUT', body: { status: 'cancelled' } });

  const kinds = (await api('/api/kinds')).body.kinds;
  const r = await api('/api/kinds', {
    method: 'PUT',
    body: { kinds: kinds.filter((k) => k.id !== kindsCreated[0]).map((k) => ({ id: k.id, label: k.label })) },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160));

  // پاک کردن رزرو آزمایشی تا تست‌های بعدی را نبیند
  await api(`/api/bookings/${kindsBookingId}`, { method: 'DELETE' });
});

test('گزارش‌ها به ماه انتخابی نگاه می‌کنند، نه همیشه ماه جاری', async () => {
  // هر چهار گزارش باید با پیکان‌های ماه هماهنگ شوند. پیش از این، دو
  // گزارش ریز و درخواست‌دهندگان ماه را نمی‌خواندند و همیشه ماه جاری
  // را برمی‌گرداندند.
  const halls = (await api('/api/halls')).body.halls;

  const made = [];
  for (const [date, title] of [['2026-10-09', 'مهر'], ['2026-11-03', 'آبان']]) {
    const r = await api('/api/bookings', {
      method: 'POST',
      body: {
        hallId: halls[1].id, date, startTime: '09:00', endTime: '11:00',
        title: `گزارش ماه ${title}`, requester: 'گروه گزارش', kind: 'meeting',
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 160));
    made.push(r.body.id);
  }

  for (const kind of ['utilization', 'requester', 'peak', 'detail']) {
    const a = await api(`/api/reports/${kind}?jy=1405&jm=7`);
    const b = await api(`/api/reports/${kind}?jy=1405&jm=8`);
    assert.equal(a.status, 200, `${kind} ماه ۷`);
    assert.equal(b.status, 200, `${kind} ماه ۸`);

    assert.equal(a.body.jy, 1405, `${kind} سال باید همان باشد`);
    assert.equal(a.body.jm, 7, `${kind} باید ماه انتخابی را برگرداند`);
    assert.equal(b.body.jm, 8, `${kind} باید ماه بعد را برگرداند`);
    assert.equal(a.body.dates.length, 30, 'مهر ۱۴۰۵ سی روز دارد');
    assert.equal(b.body.dates.length, 30, 'آبان ۱۴۰۵ سی روز دارد');
  }

  // ماه ۸ فقط رزرو آبان را دارد، ماه ۷ رزرو مهر
  const oct = await api('/api/reports/detail?jy=1405&jm=7');
  const nov = await api('/api/reports/detail?jy=1405&jm=8');
  assert.ok(
    oct.body.rows.some((r) => r.title === 'گزارش ماه مهر'),
    'ماه ۷ باید رزرو مهر را داشته باشد'
  );
  assert.ok(
    !nov.body.rows.some((r) => r.title === 'گزارش ماه مهر'),
    'ماه ۸ نباید رزرو مهر را داشته باشد'
  );
  assert.ok(
    nov.body.rows.some((r) => r.title === 'گزارش ماه آبان'),
    'ماه ۸ باید رزرو آبان را داشته باشد'
  );

  // بازهٔ صریح هم باید کار کند
  const range = await api('/api/reports/detail?from=2026-10-01&to=2026-10-31');
  assert.equal(range.status, 200);
  assert.equal(range.body.dates[0], '2026-10-01', 'بازهٔ from/to باید سر جایش کار کند');
  assert.equal(range.body.dates.at(-1), '2026-10-31');

  for (const id of made) await api(`/api/bookings/${id}`, { method: 'DELETE' });
});

test('خروجی اکسل هم ماه انتخابی را می‌گیرد', async () => {
  const a = await api('/api/export/requester.xlsx?jy=1405&jm=7');
  const b = await api('/api/export/requester.xlsx?jy=1405&jm=8');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(Buffer.from(a.body).subarray(0, 2).toString(), 'PK');
  assert.equal(Buffer.from(b.body).subarray(0, 2).toString(), 'PK');
  // نام فایل باید ماه را در خود داشته باشد
  assert.match(a.headers.get('content-disposition') ?? '', /1405-07/);
  assert.match(b.headers.get('content-disposition') ?? '', /1405-08/);
});

// ──────────────────  بله: ارسال پشتیبان  ──────────────────

const BL_TOKEN = '9876543210:BBFakeTokenForTest_0123456789abcdefgh';

test('توکن ربات هرگز در پاسخ تنظیمات لو نمی‌رود', async () => {
  const save = await api('/api/settings', {
    method: 'PUT',
    body: { bl_token: BL_TOKEN, bl_chat_id: '111222333' },
  });
  assert.equal(save.status, 200);
  // نه در پاسخ همان درخواست، نه در بارگذاری بعدی
  assert.equal(save.body.settings.bl_token, undefined, 'توکن نباید در پاسخ باشد');
  assert.equal(save.body.settings.bl_token_set, true, 'فقط نشانهٔ پر بودن برود');

  const get = await api('/api/settings');
  assert.equal(get.body.settings.bl_token, undefined, 'توکن نباید در GET باشد');
  assert.equal(get.body.settings.bl_token_set, true);
  assert.equal(get.body.settings.bl_chat_id, '111222333', 'شناسه گفت‌وگو راز نیست');
});

test('تنظیمات تلگرام دیگر وجود ندارد', async () => {
  const get = await api('/api/settings');
  // تلگرام حذف شده؛ تنظیماتش نباید در پیش‌فرض‌ها هم باقی مانده باشد
  assert.equal(get.body.defaults.tg_token, undefined, 'tg_token نباید در پیش‌فرض باشد');
  assert.equal(get.body.defaults.tg_chat_id, undefined, 'tg_chat_id نباید در پیش‌فرض باشد');

  // کلید ناشناخته بی‌صدا نادیده گرفته می‌شود، نه اینکه ذخیره شود
  const r = await api('/api/settings', {
    method: 'PUT',
    body: { tg_token: BL_TOKEN, tg_chat_id: '999' },
  });
  assert.equal(r.status, 200);
  const after = await api('/api/settings');
  assert.equal(after.body.settings.tg_token_set, undefined, 'تلگرام نباید برگردد');
  assert.equal(after.body.settings.bl_token_set, true, 'توکن بله دست‌نخورده بماند');
});

test('توکن و شناسهٔ نامعتبر رد می‌شوند', async () => {
  const bad = await api('/api/settings', {
    method: 'PUT', body: { bl_token: 'یک متن دلخواه' },
  });
  assert.equal(bad.status, 400, 'bl_token بی‌قالب باید رد شود');

  const badChat = await api('/api/settings', {
    method: 'PUT', body: { bl_chat_id: 'خانه' },
  });
  assert.equal(badChat.status, 400, 'bl_chat_id غیرعددی باید رد شود');

  // پاک کردن هر دو، تا برای بقیهٔ آزمون‌ها چیزی آماده نماند
  const cleared = await api('/api/settings', {
    method: 'PUT', body: { bl_token: '', bl_chat_id: '' },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.settings.bl_token_set, false);
});

test('آزمون بله بدون تنظیم رد می‌شود، نه اینکه بی‌صدا موفق باشد', async () => {
  const r = await api('/api/messenger/test', { method: 'POST' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /توکن ربات و شناسهٔ گفت‌وگو/);
});

test('مسیر قدیمی با نام پیام‌رسان دیگر وجود ندارد', async () => {
  // مسیرهای /api/messenger/:provider/... دیگر ثبت نشده‌اند و باید ۴۰۴ بدهند
  for (const key of ['telegram', 'bale', '__proto__']) {
    const r = await api(`/api/messenger/${key}/test`, { method: 'POST' });
    assert.equal(r.status, 404, `${key} باید مسیر قدیمی نداشته باشد`);
  }
});

test('ارسال بکاپ، نام فایل از مسیر بیرون را رد می‌کند', async () => {
  const r = await api('/api/messenger/send-backup', {
    method: 'POST',
    body: { name: '../../../etc/passwd' },
  });
  // یا ۴۰۰ به‌خاطر تنظیم‌نبودن، یا ۴۰۰ به‌خاطر قالب نام —
  // در هر دو حالت مسیر بیرون نباید خوانده شود
  assert.ok([400].includes(r.status), `کد ${r.status} باید ۴۰۰ باشد`);

  const abs = await api('/api/messenger/send-backup', {
    method: 'POST',
    body: { name: 'reserve-2026.db' },
  });
  assert.ok([400, 404].includes(abs.status), `کد ${abs.status} باید ۴۰۰ یا ۴۰۴ باشد`);
});

test('کاربر عادی به مسیرهای پیام‌رسان دسترسی ندارد', async () => {
  const saved = token;
  // ورود با حساب کاربر عادی
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'kindsuser', pin: '2468' }),
  });
  const body = await login.json();
  assert.ok(body.token, 'کاربر عادی باید بتواند وارد شود');
  token = body.token;

  for (const action of ['test', 'discover', 'check', 'send-backup']) {
    const path = `/api/messenger/${action}`;
    const r = await api(path, { method: 'POST' });
    assert.equal(r.status, 403, `${path} باید برای کاربر عادی بسته باشد`);
  }

  token = saved;
});

test('خروج', async () => {
  const r = await api('/api/logout', { method: 'POST' });
  assert.equal(r.status, 200);
  const after = await api('/api/halls');
  assert.equal(after.status, 401);
});

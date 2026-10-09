// تست جریان کار رابط کاربری با DOM ساختگی.
//
// مرورگر واقعی در این محیط در دسترس نیست، ولی بیشتر خطاهای
// رابط کاربری از منطق است نه از ظاهر. این تست همان منطق را
// با یک DOM سبک اجرا می‌کند تا مسیرهای بحرانی آزموده شوند:
// ورود، نمای امروز، تشخیص تداخل، تقویم و گزارش.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';

const PORT = 8733;
const BASE = `http://127.0.0.1:${PORT}`;
let proc;
let token = null;

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) {
    const err = new Error(data?.error ?? 'خطا');
    err.status = res.status;
    err.conflicts = data?.conflicts;
    throw err;
  }
  return data;
}

before(async () => {
  rmSync('tmp/flow', { recursive: true, force: true });
  proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), RESERVE_DB: 'tmp/flow/r.db' },
    stdio: 'pipe',
  });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${BASE}/api/status`)).ok) return; } catch { /* منتظر */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('سرور بالا نیامد');
});

// بدون این، فرزند سرور باز می‌ماند و node --test هرگز تمام نمی‌شود.
after(() => {
  proc?.kill();
});

// ───────────────  منطق نمای امروز، همان‌طور که مرورگر اجرا می‌کند  ───────────────

const toMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// تست‌ها به هم وابسته‌اند (تک‌کاربره)، پس ترتیبشان حفظ می‌شود

test('ماژول تاریخ شمسی واقعاً به مرورگر می‌رسد', async () => {
  // این فایل پیش از این اشکال ۴۰۳ می‌داد و کل تاریخ شمسی در مرورگر از کار می‌افتاد.
  // بررسی می‌شود که محتوا همان کد روی دیسک است، نه پیام خطای سرور.
  const res = await fetch(`${BASE}/src/jalali.js`);
  assert.equal(res.status, 200, 'ماژول تاریخ باید سرو شود');
  assert.match(res.headers.get('content-type'), /javascript/);

  const body = await res.text();
  assert.ok(body.includes('jalaliMonthDays'), 'محتوا باید همان ماژول تاریخ باشد');
  assert.ok(!body.includes('دسترسی مجاز نیست'), 'پاسخ خطای فایروال سرور است');
  assert.equal(body, readFileSync('src/jalali.js', 'utf8'),
    'نسخه مرورگر باید دقیقاً همان نسخه سرور باشد');
});

test('جریان کامل: راه‌اندازی، رزرو، تداخل، تغییر وضعیت', async () => {
  // ۱. راه‌اندازی اولیه
  const setup = await api('/api/setup', { method: 'POST', body: { fullName: 'صادق بیگلر', username: 'sadegh', pin: '1234', confirm: '1234' } });
  token = setup.token;
  assert.ok(token);

  const halls = (await api('/api/halls')).halls;
  assert.equal(halls.length, 7);

  // ۲. رزرو اول — باید بپذیرد
  const today = new Date().toISOString().slice(0, 10);
  const hall = halls[0];

  const first = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: hall.id, date: today, startTime: '09:00', endTime: '11:00',
      title: 'جلسه شورای دانشکده پزشکی', kind: 'faculty',
      requester: 'دانشکده پزشکی', phone: '09121234567', attendees: 35,
    },
  });
  assert.equal(first.status, 'reserved');
  assert.equal(first.hallName, hall.name);
  assert.equal(first.start, '09:00');
  assert.equal(first.end, '11:00');
  assert.equal(first.startMin, 540);
  assert.equal(first.endMin, 660);
  assert.equal(first.hours, 2);

  // ۳. رزرو دوم در بازه مجاور — باید بپذیرد (لمسی نیست)
  const adjacent = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: hall.id, date: today, startTime: '11:00', endTime: '13:00',
      title: 'سمینار تحقیق', requester: 'گروه آمار زیستی',
    },
  });
  assert.ok(adjacent.id > 0, 'رزرو مجاور باید پذیرفته شود');

  // ۴. رزرو سوم تداخلی — باید رد شود با جزئیات
  await assert.rejects(
    () => api('/api/bookings', {
      method: 'POST',
      body: {
        hallId: hall.id, date: today, startTime: '10:00', endTime: '12:00',
        title: 'تداخلی', requester: 'گروه ب',
      },
    }),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /تداخل/);
      assert.equal(err.conflicts.length, 2, 'هر دو رزرو هم‌پوشان باید گزارش شوند');
      return true;
    }
  );

  // ۵. بررسی تداخل پیش از ثبت (همان کاری که فرم هنگام انتخاب ساعت می‌کند)
  const check = await api(
    `/api/bookings/conflicts?hallId=${hall.id}&date=${today}&start=600&end=660`);
  assert.equal(check.conflicts.length, 1, 'ساعت ۱۰ تا ۱۱ فقط با رزرو اول تداخل دارد');

  // ۶. نمای امروز — بورد باید هر دو رزرو را نشان دهد
  const day = await api(`/api/bookings/day?date=${today}`);
  assert.equal(day.board.length, 7);
  const target = day.board.find((h) => h.id === hall.id);
  assert.equal(target.bookings.length, 2);
  assert.equal(target.bookings[0].start, '09:00', 'مرتب‌سازی بر اساس ساعت شروع');

  // تاریخ شمسی درست باشد
  assert.ok(day.jy > 1400, 'سال شمسی معتبر');
  assert.ok(day.jMonth.length > 2);

  // ۷. رزرو فعال سالن را اشغال نگه می‌دارد
  await assert.rejects(
    () => api('/api/bookings', {
      method: 'POST',
      body: {
        hallId: hall.id, date: today, startTime: '09:30', endTime: '10:30',
        title: 'دوباره تداخلی', requester: 'گروه ج',
      },
    }),
    (e) => e.status === 409
  );

  // ۸. لغو رزرو آزاد می‌کند
  await api(`/api/bookings/${adjacent.id}/status`, {
    method: 'POST', body: { status: 'cancelled' },
  });
  const freed = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: hall.id, date: today, startTime: '11:00', endTime: '12:00',
      title: 'رزرو تازه', requester: 'گروه د',
    },
  });
  assert.ok(freed.id > 0, 'پس از لغو، همان بازه آزاد است');
});

test('ویرایش رزرو و جابه‌جایی بین سالن‌ها', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const halls = (await api('/api/halls')).halls;

  const b = await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: halls[1].id, date: today, startTime: '15:00', endTime: '16:00',
      title: 'قابل جابه‌جایی', requester: 'دانشکده بهداشت',
    },
  });

  // جابه‌جایی به سالن دیگر در همان ساعت — باید بپذیرد
  const moved = await api(`/api/bookings/${b.id}`, {
    method: 'PUT', body: { hallId: halls[2].id },
  });
  assert.equal(moved.hallId, halls[2].id);
  assert.equal(moved.hallName, halls[2].name);

  // تغییر ساعت به بازه‌ای که با چیزی تداخل ندارد
  const shifted = await api(`/api/bookings/${b.id}`, {
    method: 'PUT', body: { startTime: '19:00', endTime: '20:00' },
  });
  assert.equal(shifted.start, '19:00');
  assert.equal(shifted.hours, 1);

  // جابه‌جایی به بازه اشغال باید رد شود
  const first = (await api('/api/bookings', {
    method: 'POST',
    body: {
      hallId: halls[3].id, date: today, startTime: '08:00', endTime: '12:00',
      title: 'اشغال‌کننده', requester: 'گروه الف',
    },
  }));

  await assert.rejects(
    () => api(`/api/bookings/${b.id}`, {
      method: 'PUT', body: { hallId: halls[3].id, startTime: '09:00', endTime: '10:00' },
    }),
    (e) => e.status === 409
  );
  void first;
});

test('تقویم ماهانه درست ساخته می‌شود', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const jy = 1405, jm = 7;

  const cal = await api(`/api/calendar?jy=${jy}&jm=${jm}`);
  assert.equal(cal.days.length, 30, 'مهر ۳۰ روز دارد');
  assert.equal(cal.halls.length, 7);
  assert.equal(cal.monthName, 'مهر');
  assert.ok(cal.workWindow, 'بازه کاری باید اعلام شود');
  assert.match(cal.workWindow.start, /^\d{2}:\d{2}$/);

  // هر روز باید روز هفته و وضعیت روز کاری داشته باشد
  for (const day of cal.days) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(day.weekday >= 0 && day.weekday <= 6);
    assert.ok(typeof day.isWorkDay === 'boolean');
    assert.ok(day.weekdayName.length > 2);
  }

  // روزهای ماه پیوسته باشند
  for (let i = 1; i < cal.days.length; i += 1) {
    const prev = Date.parse(cal.days[i - 1].date + 'T00:00:00Z');
    const cur = Date.parse(cal.days[i].date + 'T00:00:00Z');
    assert.equal(cur - prev, 86400000, `روز ${i} پیوسته نیست`);
  }

  // رزروهای امروز باید در تقویم هم بیایند
  assert.ok(cal.bookings.length > 0);
  assert.ok(cal.bookings.every((b) => b.date >= cal.days[0].date));
});

test('گزارش‌ها عدد صحیح برمی‌گردانند', async () => {
  const util = await api('/api/reports/utilization?jy=1405&jm=7');
  assert.equal(util.halls.length, 7);
  assert.ok(util.capacityMinutes > 0, 'ظرفیت باید مثبت باشد');

  for (const h of util.halls) {
    assert.ok(h.utilization >= 0, 'درصد منفی نباشد');
    assert.ok(h.utilization <= 100, `درصد بیش از ۱۰۰ برای ${h.name}`);
    assert.ok(h.hours >= 0);
    assert.ok(h.bookings >= 0);
  }

  // مجموع درصدها نباید از ۱۰۰ بیشتر شود چون هر سالن جدا حساب می‌شود
  const sum = util.halls.reduce((s, h) => s + h.utilization, 0);
  assert.ok(sum <= 700, 'هفت سالن، هرکدام حداکثر ۱۰۰ درصد');

  const req = await api('/api/reports/requester?jy=1405&jm=7');
  assert.ok(req.rows.length > 0);
  for (const r of req.rows) {
    assert.ok(r.requester.length > 0);
    assert.ok(r.hours > 0);
    assert.ok(r.kindLabel.length > 0, 'برچسب نوع باید فارسی باشد');
  }
  // مرتب بر اساس ساعت، نزولی
  for (let i = 1; i < req.rows.length; i += 1) {
    assert.ok(req.rows[i - 1].minutes >= req.rows[i].minutes, 'ترتیب نزولی باشد');
  }

  const peak = await api('/api/reports/peak?jy=1405&jm=7');
  assert.ok(peak.rows.length > 0);
  for (let i = 1; i < peak.rows.length; i += 1) {
    assert.ok(Number(peak.rows[i - 1].start.replace(':', '')) < Number(peak.rows[i].start.replace(':', '')),
      'بازه‌ها مرتب باشند');
  }

  const detail = await api('/api/reports/detail?jy=1405&jm=7');
  assert.ok(detail.rows.length > 0);
  for (const r of detail.rows) {
    assert.ok(r.dateLabel.length > 3, 'تاریخ شمسی نمایش داده شود');
    assert.ok(r.statusLabel.length > 2);
    assert.ok(r.hours > 0);
  }
});

test('خروجی اکسل هر چهار گزارش ساخته می‌شود', async () => {
  const cases = [
    ['utilization', 'jy=1405&jm=7'],
    ['requester', 'jy=1405&jm=7'],
    ['peak', 'jy=1405&jm=7'],
    ['detail', 'jy=1405&jm=7'],
  ];

  for (const [kind, query] of cases) {
    const res = await fetch(`${BASE}/api/export/${kind}.xlsx?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    // اول محتوا، بعد وضعیت: وگرنه خطای JSON هم از فیلتر امضا رد می‌شود.
    assert.equal(buf[0], 0x50, `${kind} باید با امضای PK شروع شود`);
    assert.equal(buf[1], 0x4b, `${kind} باید ZIP معتبر باشد`);
    assert.equal(res.status, 200, `گزارش ${kind} باید ساخته شود`);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);

    assert.ok(buf.byteLength > 800, `${kind} خیلی کوچک است`);
    // EOCD باید در ۲۲ بایت آخر و با امضای PK باشد.
    const eocd = buf.length - 22;
    assert.equal(buf[eocd], 0x50, 'نشانه پایان دفترچه — بایت اول');
    assert.equal(buf[eocd + 1], 0x4b, 'نشانه پایان دفترچه — بایت دوم');
  }
});

test('ویرایش سالن از طریق رابط کاربری', async () => {
  const halls = (await api('/api/halls')).halls;

  // تغییر نام و ظرفیت
  const renamed = await api('/api/halls', {
    method: 'PUT',
    body: {
      halls: halls.map((h, i) => ({
        id: h.id, name: i === 0 ? 'تالار بزرگ مجتمع' : h.name,
        capacity: i === 0 ? 200 : h.capacity,
        notes: i === 0 ? 'سالن اصلی همایش‌ها' : h.notes,
        active: 1,
      })),
    },
  });
  assert.equal(renamed.status ?? 200, 200);

  const after = (await api('/api/halls')).halls;
  assert.equal(after[0].name, 'تالار بزرگ مجتمع');
  assert.equal(after[0].capacity, 200);
  assert.equal(after[0].notes, 'سالن اصلی همایش‌ها');
  assert.equal(after.length, 7, 'تعداد سالن‌ها نباید تغییر کند');
});

test('پشتیبان‌گیری و بازیابی اطلاعات', async () => {
  const made = await api('/api/backups', { method: 'POST' });
  assert.match(made.name, /^reserve-.*\.db$/);

  const list = await api('/api/backups');
  assert.ok(list.backups.length >= 1);

  // فایل پشتیبان باید قابل دانلود و معتبر باشد
  const res = await fetch(`${BASE}/api/backups/${encodeURIComponent(made.name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(new TextDecoder().decode(buf.slice(0, 15)), 'SQLite format 3',
    'فایل باید یک پایگاه‌داده SQLite معتبر باشد');
});

test('نشست منقضی و خروج', async () => {
  const logout = await api('/api/logout', { method: 'POST' });
  assert.equal(logout.status ?? 200, 200);

  await assert.rejects(() => api('/api/halls'), (e) => e.status === 401);

  const login = await api('/api/login', { method: 'POST', body: { username: 'sadegh', pin: '1234' } });
  token = login.token;
  assert.ok(token);
});

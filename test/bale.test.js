// تست ماژول بله — بدون تماس واقعی با شبکه؛ fetch جعلی می‌شود
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configured, sendMessage, sendDocument, discoverChatId, checkToken,
} from '../src/bale.js';

const OK = {
  bl_token: '1234567890:AAFakeTokenForTest_0123456789abcdefgh',
  bl_chat_id: '555123456',
};

/** fetch را با یک پاسخ از پیش تعیین‌شده جایگزین می‌کند */
function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: async () => response.json ?? { ok: true, result: true },
    };
  };
  return calls;
}

test.afterEach(() => {
  delete globalThis.fetch;
});

test('بله تنظیم‌شده فقط وقتی هر دو مقدار را دارد', () => {
  assert.equal(configured({ bl_token: '', bl_chat_id: '1' }), false);
  assert.equal(configured({ bl_token: 'x', bl_chat_id: '' }), false);
  assert.equal(configured({}), false);
  assert.equal(configured(OK), true);
});

test('پیام متنی به مسیر درست فرستاده می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await sendMessage(OK, 'سلام');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://tapi.bale.ai/bot${OK.bl_token}/sendMessage`);
  const body = calls[0].init.body;
  assert.equal(body.get('chat_id'), OK.bl_chat_id);
  assert.equal(body.get('text'), 'سلام');
});

test('فیلد مخصوص تلگرام فرستاده نمی‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await sendMessage(OK, 'سلام');

  // بله این را نمی‌شناسد و با خطای ۴۰۰ رد می‌کند
  assert.equal(calls[0].init.body.get('disable_web_page_preview'), null);
});

test('نشانی api.bale.ai هرگز به کار نمی‌رود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await sendMessage(OK, 'سلام');

  // api.bale.ai به همان آی‌پی اشاره می‌کند ولی nginx پشتش ۵۰۳ می‌دهد
  assert.ok(calls[0].url.startsWith('https://tapi.bale.ai/'));
});

test('فایل پشتیبان به‌صورت سند فرستاده می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  const data = Buffer.from('SQLite format 3');
  await sendDocument(OK, data, 'reserve-2026.db', 'پشتیبان روزانه');

  assert.equal(calls[0].url, `https://tapi.bale.ai/bot${OK.bl_token}/sendDocument`);
  const body = calls[0].init.body;
  assert.equal(body.get('caption'), 'پشتیبان روزانه');
  const file = body.get('document');
  assert.ok(file, 'فایل باید در فرم باشد');
  // نام فایل باید ASCII باشد؛ نام فارسی بله را نمی‌پذیرد
  assert.match(file.name, /^[\x20-\x7e.]+$/);
});

test('نام فارسی فایل به نام امن تبدیل می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await sendDocument(OK, Buffer.from('x'), 'پشتیبان-مهر.db', 'توضیح فارسی');

  const file = calls[0].init.body.get('document');
  assert.match(file.name, /^[\x20-\x7e.]+$/, 'نام باید ASCII بماند');
  // ولی توضیح فارسی دست‌نخورده می‌ماند
  assert.equal(calls[0].init.body.get('caption'), 'توضیح فارسی');
});

test('فایل بزرگ‌تر از سقف بله پیش از ارسال رد می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  const tooBig = { length: 50 * 1024 * 1024 + 1 };

  await assert.rejects(
    () => sendDocument(OK, tooBig, 'reserve-x.db', 'بزرگ'),
    /از سقف/,
  );
  // رد شدن باید پیش از هر درخواست شبکه باشد
  assert.equal(calls.length, 0, 'نباید چیزی فرستاده شده باشد');
});

test('توکن نادرست خطای خوانا می‌دهد، نه شکست خاموش', async () => {
  stubFetch({
    ok: false,
    status: 401,
    json: { ok: false, description: 'Unauthorized' },
  });
  await assert.rejects(() => sendMessage(OK, 'x'), /بله: Unauthorized/);
});

test('قطعی شبکه با کد علت گزارش می‌شود', async () => {
  // cause تنها جایی است که فرق timeout و DNS و TLS را می‌گوید
  globalThis.fetch = async () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
    throw err;
  };
  await assert.rejects(
    () => sendMessage(OK, 'x'),
    /ارتباط با بله برقرار نشد: UND_ERR_CONNECT_TIMEOUT/,
  );
});

test('شناسهٔ گفت‌وگو از آخرین پیام خوانده می‌شود', async () => {
  const calls = stubFetch({
    json: {
      ok: true,
      result: [
        { message: { chat: { id: 1, title: 'قدیمی' } } },
        { message: { chat: { id: -100777, title: 'بکاپ رزرو' } } },
      ],
    },
  });

  const r = await discoverChatId(OK.bl_token);
  assert.equal(r.chatId, '-100777', 'آخرین پیام باید انتخاب شود');
  assert.equal(r.title, 'بکاپ رزرو');
  assert.match(calls[0].url, /getUpdates\?limit=20$/);
});

test('پیامی به ربات نرسیده باشد، راهنمایی روشن می‌آید', async () => {
  stubFetch({ json: { ok: true, result: [] } });
  await assert.rejects(() => discoverChatId(OK.bl_token), /هنوز پیامی به ربات نفرستاده‌اید/);
});

test('بررسی توکن نام کاربری ربات را برمی‌گرداند', async () => {
  const calls = stubFetch({
    json: { ok: true, result: { username: 'reserve_backup_bot', first_name: 'Backup' } },
  });

  const r = await checkToken(OK.bl_token);
  assert.equal(r.username, 'reserve_backup_bot');
  assert.equal(r.name, 'Backup');
  assert.match(calls[0].url, /\/getMe$/);
  // درخواست خواندن است: نه POST می‌شود نه بدنه دارد
  assert.ok(!calls[0].init?.method, 'روش باید پیش‌فرض باشد');
  assert.ok(!calls[0].init?.body, 'بدنه نباید داشته باشد');
});

test('بررسی توکن بی‌توکن رد می‌شود', async () => {
  await assert.rejects(() => checkToken(''), /توکن ربات وارد نشده است/);
});

test('ارسال بدون تنظیم‌کردن، پیام روشن می‌دهد', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await assert.rejects(() => sendMessage({}, 'x'), /بله تنظیم نشده است/);
  assert.equal(calls.length, 0, 'نباید به سرویس چیزی برود');
});
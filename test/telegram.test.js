// تست ماژول تلگرام — بدون تماس واقعی با شبکه؛ fetch جعلی می‌شود
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  telegramConfigured, sendMessage, sendDocument, discoverChatId, checkToken,
} from '../src/telegram.js';

const OK = {
  tg_token: '1234567890:AAFakeTokenForTest_0123456789abcdefgh',
  tg_chat_id: '555123456',
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

test('تلگرام تنظیم‌شده فقط وقتی هر دو مقدار را دارد', () => {
  assert.equal(telegramConfigured({ tg_token: '', tg_chat_id: '1' }), false);
  assert.equal(telegramConfigured({ tg_token: 'x', tg_chat_id: '' }), false);
  assert.equal(telegramConfigured({}), false);
  assert.equal(telegramConfigured({ tg_token: 'x', tg_chat_id: '1' }), true);
});

test('پیام متنی به مسیر درست فرستاده می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  await sendMessage(OK, 'سلام');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${OK.tg_token}/sendMessage`);
  const body = calls[0].init.body;
  assert.equal(body.get('chat_id'), OK.tg_chat_id);
  assert.equal(body.get('text'), 'سلام');
});

test('فایل پشتیبان به‌صورت سند فرستاده می‌شود', async () => {
  const calls = stubFetch({ json: { ok: true } });
  const data = Buffer.from('SQLite format 3');
  await sendDocument(OK, data, 'reserve-2026.db', 'پشتیبان روزانه');

  assert.equal(calls[0].url, `https://api.telegram.org/bot${OK.tg_token}/sendDocument`);
  const body = calls[0].init.body;
  assert.equal(body.get('caption'), 'پشتیبان روزانه');
  const file = body.get('document');
  assert.ok(file, 'فایل باید در فرم باشد');
  // نام فایل باید ASCII باشد؛ نام فارسی تلگرام را نمی‌پذیرد
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

test('توکن نادرست خطای خوانا می‌دهد، نه شکست خاموش', async () => {
  stubFetch({
    ok: false,
    status: 401,
    json: { ok: false, description: 'Unauthorized' },
  });

  await assert.rejects(() => sendMessage(OK, 'x'), /تلگرام: Unauthorized/);
});

test('قطعی شبکه پیام روشن می‌دهد', async () => {
  globalThis.fetch = async () => { throw new Error('ENOTFOUND'); };
  await assert.rejects(() => sendMessage(OK, 'x'), /ارتباط با تلگرام برقرار نشد/);
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

  const r = await discoverChatId(OK.tg_token);
  assert.equal(r.chatId, '-100777', 'آخرین پیام باید انتخاب شود');
  assert.equal(r.title, 'بکاپ رزرو');
  assert.match(calls[0].url, /getUpdates\?limit=20$/);
});

test('پیامی به ربات نرسیده باشد، راهنمایی روشن می‌آید', async () => {
  stubFetch({ json: { ok: true, result: [] } });
  await assert.rejects(() => discoverChatId(OK.tg_token), /هنوز پیامی به ربات نفرستاده‌اید/);
});

test('بررسی توکن نام کاربری ربات را برمی‌گرداند', async () => {
  const calls = stubFetch({
    json: { ok: true, result: { username: 'reserve_backup_bot', first_name: 'Backup' } },
  });

  const r = await checkToken(OK.tg_token);
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
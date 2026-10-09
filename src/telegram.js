/**
 * ─────────────────────────────────────────────────────────────
 *  ارسال بکاپ به تلگرام
 *
 *  بدون هیچ وابستگی بیرونی: fetch و FormData و Blob هستند که
 *  Node ۱۸ به بعد در خودش دارد. تنها جایی که به شبکه نیاز
 *  داریم api.telegram.org است.
 *
 *  دو پیام متفاوت فرستاده می‌شود:
 *    sendMessage  — متن ساده، برای اعلام روزانه
 *    sendDocument — خود فایل پایگاه‌داده، برای داشتن کپی بیرون از سرور
 * ─────────────────────────────────────────────────────────────
 */

const API = 'https://api.telegram.org';

/** تلگرام روی پیام خطا بدن جواب می‌دهد؛ خطای واقعی از نبودن پاسخ می‌آید */
async function call(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      body,
      // بدون این، Node تا ۵ دقیقه معطل می‌ماند؛ بکاپ نباید سرویس را معطل کند
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`ارتباط با تلگرام برقرار نشد: ${err.message}`);
  }

  let data = null;
  try { data = await res.json(); } catch { /* پاسخ غیر JSON */ }

  if (!res.ok || data?.ok === false) {
    const why = data?.description ?? `کد ${res.status}`;
    throw new Error(`تلگرام: ${why}`);
  }
  return data;
}

/** فقط وقتی هر دو تنظیم پر باشند معنا دارد */
export function telegramConfigured(settings) {
  return Boolean(settings.tg_token && settings.tg_chat_id);
}

/**
 * پیام متنی ساده.
 * @param {object} settings تنظیمات برنامه
 * @param {string} text متن پیام
 */
export async function sendMessage(settings, text) {
  const { tg_token: token, tg_chat_id: chat } = settings;
  if (!telegramConfigured(settings)) throw new Error('تلگرام تنظیم نشده است.');

  const form = new FormData();
  form.append('chat_id', String(chat));
  form.append('text', text);
  form.append('disable_web_page_preview', 'true');

  return call(`${API}/bot${token}/sendMessage`, form);
}

/**
 * ارسال یک فایل به‌صورت سند. تلگرام حداکثر ۵۰ مگابایت می‌پذیرد و
 * بکاپ این برنامه چند ده کیلوبایت است، پس جای نگرانی نیست.
 * @param {object} settings تنظیمات برنامه
 * @param {Buffer|Uint8Array} data محتوای فایل
 * @param {string} filename نامی که روی گوشی دیده می‌شود
 * @param {string} caption توضیح کوتاه زیر فایل
 */
export async function sendDocument(settings, data, filename, caption) {
  const { tg_token: token, tg_chat_id: chat } = settings;
  if (!telegramConfigured(settings)) throw new Error('تلگرام تنظیم نشده است.');

  const form = new FormData();
  form.append('chat_id', String(chat));
  form.append('caption', caption);
  form.append('disable_notification', 'true');
  // نام فایل باید ASCII باشد وگرنه تلگرام آن را نمی‌پذیرد؛
  // نام واقعی در caption می‌آید.
  form.append('document', new Blob([data]), filename.replace(/[^\x20-\x7e.]/g, '_'));

  return call(`${API}/bot${token}/sendDocument`, form);
}

/**
 * گرفتن شناسهٔ یک گفت‌وگو با یک پیام تازه.
 * وقتی کاربر نمی‌داند شناسهٔ چت را، همین روش را می‌رود: یک پیام
 * به ربات می‌فرستد و پاسخ می‌آید که شناسهٔ چت در آن هست.
 * @param {string} token توکن ربات
 * @param {number} limit چند پیام آخر بررسی شود
 */
export async function discoverChatId(token, limit = 20) {
  if (!token) throw new Error('توکن ربات وارد نشده است.');

  const url = `${API}/bot${token}/getUpdates?limit=${limit}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`ارتباط با تلگرام برقرار نشد: ${err.message}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(`تلگرام: ${data?.description ?? `کد ${res.status}`}`);
  }

  const last = data.result?.[data.result.length - 1];
  if (!last?.message?.chat?.id) {
    throw new Error(
      'هنوز پیامی به ربات نفرستاده‌اید. یک پیام بفرستید و دوباره دکمهٔ «خواندن شناسه» را بزنید.'
    );
  }

  return {
    chatId: String(last.message.chat.id),
    title: last.message.chat.title ?? last.message.from?.first_name ?? '—',
  };
}

/**
 * بررسی سالم بودن توکن، بدون فرستادن چیزی به کسی.
 * @param {string} token توکن ربات
 */
export async function checkToken(token) {
  if (!token) throw new Error('توکن ربات وارد نشده است.');

  let res;
  try {
    res = await fetch(`${API}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`ارتباط با تلگرام برقرار نشد: ${err.message}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(`تلگرام: ${data?.description ?? `کد ${res.status}`}`);
  }

  return {
    username: data.result?.username ?? '—',
    name: data.result?.first_name ?? '—',
  };
}
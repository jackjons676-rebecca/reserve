/**
 * ─────────────────────────────────────────────────────────────
 *  ارسال پشتیبان به بله
 *
 *  چرا بله و نه تلگرام: سرور و کاربران این سامانه داخل ایران‌اند و
 *  نشانی تلگرام از داخل کشور فیلتر است. آزمون عملی روی همین
 *  سیستم نشان داد که curl پاسخ می‌گیرد ولی Node به آی‌پی
 *  تلگرام timeout می‌شود، چون Node از پروکسی سیستم‌عامل خبر ندارد.
 *  بله از داخل ایران بدون واسطه کار می‌کند.
 *
 *  نشانی حتماً tapi.bale.ai است، نه api.bale.ai — دومی به همان
 *  آی‌پی اشاره می‌کند ولی nginx پشتش همیشه ۵۰۳ می‌دهد.
 *
 *  بدون هیچ وابستگی بیرونی: fetch و FormData و Blob هستند که
 *  Node ۱۸ به بعد در خودش دارد.
 * ─────────────────────────────────────────────────────────────
 */

const API = 'https://tapi.bale.ai';

/** نامی که در پیام‌های خطا به کاربر نشان داده می‌شود */
const LABEL = 'بله';

/** سقف حجم هر فایل، از مستندات رسمی بله */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** بیش از این، تایم‌اوت تا جایی که بکاپ روزانه معطل نماند */
const TIMEOUT_MS = 20_000;

/** خواندن یکی از دو تنظیم بله */
function setting(settings, field) {
  return settings[`bl_${field}`] ?? '';
}

/** آیا هر دو مقدار پر است — تا هنوز چیزی فرستاده نشود */
export function configured(settings) {
  return Boolean(setting(settings, 'token') && setting(settings, 'chat_id'));
}

/**
 * یک درخواست به بله.
 *
 * بله روی پیام خطا هم پاسخ می‌دهد، پس خطای واقعی از نبودن پاسخ
 * می‌آید — همان‌جا که catch می‌شود.
 *
 * @param {string} url نشانی کامل با توکن
 * @param {FormData|null} body بدنه، یا null برای درخواست خواندن
 */
async function call(url, body) {
  let res;
  try {
    res = await fetch(url, {
      // getMe خواندن است؛ فرستادن POST برای آن غلط است
      ...(body ? { method: 'POST', body } : {}),
      // بدون این، Node تا پنج دقیقه معطل می‌ماند
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // پیام cause مهم است: «fetch failed» تنها نمی‌گوید timeout بود
    // یا DNS یا TLS. بدون آن، پیام خطا بی‌فایده است.
    const why = err.cause?.code ?? err.cause?.message ?? err.message;
    throw new Error(`ارتباط با ${LABEL} برقرار نشد: ${why}`);
  }

  let data = null;
  try { data = await res.json(); } catch { /* پاسخ غیر JSON */ }

  if (!res.ok || data?.ok === false) {
    throw new Error(`${LABEL}: ${data?.description ?? `کد ${res.status}`}`);
  }
  return data;
}

/** پیام متنی ساده */
export async function sendMessage(settings, text) {
  const token = setting(settings, 'token');
  const chatId = setting(settings, 'chat_id');
  if (!token || !chatId) throw new Error(`${LABEL} تنظیم نشده است.`);

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('text', text);
  // disable_web_page_preview که تلگرام دارد، بله نمی‌شناسد و با خطای
  // ۴۰۰ رد می‌کند؛ پس فرستاده نمی‌شود.

  return call(`${API}/bot${token}/sendMessage`, form);
}

/**
 * ارسال یک فایل به‌صورت سند.
 *
 * @param {object} settings تنظیمات برنامه
 * @param {Buffer|Uint8Array} data محتوای فایل
 * @param {string} filename نامی که روی گوشی دیده می‌شود
 * @param {string} caption توضیح کوتاه زیر فایل
 */
export async function sendDocument(settings, data, filename, caption) {
  const token = setting(settings, 'token');
  const chatId = setting(settings, 'chat_id');
  if (!token || !chatId) throw new Error(`${LABEL} تنظیم نشده است.`);

  if (data.length > MAX_FILE_BYTES) {
    throw new Error(
      `حجم فایل ${data.length.toLocaleString('fa-IR')} بایت از سقف `
      + `${MAX_FILE_BYTES.toLocaleString('fa-IR')} بایت بله بیشتر است.`,
    );
  }

  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  // نام فایل باید ASCII باشد وگرنه بله آن را نمی‌پذیرد؛
  // نام واقعی داخل caption می‌آید.
  form.append('document', new Blob([data]), filename.replace(/[^\x20-\x7e.]/g, '_'));

  return call(`${API}/bot${token}/sendDocument`, form);
}

/**
 * گرفتن شناسهٔ یک گفت‌وگو با یک پیام تازه.
 *
 * این شناسه را کاربر نمی‌تواند خودش از روی گوشی پیدا کند، پس همین
 * روش را برایش می‌رود: یک پیام به ربات می‌فرستد و پاسخ می‌آید که
 * شناسهٔ چت در آن هست.
 *
 * @param {string} token توکن ربات
 * @param {number} limit چند پیام آخر بررسی شود
 */
export async function discoverChatId(token, limit = 20) {
  if (!token) throw new Error('توکن ربات وارد نشده است.');

  const data = await call(`${API}/bot${token}/getUpdates?limit=${limit}`, null);

  const last = data.result?.[data.result.length - 1];
  if (!last?.message?.chat?.id) {
    throw new Error(
      'هنوز پیامی به ربات نفرستاده‌اید. یک پیام بفرستید و دوباره «خواندن شناسه» را بزنید.',
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

  const data = await call(`${API}/bot${token}/getMe`, null);

  return {
    username: data.result?.username ?? '—',
    name: data.result?.first_name ?? '—',
  };
}
// سرور HTTP — بدون هیچ وابستگی بیرونی
//
// اجرا:  node server.js
// رابط کاربری از پوشه public سرو می‌شود و همه مسیرهای /api پشت قفل رمز هستند.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import {
  createReadStream, existsSync, mkdirSync, copyFileSync, readdirSync, statSync,
  unlinkSync, writeFileSync, renameSync, readFileSync,
} from 'node:fs';
import { extname, join, resolve, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { openDb, allSettings, setSetting, DEFAULT_SETTINGS } from './src/db.js';
import {
  createBooking, updateBooking, setStatus, deleteBooking, getBooking,
  findConflicts, BookingError, STATUSES, STATUS_LABELS, KIND_LABELS, minutesToTime,
} from './src/bookings.js';
import {
  login, logout, currentUser, readToken, purgeExpired, isPinValid,
  isRoleValid, isNameValid, countUsers, listUsers, getUserById, createUser,
  setUserPin, setUserActive, setUserRole, deleteUser, serializeUser, ROLES, roleAtLeast,
} from './src/auth.js';
import {
  listKinds, kindLabels, createKind, renameKind, deleteKind, KindError,
} from './src/kinds.js';
import {
  utilizationReport, requesterReport, peakHoursReport, detailReport,
  dayBoard, summary, monthDates, requesterOptions, workWindow, workDays,
} from './src/reports.js';
import { buildWorkbook } from './src/xlsx.js';
import {
  jalaliFromISO, isoFromJalali, jalaliMonthDays, jalaliMonthLength,
  jalaliMonthName, todayISO, JAL_MONTHS, WEEKDAYS,
} from './src/jalali.js';
import { buildExcelReport, EXCEL_KINDS } from './src/excel-reports.js';
import {
  configured as baleConfigured, sendDocument, sendMessage, discoverChatId, checkToken,
} from './src/bale.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const DB_FILE = process.env.RESERVE_DB ?? join(DATA_DIR, 'reserve.db');
// پوشه پشتیبان همسایه خود پایگاه‌داده است تا در حالت آزمایشی قابل جداسازی بماند
const BACKUP_DIR = join(dirname(DB_FILE), 'backups');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

mkdirSync(DATA_DIR, { recursive: true });
// اتصال پایگاه‌داده پس از بازگردانی پشتیبان عوض می‌شود، پس در متغیری
// قابل‌تعویض نگه داشته می‌شود نه در یک ثابت.
let db = openDb(DB_FILE);
purgeExpired(db);

// سالن‌های اولیه تا برنامه بلافاصله قابل استفاده باشد؛
// نام و ظرفیت‌ها از صفحه تنظیمات قابل تغییر است.
const DEFAULT_HALLS = [
  ['سالن شهید اواتانی', 150],
  ['سالن وحدت', 100],
  ['سالن دانشگاه', 80],
  ['سالن انقلاب', 60],
  ['سالن آزادی', 50],
  ['سالن دانش', 40],
  ['سالن فردوسی', 30],
];

seedHallsIfEmpty();

function seedHallsIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM halls').get().n;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO halls (name, capacity, sort_order) VALUES (?, ?, ?)');
  DEFAULT_HALLS.forEach(([name, cap], i) => ins.run(name, cap, i + 1));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  // فونت‌ها — بدون این‌ها مرورگر ممکن است نوع را حدس بزند و فونت را رد کند
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('حجم درخواست بیش از حد مجاز است.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('داده ارسالی معتبر نیست.');
  }
}

/**
 * احراز هویت درخواست. کاربر جاری را برمی‌گرداند یا خطا می‌دهد.
 * نشست‌ها از کوکی یا هدر Bearer خوانده می‌شوند.
 */
function requireAuth(req) {
  const user = currentUser(db, readToken(req));
  if (!user) throw new HttpError(401, 'برای ادامه وارد شوید.');
  return user;
}

/** فقط مدیر — اگر کاربر عادی باشد پاسخ ۴۰۳ می‌گیرد. */
function requireAdmin(user) {
  if (!user.isAdmin) throw new HttpError(403, 'این بخش فقط برای مدیر است.');
  return user;
}

/** تاریخ‌های یک ماه شمسی از پارامتر جy و jm */
function datesOfMonth(url) {
  const jy = Number(url.searchParams.get('jy'));
  const jm = Number(url.searchParams.get('jm'));
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || jm < 1 || jm > 12) {
    throw new HttpError(400, 'ماه شمسی نامعتبر است.');
  }
  const dates = jalaliMonthDays(jy, jm);
  if (!dates.length) throw new HttpError(400, 'ماه شمسی نامعتبر است.');
  return { jy, jm, dates };
}

class HttpError extends Error {
  constructor(status, message, conflicts = null) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

/**
 * تبدیل سطر خام پایگاه‌داده به شکل یکدست JSON.
 * همه مسیرهای API از همین تبدیل استفاده می‌کنند تا نام فیلدها
 * بین مسیرها فرق نکند.
 */
function serializeBooking(row, labels = KIND_LABELS) {
  return {
    id: row.id,
    hallId: row.hall_id,
    hallName: row.hall_name ?? undefined,
    date: row.date,
    start: minutesToTime(row.start_min),
    end: minutesToTime(row.end_min),
    startMin: row.start_min,
    endMin: row.end_min,
    // مدت به ساعت، برای نمایش و محاسبه — نمای جزئیات به آن تکیه می‌کند.
    hours: Math.round(((row.end_min - row.start_min) / 60) * 100) / 100,
    title: row.title,
    kind: row.kind,
    kindLabel: labels[row.kind] ?? row.kind,
    requester: row.requester,
    phone: row.phone,
    attendees: row.attendees,
    notes: row.notes,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    // چه کسی این رزرو را ثبت کرد — ممکن است برای رزروهای قدیمی خالی باشد
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    createdAtLabel: jalaliLabelOf(row.created_at.slice(0, 10)),
    updatedAt: row.updated_at,
  };
}

const routes = [];
/**
 * ثبت مسیر. `auth: false` یعنی بدون ورود هم باز است،
 * `admin: true` یعنی فقط مدیر دسترسی دارد.
 */
function route(method, pattern, handler, { auth = true, admin = false } = {}) {
  routes.push({ method, pattern, handler, auth, admin });
}

// ────────────────────────────  وضعیت و ورود  ────────────────────────────

route('GET', '/api/status', (req) => {
  const user = currentUser(db, readToken(req));
  return { needsSetup: countUsers(db) === 0, authenticated: !!user };
}, { auth: false });

route('POST', '/api/setup', async (req, res) => {
  const { username, fullName, pin, confirm } = await readBody(req);
  if (countUsers(db) > 0) throw new HttpError(409, 'راه‌اندازی قبلاً انجام شده است.');
  if (String(pin) !== String(confirm)) throw new HttpError(400, 'دو رمز یکسان نیستند.');

  const { errors, user } = createUser(db, {
    // نخستین حساب، مدیر کل است؛ بقیهٔ مدیران را او می‌سازد.
    username, fullName, pin, role: 'super',
  });
  if (errors) throw new HttpError(400, errors.join('\n'));

  const session = login(db, username, pin);
  setCookie(res, session.token);
  return { ok: true, token: session.token, user };
}, { auth: false });

route('POST', '/api/login', async (req, res) => {
  const { username, pin } = await readBody(req);
  const session = login(db, username, pin);
  if (!session) throw new HttpError(401, 'نام کاربری یا رمز نادرست است.');
  setCookie(res, session.token);
  return { ok: true, token: session.token, user: session.user };
}, { auth: false });

route('POST', '/api/logout', async (req, res) => {
  const token = readToken(req);
  if (token) logout(db, token);
  res.setHeader('Set-Cookie', 'reserve_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
  return { ok: true };
});

route('GET', '/api/session', (req) => {
  const user = requireAuth(req);
  return { authenticated: true, user };
});

// ────────────────────────────  کاربران  ────────────────────────────

route('GET', '/api/users', () => ({ users: listUsers(db) }), { admin: true });

route('POST', '/api/users', async (req, res, ctx) => {
  const body = await readBody(req);
  // ساخت مدیر یا مدیر کل فقط کار مدیر کل است
  if (body.role && body.role !== 'user' && !ctx.user.isSuper) {
    throw new HttpError(403, 'ساخت مدیر فقط با مدیر کل ممکن است.');
  }
  if (body.role === 'super') {
    throw new HttpError(400, 'نقش مدیر کل فقط برای نخستین حساب راه‌اندازی است.');
  }
  const { errors, user } = createUser(db, body);
  if (errors) throw new HttpError(400, errors.join('\n'));
  return { ok: true, user };
}, { admin: true });

route('PUT', '/api/users/:id', async (req, res, ctx) => {
  const id = Number(ctx.params.id);
  const user = getUserById(db, id);
  if (!user) throw new HttpError(404, 'کاربر پیدا نشد.');
  const body = await readBody(req);

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!isNameValid(fullName)) throw new HttpError(400, 'نام کامل باید بین ۲ تا ۶۰ حرف باشد.');
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(fullName, id);
  }
  if (body.role !== undefined) {
    if (!isRoleValid(body.role)) throw new HttpError(400, 'نقش نامعتبر است.');
    // نقش مدیر و مدیر کل را فقط مدیر کل می‌تواند عوض کند
    if (roleAtLeast(user.role, ROLES.ADMIN) && !ctx.user.isSuper) {
      throw new HttpError(403, 'نقش مدیران فقط با مدیر کل قابل تغییر است.');
    }
    try {
      setUserRole(db, id, body.role);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }
  if (body.active !== undefined) {
    if (user.id === ctx.user.id && !body.active) {
      throw new HttpError(400, 'نمی‌توانید حساب خودتان را غیرفعال کنید.');
    }
    // غیرفعال کردن مدیر یا مدیر کل هم کار مدیر کل است
    if (roleAtLeast(user.role, ROLES.ADMIN) && !ctx.user.isSuper) {
      throw new HttpError(403, 'مدیران فقط با مدیر کل قابل غیرفعال‌سازی هستند.');
    }
    try {
      setUserActive(db, id, !!body.active);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }
  if (body.pin !== undefined) {
    if (String(body.pin) !== String(body.pinConfirm ?? '')) {
      throw new HttpError(400, 'دو رمز یکسان نیستند.');
    }
    setUserPin(db, id, body.pin);
  }
  return { ok: true, user: serializeUser(getUserById(db, id)) };
}, { admin: true });

route('DELETE', '/api/users/:id', (req, res, ctx) => {
  try {
    const removed = deleteUser(db, ctx.params.id, ctx.user);
    return { ok: true, username: removed.username };
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}, { admin: true });

/** تغییر رمز خودِ کاربر جاری — کاربر عادی هم می‌تواند */
route('POST', '/api/me/pin', async (req, res, ctx) => {
  const { pin, confirm } = await readBody(req);
  if (String(pin) !== String(confirm)) throw new HttpError(400, 'دو رمز یکسان نیستند.');
  try {
    setUserPin(db, ctx.user.id, pin);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  return { ok: true };
});

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `reserve_token=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Strict`);
}

// ────────────────────────────  سالن‌ها  ────────────────────────────

route('GET', '/api/halls', () => ({
  halls: db.prepare('SELECT * FROM halls ORDER BY sort_order, id').all(),
}));

route('PUT', '/api/halls', async (req) => {
  const { halls } = await readBody(req);
  if (!Array.isArray(halls)) throw new HttpError(400, 'فهرست سالن‌ها نامعتبر است.');

  const names = new Set();
  for (const h of halls) {
    const name = String(h.name ?? '').trim();
    if (!name) throw new HttpError(400, 'نام سالن نمی‌تواند خالی باشد.');
    if (name.length > 100) throw new HttpError(400, 'نام سالن خیلی طولانی است.');
    if (names.has(name)) throw new HttpError(400, `نام سالن تکراری است: ${name}`);
    names.add(name);
    const cap = Number(h.capacity ?? 0);
    if (!Number.isInteger(cap) || cap < 0) throw new HttpError(400, 'ظرفیت باید عدد صحیح مثبت باشد.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const keep = new Set();
    for (let i = 0; i < halls.length; i += 1) {
      const h = halls[i];
      const cap = Number(h.capacity ?? 0);
      const notes = String(h.notes ?? '').trim();
      const active = h.active === false ? 0 : 1;

      if (h.id && db.prepare('SELECT id FROM halls WHERE id = ?').get(h.id)) {
        db.prepare('UPDATE halls SET name=?, capacity=?, notes=?, sort_order=?, active=? WHERE id=?')
          .run(String(h.name).trim(), cap, notes, i + 1, active, h.id);
        keep.add(Number(h.id));
      } else {
        const info = db.prepare('INSERT INTO halls (name, capacity, notes, sort_order, active) VALUES (?,?,?,?,?)')
          .run(String(h.name).trim(), cap, notes, i + 1, active);
        keep.add(Number(info.lastInsertRowid));
      }
    }

    // سالن‌هایی که دیگر در فهرست نیستند حذف می‌شوند،
    // ولی فقط اگر رزرو فعال نداشته باشند
    const removed = [];
    const missing = db.prepare('SELECT id, name FROM halls').all()
      .filter((row) => !keep.has(row.id));

    for (const row of missing) {
      const used = db.prepare(
        `SELECT COUNT(*) AS n FROM bookings
          WHERE hall_id = ? AND status != '${STATUSES.CANCELLED}'`).get(row.id).n;
      if (used > 0) {
        throw new HttpError(400,
          `سالن «${row.name}» ${used} رزرو فعال دارد و قابل حذف نیست. ابتدا رزروها را لغو کنید.`);
      }
      db.prepare('DELETE FROM halls WHERE id = ?').run(row.id);
      removed.push(row.name);
    }

    db.exec('COMMIT');
    return { ok: true, removed };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* بسته شده */ }
    throw err;
  }
}, { admin: true });

// ────────────────────────────  انواع مراسم  ────────────────────────────

// هر دو نقش می‌خوانند، چون فرم رزرو برای کاربر عادی هم باید پر شود
route('GET', '/api/kinds', () => ({ kinds: listKinds(db) }));

route('PUT', '/api/kinds', async (req) => {
  const { kinds } = await readBody(req);
  if (!Array.isArray(kinds)) throw new HttpError(400, 'فهرست انواع مراسم نامعتبر است.');

  const labels = new Set();
  for (const k of kinds) {
    const label = String(k.label ?? '').trim();
    if (!label) throw new HttpError(400, 'نام نوع مراسم نمی‌تواند خالی باشد.');
    if (labels.has(label)) throw new HttpError(400, `نام نوع مراسم تکراری است: ${label}`);
    labels.add(label);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    // شناسهٔ نوع‌هایی که در فهرست آمده‌اند — بقیه حذف می‌شوند
    const keep = new Set();
    // حذف نوعی که رزرو فعال دارد، یا نوع عمومی، داخل deleteKind رد می‌شود
    for (const row of kinds) {
      const saved = row.id
        ? renameKind(db, Number(row.id), String(row.label).trim())
        : createKind(db, String(row.label).trim());
      keep.add(saved.id);
    }

    const removed = [];
    const missing = db.prepare('SELECT id FROM kinds').all()
      .filter((row) => !keep.has(row.id));
    for (const row of missing) {
      // خطای خودِ deleteKind پیام روشنی دارد؛ شکست، کل ذخیره را لغو می‌کند
      removed.push(deleteKind(db, row.id).label);
    }

    db.exec('COMMIT');
    return { ok: true, kinds: listKinds(db), removed };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* بسته شده */ }
    if (err instanceof KindError) throw new HttpError(400, err.message);
    throw err;
  }
}, { admin: true });

// ────────────────────────────  رزروها  ────────────────────────────

route('GET', '/api/bookings/today', (req, res, ctx) => {
  const date = ctx.url.searchParams.get('date') || todayISO();
  const board = dayBoard(db, date);
  return { date, ...jalaliFromISO(date), board, now: nowMinutes() };
});

route('GET', '/api/bookings/day', (req, res, ctx) => {
  const date = ctx.url.searchParams.get('date') ?? todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'تاریخ نامعتبر است.');
  return {
    date,
    ...jalaliFromISO(date),
    board: dayBoard(db, date),
    now: nowMinutes(),
  };
});

route('GET', '/api/bookings/conflicts', (req, res, ctx) => {
  const hallId = Number(ctx.url.searchParams.get('hallId'));
  const date = ctx.url.searchParams.get('date') ?? todayISO();
  const startMin = Number(ctx.url.searchParams.get('start'));
  const endMin = Number(ctx.url.searchParams.get('end'));
  const excludeId = ctx.url.searchParams.get('excludeId');

  if (!Number.isInteger(hallId) || !Number.isInteger(startMin) || !Number.isInteger(endMin)) {
    throw new HttpError(400, 'پارامترهای نامعتبر.');
  }
  return {
    conflicts: findConflicts(db, {
      hallId, date, startMin, endMin,
      excludeId: excludeId ? Number(excludeId) : null,
    }),
  };
});

route('GET', '/api/bookings', (req, res, ctx) => {
  const detail = detailReport(db, [ctx.url.searchParams.get('from'), ctx.url.searchParams.get('to')], {
    hallId: ctx.url.searchParams.get('hallId'),
    status: ctx.url.searchParams.get('status'),
    kind: ctx.url.searchParams.get('kind'),
    requester: ctx.url.searchParams.get('requester'),
  });
  return { bookings: detail };
});

route('GET', '/api/bookings/:id', (req, res, ctx) => {
  const b = getBooking(db, Number(ctx.params.id));
  if (!b) throw new HttpError(404, 'رزرو یافت نشد.');
  return serializeBooking(b, kindLabels(db));
});

route('POST', '/api/bookings', async (req, res, ctx) => {
  const body = await readBody(req);
  try {
    return serializeBooking(createBooking(db, body, ctx.user.id), kindLabels(db));
  } catch (err) {
    if (err instanceof BookingError) throw new HttpError(409, err.message, err.conflicts);
    throw err;
  }
});

route('PUT', '/api/bookings/:id', async (req, res, ctx) => {
  const body = await readBody(req);
  try {
    return serializeBooking(updateBooking(db, Number(ctx.params.id), body), kindLabels(db));
  } catch (err) {
    if (err instanceof BookingError) {
      const status = /یافت نشد/.test(err.message) ? 404 : 409;
      throw new HttpError(status, err.message, err.conflicts);
    }
    throw err;
  }
});

route('POST', '/api/bookings/:id/status', async (req, res, ctx) => {
  const { status } = await readBody(req);
  try {
    return serializeBooking(setStatus(db, Number(ctx.params.id), status), kindLabels(db));
  } catch (err) {
    if (err instanceof BookingError) throw new HttpError(400, err.message);
    throw err;
  }
});

route('DELETE', '/api/bookings/:id', (req, res, ctx) => {
  const id = Number(ctx.params.id);
  if (!getBooking(db, id)) throw new HttpError(404, 'رزرو یافت نشد.');
  deleteBooking(db, id);
  return { ok: true };
});

// ────────────────────────────  تقویم و گزارش  ────────────────────────────

route('GET', '/api/calendar', (req, res, ctx) => {
  const { jy, jm, dates } = datesOfMonth(ctx.url);
  const settings = allSettings(db);
  const win = workWindow(settings);
  const work = workDays(settings);

  const rows = db.prepare(`
    SELECT b.*, h.name AS hall_name
      FROM bookings b
      JOIN halls h ON h.id = b.hall_id
     WHERE b.date >= ? AND b.date <= ?
       AND b.status != '${STATUSES.CANCELLED}'
     ORDER BY b.start_min
  `).all(dates[0], dates[dates.length - 1]);

  const halls = db.prepare('SELECT id, name FROM halls WHERE active = 1 ORDER BY sort_order, id').all();

  return {
    jy, jm,
    monthName: JAL_MONTHS[jm - 1],
    monthLength: jalaliMonthLength(jy, jm),
    days: dates.map((iso) => {
      const j = jalaliFromISO(iso);
      const weekday = new Date(iso + 'T00:00:00Z').getUTCDay();
      return {
        date: iso,
        jd: j.jd,
        weekday,
        weekdayName: WEEKDAYS[weekday],
        isWorkDay: work.has(weekday),
        isHoliday: !work.has(weekday),
      };
    }),
    halls,
    // پیکان لازم است: map آرایهٔ دوم را هم می‌دهد و شمارهٔ اندیس
    // جای نگاشت برچسب‌ها می‌نشیند
    bookings: rows.map((r) => serializeBooking(r, kindLabels(db))),
    workWindow: win ? { start: minutesToTime(win.start), end: minutesToTime(win.end) } : null,
    // فقط نام مجتمع — بقیه تنظیمات برای مدیر است
    complexName: settings.complex_name,
  };
});

route('GET', '/api/reports/:kind', (req, res, ctx) => {
  const { kind } = ctx.params;
  const settings = allSettings(db);

  let dates;
  // اگر ماه داده شده باشد مرجع است؛ وگرنه از بازهٔ from/to خوانده می‌شود.
  // پیش از این، دو گزارش به ماه نمی‌نگریستند و همیشه ماه جاری را
  // برمی‌گرداندند، حتی وقتی کاربر ماه دیگری را انتخاب کرده بود.
  const hasMonth = ctx.url.searchParams.has('jy') && ctx.url.searchParams.has('jm');
  if (hasMonth) {
    const { dates: d } = datesOfMonth(ctx.url);
    dates = d;
  } else {
    dates = rangeFromParams(ctx.url);
  }

  switch (kind) {
    case 'utilization': {
      const rep = utilizationReport(db, dates, settings);
      return { ...rep, dates, ...monthMeta(dates) };
    }
    case 'requester':
      return { rows: requesterReport(db, dates), dates, ...monthMeta(dates) };
    case 'peak':
      return { rows: peakHoursReport(db, dates), dates, ...monthMeta(dates) };
    case 'detail':
      return {
        rows: detailReport(db, dates, {
          hallId: ctx.url.searchParams.get('hallId'),
          status: ctx.url.searchParams.get('status'),
          kind: ctx.url.searchParams.get('kind'),
          requester: ctx.url.searchParams.get('requester'),
        }),
        dates,
        ...monthMeta(dates),
        options: {
          requesters: requesterOptions(db),
          halls: db.prepare('SELECT id, name FROM halls ORDER BY sort_order, id').all(),
        },
      };
    case 'summary':
      return { summary: summary(db, dates, settings), ...monthMeta(dates) };
    default:
      throw new HttpError(404, 'گزارش نامعتبر است.');
  }
}, { admin: true });

function rangeFromParams(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(from ?? '') && iso.test(to ?? '') && from <= to) {
    const out = [];
    for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
      out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }
  // پیش‌فرض: ماه جاری
  const j = jalaliFromISO(todayISO());
  return jalaliMonthDays(j.jy, j.jm);
}

function monthMeta(dates) {
  const j = jalaliFromISO(dates[0]);
  const last = jalaliFromISO(dates[dates.length - 1]);
  return {
    fromLabel: jalaliLabelOf(dates[0]),
    toLabel: jalaliLabelOf(dates[dates.length - 1]),
    jy: j.jy,
    jm: j.jm,
    jMonth: j.jMonth,
  };
}

function jalaliLabelOf(iso) {
  const j = jalaliFromISO(iso);
  return `${j.jd} ${j.jMonth} ${j.jy}`;
}

// ────────────────────────────  خروجی اکسل  ────────────────────────────

route('GET', '/api/export/:report', (req, res, ctx) => {
  const kind = ctx.params.report.replace(/\.xlsx$/, '');
  if (!EXCEL_KINDS.includes(kind)) throw new HttpError(404, 'گزارش نامعتبر است.');

  const settings = allSettings(db);
  // مثل مسیر گزارش‌ها: اگر ماه داده شده باشد مرجع است، وگرنه بازهٔ from/to
  let dates;
  if (ctx.url.searchParams.has('jy') && ctx.url.searchParams.has('jm')) {
    dates = datesOfMonth(ctx.url).dates;
  } else {
    dates = rangeFromParams(ctx.url);
  }

  const buf = buildExcelReport(kind, db, dates, settings, {
    hallId: ctx.url.searchParams.get('hallId'),
    status: ctx.url.searchParams.get('status'),
    eventKind: ctx.url.searchParams.get('kind'),
    requester: ctx.url.searchParams.get('requester'),
  });

  const j = jalaliFromISO(dates[0]);
  const last = jalaliFromISO(dates[dates.length - 1]);
  const filename = `گزارش-${kind}-${j.jy}-${String(j.jm).padStart(2, '0')}.xlsx`;

  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition':
      `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
  return undefined;
}, { admin: true });

// ────────────────────────────  تنظیمات  ────────────────────────────

route('GET', '/api/settings', () => ({
  // توکن ربات از پاسخ بیرون می‌ماند و به‌جایش فقط «پر شده یا نه»
  // می‌رود؛ فرم تنظیمات با همان پر بودن کار می‌کند و لازم نیست
  // مدیر برای دیدن بقیهٔ تنظیمات، توکنش را هم بگیرد.
  settings: maskToken(allSettings(db)),
  defaults: DEFAULT_SETTINGS,
  kinds: listKinds(db),
  statuses: STATUS_LABELS,
}), { admin: true });

/**
 * توکن ربات یک راز است — فقط نشانهٔ پر بودنش بیرون می‌رود.
 * مدیر باید بتواند بقیهٔ تنظیمات را ببیند بدون اینکه توکنش هم لو برود.
 */
function maskToken(settings) {
  return { ...settings, bl_token: undefined, bl_token_set: Boolean(settings.bl_token) };
}

/**
 * فهرست نوع‌ها و وضعیت‌ها — فرم رزرو برای هر دو نقش به آن نیاز دارد،
 * ولی کاربر نباید تنظیمات مجتمع و ساعت کاری را ببیند یا تغییر دهد.
 */
route('GET', '/api/options', () => ({
  kinds: listKinds(db),
  statuses: STATUS_LABELS,
}));

route('PUT', '/api/settings', async (req) => {
  const body = await readBody(req);
  const allowed = Object.keys(DEFAULT_SETTINGS);

  for (const [key, value] of Object.entries(body)) {
    if (!allowed.includes(key)) continue;
    const v = String(value ?? '');

    if (key === 'work_days') {
      const days = v.split(',').map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
      if (!days.length) throw new HttpError(400, 'حداقل یک روز کاری باید انتخاب شود.');
      setSetting(db, key, [...new Set(days)].sort().join(','));
    } else if (key === 'day_start' || key === 'day_end') {
      if (!/^\d{2}:\d{2}$/.test(v)) throw new HttpError(400, 'ساعت باید به شکل ساعت:دقیقه باشد.');
      setSetting(db, key, v);
    } else {
      if (key === 'bl_token') {
        // توکن ربات قالب مشخصی دارد؛ چیز دیگری را نمی‌پذیریم تا
        // آدرس اشتباه به‌جای خطای گنگ سرویس، پیام روشن بدهد.
        if (v && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(v)) {
          throw new HttpError(400, 'توکن ربات درست نیست. قالب آن چند رقم، دونقطه و حروف است.');
        }
        setSetting(db, key, v);
      } else if (key === 'bl_chat_id') {
        // شناسهٔ چت همیشه عدد است و می‌تواند منفی باشد
        if (v && !/^-?\d+$/.test(v)) throw new HttpError(400, 'شناسهٔ گفت‌وگو باید عدد باشد.');
        setSetting(db, key, v);
      } else {
        if (v.length > 200) throw new HttpError(400, 'مقدار خیلی طولانی است.');
        setSetting(db, key, v);
      }
    }
  }

  const s = allSettings(db);
  const win = workWindow(s);
  if (!win) throw new HttpError(400, 'ساعت پایان باید بعد از ساعت شروع باشد.');

  return { ok: true, settings: maskToken(s) };
}, { admin: true });

// تغییر رمز از مسیر /api/me/pin انجام می‌شود (هم برای مدیر هم کاربر عادی).

// ────────────────────────────  پشتیبان‌گیری  ────────────────────────────

route('GET', '/api/backups', () => {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const s = statSyncSafe(join(BACKUP_DIR, f));
      return { name: f, size: s?.size ?? 0, created: s?.mtime?.toISOString() ?? null };
    })
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { backups: files, directory: BACKUP_DIR };
}, { admin: true });

function statSyncSafe(p) {
  try { return statSync(p); } catch { return null; }
}

route('POST', '/api/backups', () => {
  const name = makeBackup();
  return { ok: true, name };
}, { admin: true });

// ──────────────────  بله: آزمون، شناسه، ارسال  ──────────────────

/**
 * فرستادن یک پیام آزمایشی. برای اینکه مدیر قبل از سپردن به بکاپ روزانه
 * مطمئن شود توکن و شناسه درست‌اند — یک پیام ساده سریع‌تر از بکاپ کامل است.
 */
route('POST', '/api/messenger/test', async () => {
  const settings = allSettings(db);
  if (!baleConfigured(settings)) {
    throw new HttpError(400, 'توکن ربات و شناسهٔ گفت‌وگوی «بله» را وارد کنید.');
  }

  const j = jalaliFromISO(todayISO());
  await sendMessage(settings,
    `سامانه رزرو سالن‌ها — آزمون ارتباط\n${jalaliMonthName(j.jm)} ${j.jy}\n`
    + 'از این پس، پشتیبان روزانه همین‌جا فرستاده می‌شود.');

  return { ok: true };
}, { admin: true });

/**
 * خواندن شناسهٔ گفت‌وگو از آخرین پیامی که کاربر به ربات داده.
 * کاربر نمی‌تواند این شناسه را خودش از روی گوشی پیدا کند؛ این مسیر
 * دقیقاً همان کار را برایش می‌کند.
 */
route('POST', '/api/messenger/discover', async (req) => {
  // توکن می‌تواند در بدنه بیاید (تازه واردشده) وگرنه از تنظیمات خوانده می‌شود
  const { token } = await readBody(req);
  return discoverChatId(token || allSettings(db).bl_token);
}, { admin: true });

/** بررسی سالم بودن توکن، بدون فرستادن پیام به کسی */
route('POST', '/api/messenger/check', async (req) => {
  const { token } = await readBody(req);
  return checkToken(token || allSettings(db).bl_token);
}, { admin: true });

/**
 * ارسال یک بکاپ موجود به بله — برای فرستادن دستی همین حالا.
 */
route('POST', '/api/messenger/send-backup', async (req) => {
  const settings = allSettings(db);
  if (!baleConfigured(settings)) {
    throw new HttpError(400, 'بله تنظیم نشده است.');
  }

  const { name } = await readBody(req);
  const data = readBackupFile(name);

  const j = jalaliFromISO(todayISO());
  await sendDocument(settings, data, name,
    `پشتیبان دستی — ${jalaliMonthName(j.jm)} ${j.jy}\n`
    + `${data.length.toLocaleString('fa-IR')} بایت — ${name}`);

  return { ok: true, name };
}, { admin: true });

/**
 * خواندن یک فایل پشتیبان با نام داده‌شده از سمت کاربر.
 * نام از بیرون می‌آید، پس باید بیرون از پوشهٔ بکاپ را رد کرد؛
 * بدون این بررسی مسیرهایی مثل ../../etc/passwd خوانده می‌شدند.
 */
function readBackupFile(name) {
  const safe = String(name ?? '');
  if (!/^reserve-[\w.-]+\.db$/.test(safe) || safe.includes('..')) {
    throw new HttpError(400, 'نام فایل پشتیبان نامعتبر است.');
  }
  const path = join(BACKUP_DIR, safe);
  if (!existsSync(path)) throw new HttpError(404, 'فایل پشتیبان پیدا نشد.');
  return readFileSync(path);
}

/** کپی سازگار از پایگاه‌داده با استفاده از دستور VACUUM INTO */
function makeBackup(suffix = '') {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `reserve-${stamp}${suffix}.db`;
  const path = join(BACKUP_DIR, name);
  // VACUUM INTO اگر فایل از قبل باشد خطا می‌دهد؛ در آن حالت شماره اضافه می‌کنیم
  let n = 2;
  while (existsSync(path)) {
    const alt = `reserve-${stamp}${suffix}-${n}.db`;
    if (!existsSync(join(BACKUP_DIR, alt))) {
      db.exec(`VACUUM INTO '${join(BACKUP_DIR, alt).replace(/'/g, "''")}'`);
      return alt;
    }
    n += 1;
  }
  db.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  return name;
}

route('POST', '/api/backups/prune', () => {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const keep = 30;
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  const removed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of removed) {
    try { unlinkSync(join(BACKUP_DIR, f)); } catch { /* ادامه */ }
  }
  return { ok: true, removed: removed.length, kept: Math.min(files.length, keep) };
}, { admin: true });

// ────────────────────────────  بازگردانی پشتیبان  ────────────────────────────

/**
 * خواندن و اعتبارسنجی فایل آپلودی.
 * multipart/form-data تجزیه نمی‌شود چون برنامه هیچ وابستگی بیرونی ندارد؛
 * به‌جای آن فایل به‌صورت base64 در JSON فرستاده می‌شود.
 * (بدنه فقط یک‌بار خوانده می‌شود، پس هر دو فیلد از همان شیء خوانده می‌شوند.)
 */
function extractUpload(body) {
  const b64 = String(body.content ?? '');
  if (!b64) throw new HttpError(400, 'فایلی انتخاب نشده است.');
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    throw new HttpError(400, 'فایل خوانده نشد.');
  }
  if (buf.length < 100) throw new HttpError(400, 'فایل بسیار کوچک است و پایگاه‌داده نیست.');

  // امضای استاندارد SQLite — سریع‌ترین راه رد کردن فایل نامعتبر
  if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
    throw new HttpError(400, 'فایل انتخابی یک پایگاه‌داده SQLite معتبر نیست.');
  }
  return buf;
}

/** بررسی سلامت و وجود جدول‌های لازم در فایل آپلودی */
function verifyUploadedDb(buf) {
  const tmp = join(BACKUP_DIR, `.verify-${process.pid}-${Date.now()}.db`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  try {
    writeFileSync(tmp, buf);
    const probe = new DatabaseSync(tmp);
    try {
      const integrity = probe.prepare('PRAGMA integrity_check').get();
      const result = Object.values(integrity)[0];
      if (result !== 'ok') throw new HttpError(400, `فایل آسیب دیده است: ${result}`);

      const tables = new Set(
        probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
          .map((r) => r.name),
      );
      const required = ['halls', 'bookings', 'settings', 'users'];
      const missing = required.filter((t) => !tables.has(t));
      if (missing.length) {
        throw new HttpError(400, `این پشتیبان کامل نیست. جدول‌های غایب: ${missing.join('، ')}`);
      }

      // چند کاربر فعال باید وجود داشته باشد، وگرنه بعد از بازگردانی
      // کسی نمی‌تواند وارد شود و سامانه قفل می‌شود
      const users = probe.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
      if (users < 1) {
        throw new HttpError(400, 'این پشتیبان هیچ کاربر فعالی ندارد؛ با آن نمی‌توان وارد شد.');
      }
    } finally {
      probe.close();
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'فایل انتخابی یک پایگاه‌داده SQLite معتبر نیست.');
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(tmp + suffix); } catch { /* فایلی نبود */ }
    }
  }
}

route('POST', '/api/backups/restore', async (req) => {
  const body = await readBody(req, 200 * 1024 * 1024);
  if (body.confirm !== true) {
    throw new HttpError(400, 'برای بازگردانی باید تأیید صریح ارسال شود.');
  }

  const buf = extractUpload(body);
  verifyUploadedDb(buf);

  // پیش از جایگزینی، از وضعیت فعلی پشتیبان گرفته می‌شود تا اگر
  // اشتباهی انجام شد، راه بازگشت باشد.
  const safety = makeBackup('-before-restore');

  const tmpTarget = `${DB_FILE}.restoring`;
  writeFileSync(tmpTarget, buf);

  // اتصال باید پیش از تعویض فایل بسته شود؛ روی ویندوز فایل باز را
  // نمی‌شود جابه‌جا کرد. پس از تعویض، اتصال تازه باز می‌شود.
  try { db.close(); } catch { /* از قبل بسته */ }

  let replaced = false;
  try {
    // فایل‌های WAL و SHM متعلق به پایگاه‌داده قدیمی‌اند و باید حذف شوند،
    // وگرنه داده تازه را خراب می‌کنند.
    for (const suffix of ['-wal', '-shm']) {
      try { unlinkSync(DB_FILE + suffix); } catch { /* نبود */ }
    }
    renameSync(tmpTarget, DB_FILE);
    replaced = true;
  } catch (err) {
    try { unlinkSync(tmpTarget); } catch { /* بی‌اهمیت */ }
  }

  // اتصال تازه روی فایل جدید (یا همان فایل قبلی اگر تعویض نشد) باز می‌شود،
  // تا سرویس بدون ری‌استارت هم به کار برگردد.
  db = openDb(DB_FILE);
  if (!replaced) {
    throw new HttpError(500, 'جایگزینی فایل پایگاه‌داده انجام نشد؛ سرویس به حالت قبلی برگشت.');
  }

  return {
    ok: true,
    safetyBackup: safety,
    restartRequired: false,
  };
}, { admin: true });

route('GET', '/api/backups/:name', async (req, res, ctx) => {
  const name = String(ctx.params.name);
  if (!/^reserve-[\w.-]+\.db$/.test(name)) throw new HttpError(400, 'نام فایل نامعتبر است.');
  const file = join(BACKUP_DIR, name);
  if (!existsSync(file)) throw new HttpError(404, 'فایل پشتیبان یافت نشد.');
  const data = await readFile(file);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition':
      `attachment; filename="backup.db"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Length': data.length,
  });
  res.end(data);
  return undefined;
}, { admin: true });

// ────────────────────────────  تاریخ  ────────────────────────────

route('GET', '/api/today', () => {
  const date = todayISO();
  return { date, ...jalaliFromISO(date), workWindowMinutes: workWindow(allSettings(db)) };
});

// ────────────────────────────  موتور سرو  ────────────────────────────

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * تبدیل الگوی مسیر به عبارت باقاعده.
 * نکته: مسیرهایی مثل /api/export/detail.xlsx باید پسوند را نگه دارند،
 * پس پسوند جداگانه حذف نمی‌شود.
 */
function compilePattern(pattern) {
  const names = [];
  const source = pattern.replace(/:([A-Za-z_]+)/g, (_, name) => {
    names.push(name);
    // پارامتر نباید پسوند فایل را هم ببلعد
    return '([^/]+?)';
  });
  return { regex: new RegExp(`^${source}$`), names };
}

const compiled = routes.map((r) => ({ ...r, ...compilePattern(r.pattern) }));

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendText(res, 400, 'درخواست نامعتبر');
    return;
  }

  // مسیرهای API
  if (url.pathname.startsWith('/api/')) {
    for (const r of compiled) {
      const m = r.regex.exec(url.pathname);
      if (!m) continue;
      if (r.method !== req.method) continue;

      let user = null;
      if (r.auth) {
        try {
          user = requireAuth(req);
        } catch {
          sendJson(res, 401, { error: 'برای ادامه وارد شوید.' });
          return;
        }
        // مسیرهای مدیریتی فقط برای مدیر
        if (r.admin && !user.isAdmin) {
          sendJson(res, 403, { error: 'این بخش فقط برای مدیر است.' });
          return;
        }
      }

      const params = {};
      r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });

      try {
        const result = await r.handler(req, res, { url, params, user });
        if (result !== undefined) sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: err.message, conflicts: err.conflicts });
        } else {
          console.error('خطای پیش‌بینی‌نشده:', err);
          sendJson(res, 500, { error: 'خطای داخلی سرور.' });
        }
      }
      return;
    }
    sendJson(res, 404, { error: 'مسیر یافت نشد.' });
    return;
  }

  await serveStatic(req, res, url);
});

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  // پوشه src هم سرو می‌شود تا ماژول تاریخ شمسی در مرورگر
  // دقیقاً همان کدی باشد که سرور اجرا می‌کند — یک نسخه، دو محیط
  const inPublic = pathname.startsWith('/src/');
  // پیشوند «/src» همراه اسلش بعدش برداشته می‌شود تا مسیر نسبی بماند؛
  // اگر اسلش اول باقی بماند join آن را مطلق می‌گیرد و از پوشه src بیرون می‌زند.
  const baseDir = inPublic ? join(ROOT, 'src') : PUBLIC_DIR;
  const rel = inPublic ? pathname.slice(5) : pathname;

  // جلوگیری از خروج از پوشه مجاز
  const target = normalize(join(baseDir, rel));
  const allowedRoot = normalize(inPublic ? join(ROOT, 'src') : PUBLIC_DIR);
  if (!target.startsWith(allowedRoot)) {
    sendText(res, 403, 'دسترسی مجاز نیست');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    sendText(res, 404, 'یافت نشد');
    return;
  }

  const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    // فایل‌ها کش می‌شوند مگر اینکه توسعه در حال انجام باشد
    'Cache-Control': process.env.NODE_ENV === 'production'
      ? 'public, max-age=300'
      : 'no-cache',
  });
  createReadStream(target).pipe(res);
}

// پشتیبان‌گیری خودکار روزانه
let lastBackupDay = null;
setInterval(() => {
  const today = todayISO();
  if (lastBackupDay === today) return;
  lastBackupDay = today;
  try {
    const name = makeBackup();
    console.log('پشتیبان‌گیری خودکار:', name);
    // ارسال بیرون از مسیر پشتیبان‌گیری عمداً است: بله ممکن است
    // کند یا قطع باشد و نباید باعث شود بکاپ شمرده نشود.
    sendBackupToBale(name).catch((err) =>
      console.error('ارسال بکاپ ناموفق بود:', err.message));
  } catch (err) {
    console.error('پشتیبان‌گیری خودکار ناموفق بود:', err.message);
  }
}, 60 * 60 * 1000);
try {
  const n = makeBackup();
  lastBackupDay = todayISO();
  console.log('پشتیبان اولیه:', n);
} catch (err) {
  console.error('پشتیبان اولیه ناموفق بود:', err.message);
}

/**
 * فرستادن یک فایل پشتیبان به بله.
 * تنظیم‌نشدنش خطا نیست — یعنی مدیر هنوز خواسته روشن نکرده.
 * @param {string} name نام فایل داخل پوشهٔ backups
 */
async function sendBackupToBale(name) {
  const settings = allSettings(db);
  if (!baleConfigured(settings)) return null;

  const data = readBackupFile(name);
  const j = jalaliFromISO(todayISO());
  const caption =
    `پشتیبان خودکار — ${jalaliMonthName(j.jm)} ${j.jy}\n`
    + `${data.length.toLocaleString('fa-IR')} بایت — ${name}`;

  try {
    await sendDocument(settings, data, name, caption);
    console.log('بکاپ به بله ارسال شد:', name);
    return { ok: true, name };
  } catch (err) {
    console.error('ارسال بکاپ به بله ناموفق بود:', err.message);
    return { ok: false, name, error: err.message };
  }
}

server.listen(PORT, HOST, () => {
  console.log(`سامانه رزرو سالن روی http://${HOST}:${PORT} اجرا شد`);
  console.log(`پایگاه‌داده: ${DB_FILE}`);
  console.log(`پشتیبان‌ها:  ${BACKUP_DIR}`);
});

export { server, db, routes };

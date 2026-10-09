// پایگاه‌داده SQLite — بدون هیچ وابستگی بیرونی، با ماژول داخلی node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS halls (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      capacity   INTEGER NOT NULL DEFAULT 0,
      notes      TEXT    NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      hall_id    INTEGER NOT NULL REFERENCES halls(id),
      date       TEXT    NOT NULL,
      start_min  INTEGER NOT NULL,
      end_min    INTEGER NOT NULL,
      title      TEXT    NOT NULL,
      -- پیش‌فرض کلید است نه برچسب؛ رزروها مقدار kind را همیشه صریح می‌گذارند
      -- ولی پایگاه‌داده‌های قدیمی با پیش‌فرض 'سایر' ساخته شده بودند و
      -- fixLegacyKindValues آن‌ها را به کلید درست نگاشت می‌کند.
      kind       TEXT    NOT NULL DEFAULT 'other',
      requester  TEXT    NOT NULL,
      phone      TEXT    NOT NULL DEFAULT '',
      attendees  INTEGER,
      notes      TEXT    NOT NULL DEFAULT '',
      status     TEXT    NOT NULL DEFAULT 'reserved',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_hall_date ON bookings(hall_id, date);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    CREATE INDEX IF NOT EXISTS idx_bookings_requester ON bookings(requester);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE,
      full_name  TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user',
      pin_salt   TEXT    NOT NULL,
      pin_hash   TEXT    NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- انواع مراسم. key شناسهٔ پایداری است که در رزروها ذخیره می‌شود و
    -- label متنی است که کاربر می‌بیند؛ با ویرایش label، رزروهای
    -- قبلی دست‌نخورده می‌مانند و فقط نامشان عوض می‌شود.
    CREATE TABLE IF NOT EXISTS kinds (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT    NOT NULL UNIQUE,
      label      TEXT    NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1
    );
  `);

  addColumnIfMissing(db, 'bookings', 'created_by', 'INTEGER');
  addColumnIfMissing(db, 'sessions', 'user_id', 'INTEGER');
  addColumnIfMissing(db, 'users', 'updated_at', 'TEXT');

  createIndexIfMissing(db, 'idx_bookings_created_by', 'bookings(created_by)');

  // جدول credentials قدیمی تک‌رمزی استفاده می‌شد؛ با جدول users جایگزین شده.
  // حذف نمی‌شود تا اگر کاربری رمز قبلی را وارد کرد، خطای واضح بگیرد
  // به‌جای اینکه بی‌صدا نادیده گرفته شود.
  db.exec(`
    UPDATE bookings SET status = 'reserved'
     WHERE status IN ('handed', 'returned');
  `);

  seedKinds(db);
  fixLegacyKindValues(db);

  // پایگاه‌داده‌هایی که پیش از افزودن نقش «مدیر کل» ساخته شده‌اند مدیر کل
  // ندارند. نخستین مدیر فعال به مدیر کل ارتقا می‌یابد، وگرنه ساخت و تغییر
  // نقش مدیر که فقط با مدیر کل است، از کار می‌افتد.
  const supers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'super'").get().n;
  if (supers === 0) {
    const firstAdmin = db.prepare(`
      SELECT id FROM users
       WHERE role = 'admin' AND active = 1
       ORDER BY id LIMIT 1
    `).get();
    if (firstAdmin) db.prepare("UPDATE users SET role = 'super' WHERE id = ?").run(firstAdmin.id);
  }
}

/**
 * افزودن ستون فقط اگر هنوز وجود ندارد.
 * SQLite پر شدن ALTER TABLE ADD COLUMN را پشتیبانی نمی‌کند،
 * ولی افزودن ستون ساده را می‌کند و روی داده موجود هم امن است.
 */
function addColumnIfMissing(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function createIndexIfMissing(db, name, target) {
  db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`);
}

/**
 * انواع مراسم اولیه یک بار کاشته می‌شوند.
 * این‌ها فقط نقطهٔ شروع‌اند، نه فهرست ثابت: از این پس مدیر می‌تواند
 * در تنظیمات نوع تازه اضافه کند، نام‌ها را عوض کند یا حذف کند.
 */
function seedKinds(db) {
  const seed = db.prepare(
    'INSERT OR IGNORE INTO kinds (key, label, sort_order, active) VALUES (?, ?, ?, 1)'
  );
  DEFAULT_KINDS.forEach(([key, label], i) => seed.run(key, label, i + 1));
}

/**
 * رزروهای قدیمی مقدار 'سایر' در ستون kind دارند — برچسب فارسی، نه کلید.
 * این مقدار از DEFAULT قدیمیِ ستون آمده و در هیچ نگاشتی پیدا نمی‌شود،
 * پس رزرو بی‌برچسب نمایش داده می‌شد. به کلید درست نگاشت می‌شود.
 */
function fixLegacyKindValues(db) {
  for (const [key, label] of DEFAULT_KINDS) {
    db.prepare('UPDATE bookings SET kind = ? WHERE kind = ?').run(key, label);
  }
}

/** انواع مراسم اولیه — قالب: [کلید پایدار، برچسب فارسی] */
export const DEFAULT_KINDS = [
  ['faculty', 'دانشکده'],
  ['group', 'گروه'],
  ['congress', 'همایش'],
  ['meeting', 'جلسه'],
  ['ceremony', 'مراسم'],
  ['other', 'سایر'],
];

/** کلید نوع مراسم عمومی — رزرو بدون نوع معتبر باید به این برود */
export const FALLBACK_KIND = 'other';

/** مقادیر پیش‌فرض تنظیمات */
export const DEFAULT_SETTINGS = {
  // روزهای کاری: ۰ یکشنبه تا ۶ شنبه
  work_days: '1,2,3,4,5',
  day_start: '08:00',
  day_end: '18:00',
  complex_name: 'مجتمع سالن همایش‌های بین‌المللی استاد رضا روزبه',
};

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export function allSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    out[r.key] = r.value;
  }
  return out;
}

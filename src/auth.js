// احراز هویت با نام کاربری و PIN، و مدیریت نشست‌ها
// رمز با scrypt هش می‌شود؛ خود رمز هیچ‌جا ذخیره نمی‌شود.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // یک ماه
const SCRYPT_KEYLEN = 64;
const PIN_MIN = 4;
const PIN_MAX = 12;

export const ROLES = { SUPER: 'super', ADMIN: 'admin', USER: 'user' };

/** نقش‌ها به ترتیب قدرت — هرچه بزرگ‌تر، دسترسی بیشتر */
const RANK = { user: 0, admin: 1, super: 2 };

/** آیا نقش کاربر حداقل به سطح لازم می‌رسد؟ */
export function roleAtLeast(role, needed) {
  return (RANK[role] ?? -1) >= (RANK[needed] ?? 99);
}

/** هش کردن رمز با نمک تصادفی */
export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

/** مقایسه امن رمز با هش ذخیره‌شده */
export function verifyPin(pin, saltHex, hashHex) {
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(pin), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

export function isPinValid(pin) {
  const s = String(pin ?? '');
  return /^\d+$/.test(s) && s.length >= PIN_MIN && s.length <= PIN_MAX;
}

export function isUsernameValid(username) {
  const s = String(username ?? '').trim();
  // حروف، عدد، نقطه، خط تیره و زیرخط — بدون فاصله
  return /^[A-Za-z0-9._-]{3,32}$/.test(s);
}

export function isNameValid(fullName) {
  const s = String(fullName ?? '').trim();
  return s.length >= 2 && s.length <= 60;
}

export function isRoleValid(role) {
  return role === ROLES.SUPER || role === ROLES.ADMIN || role === ROLES.USER;
}

// ─────────────────────────────  کاربران  ─────────────────────────────

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function listUsers(db) {
  return db.prepare(`
    SELECT id, username, full_name, role, active, created_at
      FROM users ORDER BY role = 'admin' DESC, full_name COLLATE NOCASE
  `).all().map(serializeUser);
}

export function getUserById(db, id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  return row ?? null;
}

export function getUserByUsername(db, username) {
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(String(username ?? '').trim());
  return row ?? null;
}

export function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isAdmin: roleAtLeast(row.role, ROLES.ADMIN),
    isSuper: row.role === ROLES.SUPER,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

/**
 * ساخت کاربر. خطاها به‌صورت فهرست برگردانده می‌شود
 * تا فرم بتواند همه را یک‌جا نشان دهد.
 */
export function createUser(db, input) {
  const errors = [];
  const username = String(input.username ?? '').trim();
  const fullName = String(input.fullName ?? '').trim();
  const role = String(input.role ?? ROLES.USER);
  const pin = String(input.pin ?? '');

  if (!isUsernameValid(username)) {
    errors.push('نام کاربری باید ۳ تا ۳۲ حرف، عدد، نقطه، خط تیره یا زیرخط باشد.');
  }
  if (!isNameValid(fullName)) errors.push('نام کامل باید بین ۲ تا ۶۰ حرف باشد.');
  if (!isRoleValid(role)) errors.push('نقش نامعتبر است.');
  if (!isPinValid(pin)) errors.push(`رمز باید ${PIN_MIN} تا ${PIN_MAX} رقم باشد.`);
  if (errors.length) return { errors };

  if (getUserByUsername(db, username)) {
    return { errors: ['این نام کاربری قبلاً ثبت شده است.'] };
  }

  const { salt, hash } = hashPin(pin);
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO users (username, full_name, role, pin_salt, pin_hash, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(username, fullName, role, salt, hash, now, now);

  return { user: serializeUser(getUserById(db, info.lastInsertRowid)) };
}

/** تغییر رمز یک کاربر — مدیر می‌تواند رمز دیگران را عوض کند */
export function setUserPin(db, userId, pin) {
  if (!isPinValid(pin)) throw new Error(`رمز باید ${PIN_MIN} تا ${PIN_MAX} رقم باشد.`);
  const { salt, hash } = hashPin(String(pin));
  const info = db.prepare(
    'UPDATE users SET pin_salt = ?, pin_hash = ?, updated_at = ? WHERE id = ?'
  ).run(salt, hash, new Date().toISOString(), Number(userId));
  if (!info.changes) throw new Error('کاربر پیدا نشد.');
  // نشست‌های کاربر باطل می‌شود تا رمز جدید فوراً اثر کند
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
}

export function setUserRole(db, userId, role) {
  if (!isRoleValid(role)) throw new Error('نقش نامعتبر است.');
  const id = Number(userId);
  const target = getUserById(db, id);
  if (!target) throw new Error('کاربر پیدا نشد.');

  // مدیر کل نقشش عوض نمی‌شود — وگرنه کسی نمی‌ماند که مدیران را اداره کند
  if (target.role === ROLES.SUPER) {
    const others = db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'super' AND active = 1 AND id != ?"
    ).get(id).n;
    if (others === 0) throw new Error('حداقل یک مدیر کل فعال باید باقی بماند.');
  }

  const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (!info.changes) throw new Error('کاربر پیدا نشد.');
  return getUserById(db, id);
}

export function setUserActive(db, userId, active) {
  const id = Number(userId);
  const target = getUserById(db, id);
  if (!target) throw new Error('کاربر پیدا نشد.');

  // آخرین مدیر کل نباید غیرفعال شود وگرنه سامانه قفل می‌شود
  if (!active && target.role === ROLES.SUPER) {
    const others = db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'super' AND active = 1 AND id != ?"
    ).get(id).n;
    if (others === 0) throw new Error('حداقل یک مدیر کل فعال باید باقی بماند.');
  }

  const info = db.prepare('UPDATE users SET active = ? WHERE id = ?')
    .run(active ? 1 : 0, id);
  if (!info.changes) throw new Error('کاربر پیدا نشد.');
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return getUserById(db, id);
}

/**
 * حذف کاربر. خودِ کاربر قابل حذف نیست، مدیران فقط با مدیر کل
 * حذف می‌شوند، و رزروهای کاربر حذف نمی‌شوند — فقط نامشان حفظ می‌شود.
 */
export function deleteUser(db, userId, actor) {
  const id = Number(userId);
  const target = getUserById(db, id);
  if (!target) throw new Error('کاربر پیدا نشد.');

  const actorId = typeof actor === 'object' && actor !== null ? actor.id : actor;
  if (id === Number(actorId)) throw new Error('نمی‌توانید خودتان را حذف کنید.');

  // مدیران و مدیر کل فقط با اجازهٔ مدیر کل قابل حذف‌اند
  if (roleAtLeast(target.role, ROLES.ADMIN)) {
    const actorRole = typeof actor === 'object' && actor !== null ? actor.role : ROLES.USER;
    if (actorRole !== ROLES.SUPER) throw new Error('حذف مدیران فقط با مدیر کل ممکن است.');
  }

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  // created_by را NULL می‌کنیم تا رزروها و Foreign Key سالم بمانند
  db.prepare('UPDATE bookings SET created_by = NULL WHERE created_by = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return target;
}

// ─────────────────────────────  ورود و نشست  ─────────────────────────────

/** بررسی نام کاربری و رمز. در صورت درستی، توکن نشست می‌سازد. */
export function login(db, username, pin) {
  const row = getUserByUsername(db, username);
  // پیام یکسان برای کاربر ناموجود و رمز اشتباه، تا اطلاعاتی لو ندهد
  if (!row || !row.active) return null;
  if (!verifyPin(pin, row.pin_salt, row.pin_hash)) return null;

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  db.prepare(`
    INSERT INTO sessions (token, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)
  `).run(token, now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(), row.id);
  return { token, user: serializeUser(row) };
}

/** کاربر جاری را از روی توکن برمی‌گرداند. نشست‌های منقضی پاک می‌شوند. */
export function currentUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (!row.active) return null;
  return serializeUser(row);
}

export function logout(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** پاک کردن نشست‌های منقضی — هر بار راه‌اندازی سرویس صدا زده می‌شود */
export function purgeExpired(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

/** خواندن توکن از کوکی یا هدر */
export function readToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)reserve_token=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}
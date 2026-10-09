// منطق برنامه — همه نماها
//
// ماژول تاریخ شمسی از همان فایلی که سرور اجرا می‌کند وارد می‌شود
// (مسیر /src/jalali.js)، پس تقویم مرورگر و سرور هرگز اختلاف نمی‌کنند.

import {
  jalaliFromISO, isoFromJalali, jalaliMonthLength, jalaliMonthDays,
  jalaliMonthName, todayISO, jalaliLabel, JAL_MONTHS, WEEKDAYS,
} from '/src/jalali.js';

const $ = (id) => document.getElementById(id);

// ───────────────  پوسته  ───────────────

/** پوسته‌های موجود — نام فارسی و سه رنگ نمایشی هر کدام */
const THEMES = [
  { id: 'green',  name: 'سبز',     colors: ['#1f6f5c', '#e6f2ee', '#ffffff'] },
  { id: 'blue',   name: 'آبی',      colors: ['#1f5f8f', '#e3edf6', '#ffffff'] },
  { id: 'purple', name: 'بنفش',     colors: ['#6b3fa0', '#eee6f7', '#ffffff'] },
  { id: 'pink',   name: 'صورتی',    colors: ['#b03a68', '#fbe6ee', '#ffffff'] },
  { id: 'sun',    name: 'زرد و آبی', colors: ['#b8860b', '#fdf0d0', '#1a5fa8'] },
  { id: 'mono',   name: 'طوسی',     colors: ['#3d434a', '#e7e9ec', '#ffffff'] },
];

const THEME_KEY = 'reserve_theme';

/** اعمال پوسته روی سند و ذخیرهٔ انتخاب */
function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0];
  document.documentElement.setAttribute('data-theme', theme.id);
  try { localStorage.setItem(THEME_KEY, theme.id); } catch { /* حالت خصوصی */ }
  for (const btn of document.querySelectorAll('.theme-opt')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === theme.id));
  }
}

/** اعمال پوستهٔ ذخیره‌شده — پیش از نخستین رندر تا صفحه پرش نکند */
function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* حالت خصوصی */ }
  applyTheme(saved ?? 'green');
}

function buildThemeList() {
  const list = $('themeList');
  if (!list) return;
  for (const t of THEMES) {
    const btn = el('button', 'theme-opt');
    btn.type = 'button';
    btn.dataset.theme = t.id;
    btn.setAttribute('aria-pressed', 'false');

    const sw = el('span', 'theme-opt__swatch');
    for (const c of t.colors) {
      const bar = el('i');
      bar.style.background = c;
      sw.append(bar);
    }
    btn.append(sw, el('span', 'theme-opt__name', t.name));
    btn.addEventListener('click', () => {
      applyTheme(t.id);
      toast(`رنگ ${t.name} انتخاب شد`, 'ok');
    });
    list.append(btn);
  }
}

$('themeBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = $('themePop');
  pop.hidden = !pop.hidden;
  $('themeBtn').setAttribute('aria-expanded', String(!pop.hidden));
});

document.addEventListener('click', (e) => {
  const pop = $('themePop');
  if (pop.hidden) return;
  if (pop.contains(e.target)) return;
  pop.hidden = true;
  $('themeBtn').setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('themePop').hidden) {
    $('themePop').hidden = true;
    $('themeBtn').setAttribute('aria-expanded', 'false');
  }
});

restoreTheme();
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** تبدیل 'HH:MM' به دقیقه */
const toMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** جمع یک روز به تاریخ میلادی */
function shiftDate(iso, days) {
  const t = Date.parse(iso + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// ───────────────  انتخابگر تاریخ شمسی  ───────────────
//
// input[type=date] مرورگر همیشه میلادی نشان می‌دهد و قابل تغییر نیست،
// پس با سه کobox ماه/روز/سال جایگزین شده است. همه محاسبه‌ها با همان
// ماژول jalali.js انجام می‌شود که سرور هم اجرا می‌کند.

/** ساختن گزینه‌های ماه در یک انتخابگر */
function fillJMonths(sel) {
  sel.innerHTML = '';
  for (let m = 1; m <= 12; m += 1) {
    sel.append(new Option(JAL_MONTHS[m - 1], String(m)));
  }
}

/**
 * پر کردن فهرست روزهای یک ماه.
 * اسفند در سال کبیسه ۳۰ روز دارد و این را jalaliMonthLength حساب می‌کند.
 */
function fillJDays(sel, jy, jm, selected) {
  const len = jalaliMonthLength(jy, jm);
  const current = selected ?? Number(sel.value);
  sel.innerHTML = '';
  for (let d = 1; d <= len; d += 1) {
    sel.append(new Option(String(d), String(d)));
  }
  sel.value = String(Math.min(Math.max(1, current || 1), len));
}

/**
 * خواندن تاریخ شمسی از یک انتخابگر به میلادی.
 * اگر ورودی نامعتبر باشد، تاریخ امروز برگردانده می‌شود تا برنامه از کار نیفتد.
 */
function readJDate(pref) {
  const { year: yId, month: mId, day: dId, value: vId } = {
    year: pref + 'Year', month: pref + 'Month', day: pref + 'Day', value: pref + 'Value',
  };
  const jy = Number($(yId).value);
  const jm = Number($(mId).value);
  const jd = Number($(dId).value);
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return null;
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12) return null;
  const len = jalaliMonthLength(jy, jm);
  if (jd < 1 || jd > len) return null;
  return isoFromJalali(jy, jm, jd);
}

/** گذاشتن تاریخ میلادی در انتخابگر شمسی */
function setJDate(pref, iso) {
  const t = jalaliFromISO(iso);
  fillJMonths($(pref + 'Month'));
  $(pref + 'Year').value = String(t.jy);
  $(pref + 'Month').value = String(t.jm);
  fillJDays($(pref + 'Day'), t.jy, t.jm, t.jd);
  $(pref + 'Value').value = iso;
}

/**
 * وصل کردن رفتار یک انتخابگر شمسی.
 * با تغییر ماه یا سال، فهرست روزها دوباره ساخته می‌شود چون طول ماه عوض می‌شود.
 */
function wireJDate(pref, onChange) {
  const monthSel = $(pref + 'Month');
  const daySel = $(pref + 'Day');
  const yearInput = $(pref + 'Year');

  fillJMonths(monthSel);
  fillJDays(daySel, jalaliFromISO(state.date).jy, jalaliFromISO(state.date).jm);

  const rebuild = () => {
    const jy = Number(yearInput.value) || jalaliFromISO(state.date).jy;
    fillJDays(daySel, jy, Number(monthSel.value));
    emit();
  };

  const emit = () => {
    const iso = readJDate(pref);
    if (iso) {
      $(pref + 'Value').value = iso;
      onChange(iso);
    }
  };

  monthSel.addEventListener('change', rebuild);
  yearInput.addEventListener('change', rebuild);
  daySel.addEventListener('change', emit);
}

/** متن خوانای تاریخ شمسی برای نمایش */
function jDateText(iso) {
  if (!iso) return '';
  return jalaliLabel(iso);
}

// ───────────────  ارتباط با سرور  ───────────────

let token = localStorage.getItem('reserve_token') ?? null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    token = null;
    localStorage.removeItem('reserve_token');
    showGate();
    throw new Error('برای ادامه وارد شوید.');
  }

  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();

  if (!res.ok) {
    // خطای ۴xx یعنی ورودی نادرست است و پیامش داخل خود فرم نشان داده می‌شود؛
    // باز شدن پنل دیباگر برای آن گمراه‌کننده است. پنل فقط برای خرابی واقعی
    // سرور (۵xx) باز می‌شود، چون آن یکی جای دیگری به کاربر نشان داده نمی‌شود.
    if (res.status >= 500) {
      diag.http.push(`${options.method ?? 'GET'} ${path} → ${res.status} ${data?.error ?? ''}`);
      showDiag();
    }
    const err = new Error(data?.error ?? 'خطایی رخ داد.');
    err.status = res.status;
    err.conflicts = data?.conflicts;
    throw err;
  }
  return data;
}

// ───────────────  وضعیت برنامه  ───────────────

/** کلید نوع عمومی مراسم — با سرور یکی است (src/db.js) */
const FALLBACK_KIND_KEY = 'other';

const state = {
  view: 'today',
  user: null,        // کاربر جاری از /api/session
  users: [],         // فهرست کاربران (فقط مدیر می‌بیند)
  date: todayISO(),
  month: null,       // { jy, jm }
  report: 'utilization',
  reportMonth: null,
  halls: [],
  settings: null,
  kinds: [],          // انواع مراسم: [{ id, key, label }]
  statuses: {},
  requesters: [],
  current: null,     // رزرو در حال جزئیات
};

function toast(message, kind = '') {
  const t = $('toast');
  t.textContent = message;
  t.className = 'toast is-on' + (kind ? ` toast--${kind}` : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 2800);
}

// ───────────────  گزارش خطای نامرئی  ───────────────
//
// خطاهای جاوااسکریپت بی‌صدا از بین می‌روند و کاربر فقط می‌بیند که
// «دکمه کار نمی‌کند». اینجا هر خطای جاوااسکریپت و هر درخواست شکست‌خورده
// ثبت می‌شود تا بشود دید واقعاً چه اتفاقی افتاده است.

const diag = { js: [], http: [] };
window.__diag = diag;

/** پنل خطا را در صفحه نشان می‌دهد تا دلیل خرابی پنهان نماند */
function showDiag() {
  const box = $('diagBox');
  if (!box) return;
  const all = [...diag.http.map((m) => `درخواست: ${m}`), ...diag.js.map((m) => `خطا: ${m}`)];
  if (!all.length) return;
  $('diagList').innerHTML = '';
  for (const m of all.slice(-12)) $('diagList').append(el('div', 'diag__item', m));
  box.hidden = false;
}

window.addEventListener('error', (e) => {
  diag.js.push(e.message || String(e.error));
  console.error('خطای جاوااسکریپت:', e.error ?? e.message);
  showDiag();
});
window.addEventListener('unhandledrejection', (e) => {
  diag.js.push(String(e.reason?.message ?? e.reason));
  console.error('خطای اجرانشده:', e.reason);
  showDiag();
});

/** فهرست خطاهای رخ‌داده را به شکل متن برمی‌گرداند — برای عیب‌یابی */
window.__diagReport = () => ({
  js: diag.js.slice(),
  http: diag.http.slice(-20),
});

$('diagClose').addEventListener('click', () => { $('diagBox').hidden = true; });

// ───────────────  ورود  ───────────────

async function showGate() {
  $('app').classList.remove('is-ready');
  $('gate').style.display = '';
  document.body.classList.remove('modal-open');
  $('gateError').textContent = '';
}

async function boot() {
  try {
    const status = await fetch('/api/status').then((r) => r.json());
    if (status.needsSetup) return showSetup();
    if (token) {
      try {
        // نشست باید معتبر باشد و کاربر را هم برگرداند
        const s = await api('/api/session');
        state.user = s.user;
        return enterApp();
      } catch { /* نشست منقضی شده */ }
    }
    showGate();
  } catch {
    showGate();
  }
}

function showSetup() {
  $('gate').style.display = '';
  $('gateForm').hidden = true;
  $('setupForm').hidden = false;
  $('gateTitle').textContent = 'راه‌اندازی اولیه';
  $('gateSub').textContent = 'حساب مدیر را بسازید';
  $('suFullName').focus();
}

$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('userInput').value.trim();
  const pin = $('pinInput').value.trim();
  const box = $('gateError');
  box.textContent = '';
  if (!username || !pin) return;
  try {
    const r = await api('/api/login', { method: 'POST', body: { username, pin } });
    token = r.token;
    state.user = r.user;
    localStorage.setItem('reserve_token', token);
    await enterApp();
  } catch (err) {
    box.textContent = err.message;
    $('pinInput').value = '';
    $('pinInput').focus();
  }
});

$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    fullName: $('suFullName').value.trim(),
    username: $('suUsername').value.trim(),
    pin: $('newPin').value.trim(),
    confirm: $('newPin2').value.trim(),
  };
  const box = $('setupError');
  box.textContent = '';

  if (!body.fullName || !body.username) { box.textContent = 'همه فیلدها را پر کنید.'; return; }
  if (body.pin.length < 4) { box.textContent = 'رمز باید دست‌کم ۴ رقم باشد.'; return; }
  if (body.pin !== body.confirm) { box.textContent = 'دو رمز یکسان نیستند.'; return; }

  try {
    const r = await api('/api/setup', { method: 'POST', body });
    token = r.token;
    state.user = r.user;
    localStorage.setItem('reserve_token', token);
    await enterApp();
  } catch (err) {
    box.textContent = err.message;
  }
});

/**
 * تب‌های مخصوص مدیر برای کاربر عادی پنهان می‌شوند.
 * مخفی کردن به‌تنهایی امنیت نیست — سرور هم نقش را بررسی می‌کند —
 * ولی کاربر نباید دکمه‌ای ببیند که کار نمی‌کند.
 */
function applyRoleToUi() {
  const isAdmin = !!state.user?.isAdmin;
  for (const btn of document.querySelectorAll('.nav__btn--admin')) {
    btn.hidden = !isAdmin;
  }
  $('usersCard').hidden = !isAdmin;
  // کارت‌های تنظیمات سالن و ساعات فقط برای مدیر
  for (const card of document.querySelectorAll('#view-settings > .card')) {
    const id = card.id;
    if (id === 'usersCard' || id === 'pinCard') continue;
    if (card.querySelector('#hallsEditor') || card.querySelector('#kindsEditor')
        || card.querySelector('#workDays')) {
      card.hidden = !isAdmin;
    }
  }

  // فقط مدیر کل می‌تواند مدیر تازه بسازد
  const roleSel = $('nuRole');
  if (roleSel) {
    const adminOpt = roleSel.querySelector('option[value="admin"]');
    const mayPickAdmin = !!state.user?.isSuper;
    if (adminOpt) adminOpt.hidden = !mayPickAdmin;
    roleSel.value = 'user';
    const hint = $('nuRoleHint');
    if (hint) {
      hint.textContent = mayPickAdmin
        ? 'مدیر به همهٔ بخش‌ها دسترسی دارد، ولی نمی‌تواند مدیران دیگر را تغییر دهد.'
        : 'ساخت مدیر فقط با حساب مدیر کل ممکن است.';
    }
  }
}

async function enterApp() {
  buildThemeList();
  $('gate').style.display = 'none';
  $('app').classList.add('is-ready');

  // نشست، فهرست سالن‌ها و گزینه‌های فرم — برای هر دو نقش
  const [session, halls, options] = await Promise.all([
    api('/api/session'),
    api('/api/halls'),
    api('/api/options'),
  ]);

  state.user = session.user;
  state.halls = halls.halls;
  state.kinds = options.kinds;
  state.statuses = options.statuses;

  // تنظیمات کامل (نام مجتمع، ساعت کاری) فقط برای مدیر است
  if (state.user.isAdmin) {
    const settings = await api('/api/settings');
    state.settings = settings.settings;
    $('complexName').textContent = state.settings.complex_name
      || 'دانشگاه علوم پزشکی زنجان';
  } else {
    // کاربر عادی نام مجتمع را از پاسخ تقویم می‌گیرد
    const t0 = jalaliFromISO(state.date);
    const cal = await api(`/api/calendar?jy=${t0.jy}&jm=${t0.jm}`).catch(() => null);
    if (cal?.complexName) $('complexName').textContent = cal.complexName;
  }

  $('userChip').textContent = state.user.fullName;
  $('userChip').hidden = false;
  applyRoleToUi();

  const t = jalaliFromISO(state.date);
  state.month = { jy: t.jy, jm: t.jm };
  state.reportMonth = { jy: t.jy, jm: t.jm };

  setJDate('dp', state.date);
  if (state.settings) renderWorkDays();
  renderHallsEditor();
  await loadRequesters();
  await switchView('today');
}

// ───────────────  جابه‌جایی بین نماها  ───────────────

async function switchView(view) {
  // کاربر عادی نباید به نمای مدیریتی برسد، حتی اگر مستقیم صدا زده شود.
  // سرور هم جداگانه بررسی می‌کند؛ این فقط برای رابط کاربری است.
  if ((view === 'reports' || view === 'settings') && !state.user?.isAdmin) {
    view = 'today';
  }

  state.view = view;
  document.querySelectorAll('.nav__btn').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === view));
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('is-active', v.id === `view-${view}`);
  });
  window.scrollTo(0, 0);

  try {
    if (view === 'today') await loadToday();
    else if (view === 'calendar') await loadCalendar();
    else if (view === 'reports') await loadReport();
    else if (view === 'settings') await loadSettingsView();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.querySelectorAll('.nav__btn').forEach((b) => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

$('refreshBtn').addEventListener('click', async () => {
  const btn = $('refreshBtn');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  try {
    await switchView(state.view);
  } finally {
    btn.textContent = '↻';
    btn.disabled = false;
  }
});

/** خروج از حساب — نشست سرور پاک می‌شود و صفحهٔ ورود برمی‌گردد */
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* مهم نیست */ }
  token = null;
  localStorage.removeItem('reserve_token');
  showGate();
}

$('lockBtn').addEventListener('click', async () => {
  if (!confirm('از سامانه خارج می‌شوید؟')) return;
  await logout();
});

// ───────────────  نمای امروز  ───────────────

async function loadToday() {
  const data = await api(`/api/bookings/day?date=${state.date}`);
  setJDate('dp', data.date);

  const j = jalaliFromISO(data.date);
  const isToday = data.date === todayISO();
  $('todayTitle').textContent = isToday
    ? `امروز — ${j.jd} ${j.jMonth} ${j.jy}`
    : `${j.weekday} ${j.jd} ${j.jMonth} ${j.jy}`;

  // خلاصه روز
  const total = data.board.reduce((s, h) => s + h.bookings.length, 0);
  const nowMin = data.now;
  const active = data.board.reduce((s, h) => s + h.bookings.filter(
    (b) => b.startMin <= nowMin && b.endMin > nowMin).length, 0);

  const stats = $('todayStats');
  stats.innerHTML = '';
  if (total) {
    const card = el('div', 'card');
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    row.append(
      el('span', `pill ${active ? 'pill--ok' : 'pill--muted'}`, active ? `${active} سالن در حال برگزاری` : 'هیچ سالنی در حال برگزاری نیست'),
      el('span', 'pill pill--info', `${total} رزرو در این روز`),
    );
    card.append(row);
    stats.append(card);
  }

  const board = $('todayBoard');
  board.innerHTML = '';

  if (!data.board.length) {
    board.append(emptyState('سالنی ثبت نشده است', 'از صفحه تنظیمات سالن‌ها را وارد کنید.'));
    return;
  }

  for (const hall of data.board) {
    const usedMinutes = hall.bookings.reduce((s, b) => s + (b.endMin - b.startMin), 0);
    const span = 10 * 60;
    const pct = Math.min(100, Math.round((usedMinutes / span) * 100));

    const card = el('div', 'hall');

    const head = el('div', 'hall__head');
    head.append(el('span', 'hall__chev', '▼'));
    const nameWrap = el('div');
    nameWrap.style.flex = '1';
    nameWrap.append(el('div', 'hall__name', hall.name));
    if (hall.capacity) nameWrap.append(el('div', 'hall__cap', `ظرفیت ${hall.capacity} نفر`));
    head.append(nameWrap);
    head.append(el('span', `pill ${hall.bookings.length ? 'pill--info' : 'pill--muted'}`,
      hall.bookings.length ? `${hall.bookings.length} رزرو` : 'آزاد'));

    const bar = el('div', 'hall__bar');
    const fill = el('i');
    fill.style.width = `${pct}%`;
    bar.append(fill);

    const body = el('div', 'hall__body');
    if (!hall.bookings.length) {
      const none = el('div', 'empty');
      none.append(el('span', 'empty__icon', '○'));
      none.append(document.createTextNode('برای این روز رزروی ثبت نشده'));
      body.append(none);
    } else {
      for (const b of hall.bookings) {
        body.append(slotRow(b, hall.id, data.now, false));
      }
    }

    head.addEventListener('click', () => card.classList.toggle('is-open'));
    card.append(head, bar, body);
    board.append(card);
  }
}

function slotRow(b, hallId, nowMin, showHall) {
  const isNow = b.startMin <= nowMin && b.endMin > nowMin;
  const isPast = b.endMin <= nowMin;

  const row = el('div', `slot${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}`);

  const time = el('div', 'slot__time', `${b.start} – ${b.end}`);
  const info = el('div', 'slot__info');
  info.append(el('div', 'slot__title', b.title));

  const metaParts = [b.kindLabel, b.requester];
  if (b.attendees) metaParts.push(`${b.attendees} نفر`);
  info.append(el('div', 'slot__meta', metaParts.join(' · ')));

  const tags = el('div', 'slot__tags');
  tags.append(el('span', `pill ${statusPillClass(b.status)}`, b.statusLabel));
  if (showHall) tags.append(el('span', 'pill pill--muted', b.hallName));
  info.append(tags);

  const actions = el('div', 'slot__actions');
  actions.append(
    miniBtn('جزئیات', () => openDetail(b.id)),
    miniBtn('ویرایش', () => openBooking({ id: b.id })),
  );
  info.append(actions);

  row.append(time, info);
  return row;
}

function statusPillClass(status) {
  return {
    reserved: 'pill--warn',
    cancelled: 'pill--muted',
  }[status] ?? 'pill--muted';
}

function miniBtn(text, onClick, cls = 'btn--ghost') {
  const b = el('button', `btn btn--sm ${cls}`, text);
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function emptyState(title, hint) {
  const box = el('div', 'empty');
  box.append(el('span', 'empty__icon', '◷'));
  box.append(el('div', null, title));
  if (hint) box.append(el('div', 'field__hint', hint));
  return box;
}

async function setStatus(id, status) {
  try {
    await api(`/api/bookings/${id}/status`, { method: 'POST', body: { status } });
    toast('وضعیت به‌روزرسانی شد', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ناوبری روز
$('prevDay').addEventListener('click', () => { state.date = shiftDate(state.date, -1); loadToday(); });
$('nextDay').addEventListener('click', () => { state.date = shiftDate(state.date, 1); loadToday(); });
// انتخابگر تاریخ شمسی نمای «امروز»
wireJDate('dp', (iso) => { state.date = iso; loadToday(); });
$('gotoToday').addEventListener('click', () => {
  state.date = todayISO();
  setJDate('dp', state.date);
  loadToday();
});

// ───────────────  تقویم ماهانه  ───────────────

async function loadCalendar() {
  const { jy, jm } = state.month;
  const data = await api(`/api/calendar?jy=${jy}&jm=${jm}`);
  $('calTitle').textContent = `${jalaliMonthName(jm)} ${jy}`;

  const grid = $('calGrid');
  grid.innerHTML = '';

  const head = el('tr');
  head.append(el('th', 'cal-corner', 'روز'));
  for (const h of data.halls) head.append(el('th', null, h.name.replace(/^سالـ?ن\s*/, '') || h.name));
  grid.append(head);

  // رزروها بر پایه سالن و روز
  // کلید از hallId ساخته می‌شود نه hall_id: تقویم خروجی serializeBooking را
  // می‌خواند که نام فیلدش hallId است، نه نام ستون پایگاه‌داده
  const map = new Map();
  for (const b of data.bookings) {
    const key = `${b.date}|${b.hallId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }

  const todayIso = todayISO();
  for (const day of data.days) {
    const tr = el('tr');

    const th = el('th');
    const dayBox = el('div', `cal-day${day.isHoliday ? ' is-holiday' : ''}${day.date === todayIso ? ' is-today' : ''}`);
    dayBox.append(el('div', 'cal-day__num', String(day.jd)));
    const count = data.halls.reduce((s, h) => s + (map.get(`${day.date}|${h.id}`)?.length ?? 0), 0);
    if (count) {
      const dots = el('div', 'cal-day__dot');
      for (let i = 0; i < Math.min(4, count); i += 1) dots.append(el('i'));
      dayBox.append(dots);
    }
    dayBox.addEventListener('click', () => {
      state.date = day.date;
      switchView('today');
    });
    th.append(dayBox);
    tr.append(th);

    for (const h of data.halls) {
      const td = el('td');
      const cell = el('div', `cal-cell${day.isHoliday ? ' is-holiday' : ''}`);
      const list = map.get(`${day.date}|${h.id}`) ?? [];
      for (const b of list.slice(0, 2)) {
        const chip = el('div', `cal-chip cal-chip--${b.status}`, `${b.start} ${b.title}`);
        chip.addEventListener('click', (e) => { e.stopPropagation(); openDetail(b.id); });
        cell.append(chip);
      }
      if (list.length > 2) cell.append(el('div', 'cal-more', `+${list.length - 2} مورد`));
      cell.addEventListener('click', () => openBooking({ date: day.date, hallId: h.id }));
      td.append(cell);
      tr.append(td);
    }
    grid.append(tr);
  }
}

$('prevMonth').addEventListener('click', () => stepMonth(-1));
$('nextMonth').addEventListener('click', () => stepMonth(1));

function stepMonth(delta) {
  let { jy, jm } = state.month;
  jm += delta;
  if (jm < 1) { jm = 12; jy -= 1; }
  if (jm > 12) { jm = 1; jy += 1; }
  state.month = { jy, jm };
  loadCalendar();
}

// ───────────────  گزارش‌ها  ───────────────

document.querySelectorAll('#reportTabs .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#reportTabs .chip')
      .forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    state.report = chip.dataset.report;
    loadReport();
  });
});

$('prevRepMonth').addEventListener('click', () => stepRepMonth(-1));
$('nextRepMonth').addEventListener('click', () => stepRepMonth(1));

function stepRepMonth(delta) {
  let { jy, jm } = state.reportMonth;
  jm += delta;
  if (jm < 1) { jm = 12; jy -= 1; }
  if (jm > 12) { jm = 1; jy += 1; }
  state.reportMonth = { jy, jm };
  loadReport();
}

let reportFilterValues = {};

async function loadReport() {
  const kind = state.report;
  const { jy, jm } = state.reportMonth;
  const q = `jy=${jy}&jm=${jm}`;
  $('repMonthTitle').textContent = `${jalaliMonthName(jm)} ${jy}`;

  const card = $('reportCard');
  card.innerHTML = '<div class="loading">در حال بارگذاری…</div>';

  // فیلترها فقط برای گزارش ریز
  const filters = $('reportFilters');
  if (kind === 'detail') {
    if (!filters.dataset.built) buildDetailFilters();
    filters.hidden = false;
    filters.dataset.built = '1';
  } else {
    filters.hidden = true;
  }

  try {
    const extra = kind === 'detail' ? filterQuery() : '';
    const data = await api(`/api/reports/${kind}?${q}${extra}`);
    card.innerHTML = '';
    renderReport(kind, data, card);
    await loadRequesters();
  } catch (err) {
    card.innerHTML = '';
    card.append(banner(err.message, 'error'));
  }
}

function filterQuery() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(reportFilterValues)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `&${s}` : '';
}

function buildDetailFilters() {
  const box = $('reportFilters');
  box.className = 'card';
  box.innerHTML = '';

  const grid = el('div', 'filters');

  const hallSel = el('select', 'select');
  hallSel.id = 'fHall';
  grid.append(wrapField('سالن', hallSel));

  const statusSel = el('select', 'select');
  statusSel.id = 'fStatus';
  grid.append(wrapField('وضعیت', statusSel));

  const kindSel = el('select', 'select');
  kindSel.id = 'fKind';
  grid.append(wrapField('نوع', kindSel));

  const reqSel = el('select', 'select');
  reqSel.id = 'fRequester';
  grid.append(wrapField('درخواست‌دهنده', reqSel));

  box.append(grid);

  for (const sel of [hallSel, statusSel, kindSel, reqSel]) {
    sel.addEventListener('change', () => {
      reportFilterValues = {
        hallId: $('fHall')?.value ?? '',
        status: $('fStatus')?.value ?? '',
        kind: $('fKind')?.value ?? '',
        requester: $('fRequester')?.value ?? '',
      };
      loadReport();
    });
  }
}

function wrapField(label, control) {
  const f = el('div', 'field');
  f.append(el('label', 'field__label', label));
  f.append(control);
  return f;
}

function fillSelect(sel, items, placeholder, current = '') {
  sel.innerHTML = '';
  const first = el('option', null, placeholder);
  first.value = '';
  sel.append(first);
  for (const it of items) {
    const o = el('option', null, it.label);
    o.value = it.value;
    sel.append(o);
  }
  sel.value = current ?? '';
}

function renderReport(kind, data, card) {
  if (kind === 'utilization') return renderUtilization(data, card);
  if (kind === 'requester') return renderRequester(data, card);
  if (kind === 'peak') return renderPeak(data, card);
  return renderDetail(data, card);
}

function renderUtilization(data, card) {
  const head = el('div', 'card__head');
  head.append(el('h2', 'card__title', 'درصد استفاده از سالن‌ها'));
  card.append(head);

  const totalHours = data.halls.reduce((s, h) => s + h.hours, 0);
  card.append(el('div', 'field__hint',
    `مجموع ${data.halls.length} سالن · ${data.workDays} روز کاری · ${Math.round(data.capacityMinutes / 60)} ساعت ظرفیت`));

  // نحوهٔ محاسبه، دقیق — تا عدد قابل بازبینی باشد
  card.append(el('p', 'field__hint',
    'درصد هر سالن = مجموع ساعت رزروهای آن سالن ÷ ظرفیت همان سالن. '
    + `ظرفیت هم برابر است با ${data.workDays} روز کاری × ساعات کاری روز `
    + '(که در تنظیمات تعریف شده). مثلاً با ساعت کاری ۸ تا ۱۸ و '
    + `${data.workDays} روز کاری در این ماه، ظرفیت هر سالن `
    + `${Math.round(data.capacityMinutes / 60)} ساعت است. `
    + 'رزروهای لغوشده و رزروهای خارج از روز و ساعت کاری در مخرج نمی‌آیند.'));

  const wrap = el('div', 'table-scroll');
  const table = el('table', 'table');
  table.innerHTML = `<thead><tr>
    <th>سالن</th><th class="num">رزرو</th><th class="num">ساعت</th><th class="num">درصد</th>
  </tr></thead>`;
  const tb = el('tbody');

  for (const h of data.halls) {
    const tr = el('tr');
    tr.append(el('td', null, h.name));
    tr.append(el('td', 'num', String(h.bookings)));
    tr.append(el('td', 'num', String(h.hours)));

    const pctCell = el('td', 'num');
    pctCell.append(el('div', null, `${h.utilization}٪`));
    const bar = el('div', `bar${h.utilization >= 70 ? ' bar--high' : ''}`);
    const fill = el('i');
    fill.style.width = `${Math.min(100, h.utilization)}%`;
    bar.append(fill);
    pctCell.append(bar);
    tr.append(pctCell);
    tb.append(tr);
  }

  if (data.halls.length) {
    // درصد کل = کل ساعت رزرو ÷ کل ظرفیت همهٔ سالن‌ها، نه میانگین درصدها.
    // میانگین سادهٔ درصدها وقتی سالن‌ها هم‌اندازه نباشند گمراه‌کننده است.
    const totalCap = data.capacityMinutes * data.halls.length;
    const overall = totalCap ? Math.round((totalHours * 100 / totalCap) * 10) / 10 : 0;
    const tr = el('tr', 'table__total');
    tr.append(el('td', null, 'جمع کل'));
    tr.append(el('td', 'num', String(data.halls.reduce((s, h) => s + h.bookings, 0))));
    tr.append(el('td', 'num', String(Math.round(totalHours * 10) / 10)));
    tr.append(el('td', 'num', `${overall}٪`));
    tb.append(tr);
  }

  table.append(tb);
  wrap.append(table);
  card.append(wrap);
}

function renderRequester(data, card) {
  card.append(el('h2', 'card__title', 'استفاده به تفکیک درخواست‌دهنده'));

  // توضیح نحوهٔ محاسبه بالای جدول — تا کسی که عدد را می‌بیند بداند از کجا آمده
  card.append(el('p', 'field__hint',
    'ساعت = مجموع مدت همهٔ رزروهای آن درخواست‌دهنده در ماه انتخابی. '
    + 'میانگین = ساعت ÷ تعداد رزرو. رزروهای لغوشده در هیچ‌کدام حساب نمی‌شوند.'));

  if (!data.rows.length) {
    card.append(emptyState('در این ماه رزروی ثبت نشده است'));
    return;
  }

  const wrap = el('div', 'table-scroll');
  const table = el('table', 'table');
  table.innerHTML = `<thead><tr>
    <th>درخواست‌دهنده</th><th>نوع</th><th class="num">تعداد رزرو</th><th class="num">مجموع ساعت</th><th class="num">میانگین هر رزرو</th>
  </tr></thead>`;
  const tb = el('tbody');

  for (const r of data.rows) {
    const tr = el('tr');
    tr.append(el('td', null, r.requester));
    tr.append(el('td', null, r.kindLabel));
    tr.append(el('td', 'num', String(r.bookings)));
    tr.append(el('td', 'num', String(r.hours)));
    tr.append(el('td', 'num', String(r.avgHours)));
    tb.append(tr);
  }
  table.append(tb);
  wrap.append(table);
  card.append(wrap);
}

function renderPeak(data, card) {
  card.append(el('h2', 'card__title', 'ساعت‌های پرتردد'));

  if (!data.rows.length) {
    card.append(emptyState('در این ماه رزروی ثبت نشده است'));
    return;
  }

  const total = data.rows.reduce((s, r) => s + r.bookings, 0);
  const max = Math.max(...data.rows.map((r) => r.bookings));

  const wrap = el('div', 'table-scroll');
  const table = el('table', 'table');
  table.innerHTML = `<thead><tr><th>بازه</th><th class="num">تعداد</th><th class="num">سهم</th></tr></thead>`;
  const tb = el('tbody');

  for (const r of data.rows) {
    const tr = el('tr');
    tr.append(el('td', null, `${r.start} تا ${r.end}`));
    tr.append(el('td', 'num', String(r.bookings)));
    const pctCell = el('td', 'num', `${Math.round((r.bookings / total) * 100)}٪`);
    tr.append(pctCell);
    const barCell = el('td');
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.round((r.bookings / max) * 100)}%`;
    bar.append(fill);
    barCell.append(bar);
    tr.append(barCell);
    tb.append(tr);
  }
  table.append(tb);
  wrap.append(table);
  card.append(wrap);
}

function renderDetail(data, card) {
  // پر کردن فیلترها با حفظ مقدار انتخاب‌شده
  if ($('fHall')) {
    fillSelect($('fHall'),
      data.options.halls.map((h) => ({ value: h.id, label: h.name })),
      'همه سالن‌ها', reportFilterValues.hallId ?? '');
  }
  if ($('fStatus')) {
    fillSelect($('fStatus'),
      Object.entries(state.statuses).map(([value, label]) => ({ value, label })),
      'همه وضعیت‌ها', reportFilterValues.status ?? '');
  }
  if ($('fKind')) {
    fillSelect($('fKind'),
      state.kinds.map((k) => ({ value: k.key, label: k.label })),
      'همه انواع', reportFilterValues.kind ?? '');
  }
  if ($('fRequester')) {
    fillSelect($('fRequester'),
      data.options.requesters.map((r) => ({ value: r, label: r })),
      'همه درخواست‌دهندگان', reportFilterValues.requester ?? '');
  }

  const hours = data.rows.reduce((s, r) => s + r.hours, 0);
  card.append(el('h2', 'card__title', 'ریز رزروها'));
  card.append(el('div', 'field__hint',
    `${data.rows.length} رزرو · مجموع ${Math.round(hours * 10) / 10} ساعت`));

  if (!data.rows.length) {
    card.append(emptyState('رزروی با این فیلترها یافت نشد'));
    return;
  }

  const wrap = el('div', 'table-scroll');
  const table = el('table', 'table');
  table.innerHTML = `<thead><tr>
    <th>تاریخ</th><th>سالن</th><th>ساعت</th><th>مراسم</th><th>درخواست‌دهنده</th><th>وضعیت</th>
  </tr></thead>`;
  const tb = el('tbody');

  for (const r of data.rows) {
    const tr = el('tr');
    tr.append(el('td', null, r.dateLabel));
    tr.append(el('td', null, r.hallName));
    tr.append(el('td', null, `${r.start}–${r.end}`));
    tr.append(el('td', null, r.title));
    tr.append(el('td', null, r.requester));
    const st = el('td');
    st.append(el('span', `pill ${statusPillClass(r.status)}`, r.statusLabel));
    tr.append(st);
    tr.addEventListener('click', () => openDetail(r.id));
    tb.append(tr);
  }
  table.append(tb);
  wrap.append(table);
  card.append(wrap);
}

// خروجی اکسل و چاپ
$('excelBtn').addEventListener('click', () => {
  const { jy, jm } = state.reportMonth;
  const q = `jy=${jy}&jm=${jm}${state.report === 'detail' ? filterQuery() : ''}`;
  const map = { utilization: 'utilization', requester: 'requester', peak: 'peak', detail: 'detail' };
  window.location.href = `/api/export/${map[state.report]}.xlsx?${q}`;
});

$('printBtn').addEventListener('click', () => window.print());

// ───────────────  فرم رزرو  ───────────────

$('newBookingTop').addEventListener('click', () => openBooking({ date: state.date }));

/**
 * ساعت پایان باید جلوتر از ساعت شروع بیفتد. اگر کاربر ساعت شروع را
 * جلوتر ببرد و پایان عقب بماند، فرم نامعتبر می‌شود و سرور خطای ۴۰۹
 * می‌دهد؛ به‌جای راندن کاربر به پیام خطا، پایان خودکار یک ساعت بعد
 * از شروع می‌نشیند.
 */
function syncEndTime() {
  const s = $('bkStart').value;
  const e = $('bkEnd').value;
  if (!s || !e) return;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if (toMin(e) > toMin(s)) return;
  // اگر شروع ۲۳:۳۰ است، پایان همان روز ممکن نیست؛ ۲۳:۵۹ می‌شود
  const next = Math.min(23 * 60 + 59, toMin(s) + 60);
  $('bkEnd').value =
    `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

// روی change نه input، تا با عوض کردن بخش ساعت یا دقیقه پایان بی‌جهت نپرد
$('bkStart').addEventListener('change', syncEndTime);

function openBooking({ id = null, date = null, hallId = null } = {}) {
  const form = $('bookingForm');
  form.reset();
  $('bookingErrors').innerHTML = '';
  $('bkId').value = id ?? '';

  const hallSel = $('bkHall');
  hallSel.innerHTML = '';
  for (const h of state.halls.filter((x) => x.active)) {
    const o = el('option', null, h.name + (h.capacity ? ` (ظرفیت ${h.capacity})` : ''));
    o.value = h.id;
    hallSel.append(o);
  }

  // انواع مراسم از تنظیمات می‌آیند و قابل تغییرند، پس گزینه‌ها هر بار
  // از نو ساخته می‌شوند — وگرنه نوع تازهٔ مدیر هرگز در فرم دیده نمی‌شود
  const kindSel = $('bkKind');
  kindSel.innerHTML = '';
  for (const k of state.kinds) {
    const o = el('option', null, k.label);
    o.value = k.key;
    kindSel.append(o);
  }
  if (!state.kinds.some((k) => k.key === FALLBACK_KIND_KEY)) {
    const o = el('option', null, 'سایر');
    o.value = FALLBACK_KIND_KEY;
    kindSel.append(o);
  }

  const targetDate = date ?? state.date;
  setJDate('bk', targetDate);
  $('bkStart').value = '09:00';
  $('bkEnd').value = '10:00';

  $('bookingTitle').textContent = id ? 'ویرایش رزرو' : 'ثبت رزرو جدید';
  $('bookingSave').textContent = id ? 'ذخیره تغییرات' : 'ثبت رزرو';

  if (hallId) hallSel.value = hallId;

  updateDateHint();
  openModal('bookingModal');

  if (id) loadBookingIntoForm(id);
  peekDay(hallSel.value, targetDate);
}

async function loadBookingIntoForm(id) {
  try {
    const b = await api(`/api/bookings/${id}`);
    $('bkHall').value = b.hallId;
    setJDate('bk', b.date);
    $('bkStart').value = b.start;
    $('bkEnd').value = b.end;
    $('bkTitle').value = b.title;
    $('bkKind').value = b.kind;
    $('bkRequester').value = b.requester;
    $('bkPhone').value = b.phone ?? '';
    $('bkAttendees').value = b.attendees ?? '';
    $('bkNotes').value = b.notes ?? '';
    updateDateHint();
    peekDay(b.hallId, b.date);
  } catch (err) {
    toast(err.message, 'error');
    closeModal('bookingModal');
  }
}

function updateDateHint() {
  const v = $('bkValue').value;
  $('bkDateHint').textContent = v ? jalaliLabel(v) : '';
}

// انتخابگر شمسی فرم رزرو
wireJDate('bk', () => {
  updateDateHint();
  peekDay($('bkHall').value, $('bkValue').value);
});

/** نمایش رزروهای همان روز و سالن، زیر فرم — برای دیدن تداخل پیش از ثبت */
async function peekDay(hallId, date) {
  const box = $('dayPeek');
  if (!hallId || !date) { box.innerHTML = ''; return; }
  try {
    const data = await api(`/api/bookings/day?date=${date}`);
    const hall = data.board.find((h) => String(h.id) === String(hallId));
    if (!hall || !hall.bookings.length) { box.innerHTML = ''; return; }

    box.innerHTML = '';
    const card = el('div', 'card');
    card.style.marginTop = '14px';
    card.append(el('div', 'card__title', `رزروهای این سالن در ${jalaliLabel(date)}`));

    const list = el('div');
    for (const b of hall.bookings) {
      const item = el('div', 'slot', '');
      item.style.padding = '10px 0';
      item.style.borderBottom = '1px solid var(--line)';
      item.append(el('div', 'slot__time', `${b.start}–${b.end}`));
      const info = el('div', 'slot__info');
      info.append(el('div', 'slot__title', b.title));
      info.append(el('div', 'slot__meta', b.requester));
      item.append(info);
      list.append(item);
    }
    card.append(list);
    box.append(card);
  } catch { /* بی‌اهمیت */ }
}

$('bkHall').addEventListener('change', () => peekDay($('bkHall').value, $('bkValue').value));

$('bookingSave').addEventListener('click', async () => {
  const btn = $('bookingSave');
  const id = $('bkId').value;

  const payload = {
    hallId: Number($('bkHall').value),
    date: $('bkValue').value,
    startTime: $('bkStart').value,
    endTime: $('bkEnd').value,
    title: $('bkTitle').value.trim(),
    kind: $('bkKind').value,
    requester: $('bkRequester').value.trim(),
    phone: $('bkPhone').value.trim(),
    attendees: $('bkAttendees').value === '' ? '' : Number($('bkAttendees').value),
    notes: $('bkNotes').value.trim(),
  };

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  $('bookingErrors').innerHTML = '';

  try {
    if (id) {
      await api(`/api/bookings/${id}`, { method: 'PUT', body: payload });
      toast('رزرو به‌روزرسانی شد', 'ok');
    } else {
      await api('/api/bookings', { method: 'POST', body: payload });
      toast('رزرو ثبت شد', 'ok');
    }
    closeModal('bookingModal');
    state.date = payload.date;
    await loadRequesters();
    if (state.view === 'today') await loadToday();
    else await switchView(state.view);
  } catch (err) {
    $('bookingErrors').innerHTML = '';
    $('bookingErrors').append(banner(err.message, 'error'));
    if (err.conflicts?.length) {
      const box = el('div', 'conflict-box');
      box.append(el('div', 'conflict-box__title', 'این بازه اشغال است:'));
      for (const c of err.conflicts) {
        const time = `${String(Math.floor(c.start_min / 60)).padStart(2, '0')}:${String(c.start_min % 60).padStart(2, '0')}`;
        box.append(el('div', 'conflict-box__item', `${time} — ${c.title} (${c.requester})`));
      }
      $('bookingErrors').append(box);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'ذخیره تغییرات' : 'ثبت رزرو';
  }
});

// ───────────────  جزئیات رزرو  ───────────────

async function openDetail(id) {
  try {
    const b = await api(`/api/bookings/${id}`);
    state.current = b;

    $('detailTitle').textContent = b.title;
    const body = $('detailBody');
    body.innerHTML = '';

    const list = el('div', 'detail-list');
    const rows = [
      ['تاریخ', jalaliLabel(b.date)],
      ['روز هفته', WEEKDAYS[new Date(b.date + 'T00:00:00Z').getUTCDay()] ?? '—'],
      ['سالن', b.hallName],
      ['ساعت', `${b.start} تا ${b.end}`],
      ['مدت', `${b.hours} ساعت`],
      ['نوع', b.kindLabel],
      ['درخواست‌دهنده', b.requester],
      ['تلفن', b.phone || '—'],
      ['تعداد حاضران', b.attendees ?? '—'],
      ['وضعیت', b.statusLabel],
      // نام ثبت‌کننده — برای رزروهای قدیمی ممکن است خالی باشد
      ['ثبت‌کننده', b.createdByName || '—'],
      ['ثبت در', b.createdAtLabel ? `${b.createdAtLabel} — ساعت ${String(b.createdAt).slice(11, 16)}` : '—'],
      ['توضیحات', b.notes || '—'],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'detail-row');
      r.append(el('div', 'detail-row__key', k));
      r.append(el('div', 'detail-row__val', String(v)));
      list.append(r);
    }
    body.append(list);

    // فقط یک اقدام وضعیتی مانده: لغو
    const next = $('detailNext');
    if (b.status === 'reserved') {
      next.textContent = 'لغو رزرو';
      next.disabled = false;
      next.className = 'btn btn--ghost btn--block';
      next.onclick = async () => { await setStatus(b.id, 'cancelled'); closeModal('detailModal'); refreshCurrent(); };
    } else {
      next.textContent = 'این رزرو لغو شده است';
      next.disabled = true;
      next.onclick = null;
    }

    $('detailEdit').onclick = () => { closeModal('detailModal'); openBooking({ id: b.id }); };

    openModal('detailModal');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function refreshCurrent() {
  if (state.view === 'today') loadToday();
  else if (state.view === 'calendar') loadCalendar();
  else loadReport();
}

// ───────────────  تنظیمات  ───────────────

async function loadSettingsView() {
  if (!state.user?.isAdmin) return;

  const [halls, settings, backups, users] = await Promise.all([
    api('/api/halls'),
    api('/api/settings'),
    api('/api/backups'),
    api('/api/users'),
  ]);
  state.halls = halls.halls;
  state.settings = settings.settings;
  state.kinds = settings.kinds;
  state.statuses = settings.statuses;
  state.users = users.users;

  renderHallsEditor();
  renderKindsEditor();
  renderWorkDays();
  renderUsers();
  $('dayStart').value = state.settings.day_start;
  $('dayEnd').value = state.settings.day_end;
  $('complexNameInput').value = state.settings.complex_name ?? '';
  renderMessengerState();
  renderBackups(backups);
}

// ───────────────  مدیریت کاربران  ───────────────

function renderUsers() {
  const box = $('usersEditor');
  box.innerHTML = '';

  for (const u of state.users ?? []) {
    const row = el('div', `user-row${u.active ? '' : ' is-inactive'}`);

    const left = el('div');
    left.append(el('div', 'user-row__name', u.fullName));
    left.append(el('div', 'user-row__meta', u.username));
    row.append(left);

    row.append(el('span', `user-row__spacer`));

    const roleLabel = u.isSuper ? 'مدیر کل' : (u.isAdmin ? 'مدیر' : 'کاربر');
    const roleCls = u.isSuper ? 'badge-super' : (u.isAdmin ? 'badge-admin' : 'badge-user');
    row.append(el('span', roleCls, roleLabel));

    // مدیر کل تنها کسی است که نقش مدیرها را عوض می‌کند؛ بقیه این کنترل را نمی‌بینند
    const mayManageRoles = state.user.isSuper && !u.isSuper;
    if (mayManageRoles) {
      const sel = el('select', 'user-row__sel');
      for (const [val, label] of [['user', 'کاربر'], ['admin', 'مدیر']]) {
        const o = el('option', null, label);
        o.value = val;
        sel.append(o);
      }
      sel.value = u.role;
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/users/${u.id}`, { method: 'PUT', body: { role: sel.value } });
          toast('نقش کاربر تغییر کرد.', 'ok');
          state.users = (await api('/api/users')).users;
          renderUsers();
        } catch (err) {
          toast(err.message, 'error');
          sel.value = u.role;
        }
      });
      row.append(sel);
    }

    // فعال/غیرفعال — مدیران فقط با مدیر کل
    const toggle = el('button', 'btn btn--ghost', u.active ? 'غیرفعال' : 'فعال');
    toggle.type = 'button';
    toggle.style.minHeight = '36px';
    toggle.style.fontSize = '12.5px';
    const mayToggle = !u.isSuper && (u.isAdmin ? state.user.isSuper : true);
    toggle.disabled = !mayToggle;
    if (!mayToggle) toggle.title = 'تغییر مدیران فقط با مدیر کل ممکن است';
    toggle.addEventListener('click', async () => {
      try {
        await api(`/api/users/${u.id}`, { method: 'PUT', body: { active: !u.active } });
        toast(u.active ? 'کاربر غیرفعال شد.' : 'کاربر فعال شد.', 'ok');
        state.users = (await api('/api/users')).users;
        renderUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    row.append(toggle);

    // حذف — برای خود کاربر فعال و تنها مدیر غیرفعال است
    const remove = el('button', 'btn btn--danger', 'حذف');
    remove.type = 'button';
    remove.style.minHeight = '36px';
    remove.style.fontSize = '12.5px';
    const mayRemove = u.isSuper ? false : (u.isAdmin ? state.user.isSuper : true);
    remove.disabled = u.id === state.user.id || !mayRemove;
    if (u.id === state.user.id) remove.title = 'نمی‌توانید خودتان را حذف کنید';
    else if (!mayRemove) remove.title = 'حذف مدیران فقط با مدیر کل ممکن است';
    remove.addEventListener('click', async () => {
      if (!confirm(`کاربر «${u.fullName}» حذف شود؟\nرزروهای او حذف نمی‌شوند.`)) return;
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        toast('کاربر حذف شد.', 'ok');
        state.users = (await api('/api/users')).users;
        renderUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    row.append(remove);

    box.append(row);
  }
}

$('addUser').addEventListener('click', async () => {
  const box = $('nuError');
  box.textContent = '';
  const body = {
    fullName: $('nuFullName').value.trim(),
    username: $('nuUsername').value.trim(),
    role: $('nuRole').value,
    pin: $('nuPin').value.trim(),
  };
  try {
    await api('/api/users', { method: 'POST', body });
    $('nuFullName').value = '';
    $('nuUsername').value = '';
    $('nuPin').value = '';
    state.users = (await api('/api/users')).users;
    renderUsers();
    toast('کاربر افزوده شد.', 'ok');
  } catch (err) {
    box.textContent = err.message;
  }
});

function renderWorkDays() {
  const box = $('workDays');
  box.innerHTML = '';
  const current = String(state.settings?.work_days ?? '1,2,3,4,5')
    .split(',').map((s) => Number(s.trim()));

  // از شنبه شروع می‌کنیم چون هفته کاری ایران از شنبه است
  const order = [6, 0, 1, 2, 3, 4, 5];
  for (const d of order) {
    const b = el('button', 'chip', WEEKDAYS[d].replace('شنبه', 'ش').replace('یکشنبه', 'ی'));
    b.type = 'button';
    b.dataset.day = String(d);
    b.setAttribute('aria-pressed', String(current.includes(d)));
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', String(!on));
    });
    box.append(b);
  }
}

function renderHallsEditor() {
  const box = $('hallsEditor');
  box.innerHTML = '';
  state.halls.forEach((h, i) => {
    const wrap = el('div', 'hall-edit');

    const head = el('div', 'hall-edit__head');
    head.append(el('div', 'hall-edit__num', String(i + 1)));

    const nameIn = el('input', 'input');
    nameIn.value = h.name;
    nameIn.placeholder = 'نام سالن';
    nameIn.dataset.field = 'name';

    const capIn = el('input', 'input');
    capIn.type = 'number';
    capIn.min = '0';
    capIn.value = String(h.capacity ?? 0);
    capIn.placeholder = 'ظرفیت';
    capIn.style.maxWidth = '96px';
    capIn.dataset.field = 'capacity';

    const delBtn = el('button', 'btn btn--sm btn--danger', 'حذف');
    delBtn.type = 'button';
    delBtn.style.flexShrink = '0';
    delBtn.addEventListener('click', () => {
      h._removed = true;
      wrap.remove();
    });

    head.append(nameIn, capIn, delBtn);

    const notesIn = el('input', 'input');
    notesIn.value = h.notes ?? '';
    notesIn.placeholder = 'توضیح کوتاه (اختیاری)';
    notesIn.dataset.field = 'notes';

    wrap.append(head, notesIn);
    wrap.dataset.id = h.id ?? '';
    box.append(wrap);
  });
}

$('addHall').addEventListener('click', () => {
  state.halls.push({ name: '', capacity: 0, notes: '', active: 1 });
  renderHallsEditor();
});

$('saveHalls').addEventListener('click', async () => {
  const nodes = [...$('hallsEditor').children];
  const payload = [];

  for (const node of nodes) {
    if (node.dataset.removed === '1') continue;
    const id = node.dataset.id ? Number(node.dataset.id) : null;
    // ورودی‌ها با data-field مشخص شده‌اند تا به متن راهنما وابسته نباشند
    const nameIn = node.querySelector('[data-field="name"]');
    const capIn = node.querySelector('[data-field="capacity"]');
    const notesIn = node.querySelector('[data-field="notes"]');
    if (!nameIn || !capIn || !notesIn) continue;
    payload.push({
      id,
      name: nameIn.value.trim(),
      capacity: Number(capIn.value || 0),
      notes: notesIn.value.trim(),
      active: 1,
    });
  }

  try {
    const r = await api('/api/halls', { method: 'PUT', body: { halls: payload } });
    if (r.removed?.length) toast(`${r.removed.length} سالن حذف شد`, 'ok');
    else toast('سالن‌ها ذخیره شد', 'ok');
    const halls = await api('/api/halls');
    state.halls = halls.halls;
    renderHallsEditor();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ───────────────  ویرایشگر انواع مراسم  ───────────────

function renderKindsEditor() {
  const box = $('kindsEditor');
  box.innerHTML = '';
  state.kinds.forEach((k, i) => {
    const wrap = el('div', 'hall-edit');

    const head = el('div', 'hall-edit__head');
    head.append(el('div', 'hall-edit__num', String(i + 1)));

    const labelIn = el('input', 'input');
    labelIn.value = k.label ?? '';
    labelIn.placeholder = 'نام نوع مراسم';
    labelIn.dataset.field = 'label';
    head.append(labelIn);

    // نوع عمومی با رزروهای بی‌نوع به آن می‌رود، پس حذفش نباید ممکن باشد
    if (k.key !== FALLBACK_KIND_KEY) {
      const delBtn = el('button', 'btn btn--sm btn--danger', 'حذف');
      delBtn.type = 'button';
      delBtn.style.flexShrink = '0';
      delBtn.addEventListener('click', () => {
        k._removed = true;
        wrap.remove();
      });
      head.append(delBtn);
    } else {
      const tag = el('span', 'badge-super', 'پیش‌فرض');
      tag.style.flexShrink = '0';
      head.append(tag);
    }

    wrap.append(head);
    wrap.dataset.id = k.id ?? '';
    box.append(wrap);
  });
}

$('addKind').addEventListener('click', () => {
  state.kinds.push({ key: '', label: '' });
  renderKindsEditor();
});

$('saveKinds').addEventListener('click', async () => {
  const nodes = [...$('kindsEditor').children];
  const payload = [];

  for (const node of nodes) {
    if (node.dataset.removed === '1') continue;
    const labelIn = node.querySelector('[data-field="label"]');
    if (!labelIn) continue;
    const label = labelIn.value.trim();
    if (!label) continue;
    payload.push({
      id: node.dataset.id ? Number(node.dataset.id) : null,
      label,
    });
  }

  try {
    const r = await api('/api/kinds', { method: 'PUT', body: { kinds: payload } });
    if (r.removed?.length) toast(`${r.removed.length} نوع حذف شد`, 'ok');
    else toast('انواع مراسم ذخیره شد', 'ok');
    state.kinds = (await api('/api/kinds')).kinds;
    renderKindsEditor();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('saveWork').addEventListener('click', async () => {
  const days = [...$('workDays').querySelectorAll('[aria-pressed="true"]')]
    .map((b) => Number(b.dataset.day));

  try {
    // نام مجتمع همین‌جا ذخیره می‌شود و بلافاصله بالای صفحه می‌نشیند؛
    // وگرنه تا بارگذاری بعدی، متن قدیمی می‌ماند.
    const complexName = $('complexNameInput').value.trim();
    if (!complexName) { toast('نام مجتمع نمی‌تواند خالی باشد.', 'error'); return; }

    await api('/api/settings', {
      method: 'PUT',
      body: {
        work_days: days.join(','),
        day_start: $('dayStart').value,
        day_end: $('dayEnd').value,
        complex_name: complexName,
      },
    });
    toast('تنظیمات ذخیره شد', 'ok');
    const s = await api('/api/settings');
    state.settings = s.settings;
    $('complexName').textContent = s.settings.complex_name;
    renderMessengerState();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('savePin').addEventListener('click', async () => {
  const pin = $('pinA').value.trim();
  const confirmPin = $('pinB').value.trim();
  if (pin.length < 4) { toast('رمز باید دست‌کم ۴ رقم باشد.', 'error'); return; }
  if (pin !== confirmPin) { toast('دو رمز یکسان نیستند.', 'error'); return; }
  try {
    await api('/api/me/pin', { method: 'POST', body: { pin, confirm: confirmPin } });
    $('pinA').value = ''; $('pinB').value = '';
    toast('رمز عبور تغییر کرد', 'ok');
    toast('برای امنیت، یک‌بار دیگر وارد شوید.', '');
  } catch (err) {
    toast(err.message, 'error');
  }
});

function renderBackups(data) {
  const box = $('backupList');
  box.innerHTML = '';
  if (!data.backups.length) {
    box.append(el('div', 'field__hint', 'هنوز نسخه پشتیبانی ساخته نشده است.'));
    return;
  }
  const list = el('div');
  for (const b of data.backups.slice(0, 8)) {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)';
    const info = el('div');
    info.style.flex = '1';
    info.style.minWidth = '0';
    const when = b.created ? new Date(b.created).toLocaleString('fa-IR') : '';
    info.append(el('div', null, when));
    info.append(el('div', 'field__hint', `${(b.size / 1024).toFixed(0)} کیلوبایت`));

    const dl = el('a', 'btn btn--sm btn--ghost', 'دانلود');
    dl.href = `/api/backups/${encodeURIComponent(b.name)}`;
    row.append(info, dl);
    list.append(row);
  }
  box.append(list);
}


$('backupNow').addEventListener('click', async () => {
  try {
    const r = await api('/api/backups', { method: 'POST' });
    toast(`پشتیبان ساخته شد: ${r.name}`, 'ok');
    renderBackups(await api('/api/backups'));
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ────────────────────────  بله  ────────────────────────

/**
 * ارسال پشتیبان فقط با بله انجام می‌شود. تلگرام قبلاً هم بود و حذف شد:
 * آی‌پی‌های تلگرام در ایران فیلتر است و Node اصلاً به آن وصل نمی‌شود
 * (مرورگر می‌تواند چون از پروکسی سیستم رد می‌شود، ولی Node فقط
 * متغیرهای محیطی خودش را می‌خواند).
 */
const BALE = {
  label: 'بله',
  father: 'ربات @BotFather در بله',
  link: 'https://ble.ir/botfather',
};

/** ساخت فرم بله؛ رویدادهایش هم همان لحظه وصل می‌شوند */
function buildBaleForm() {
  const wrap = el('div');
  wrap.style.cssText = 'padding:12px 0;border-top:1px solid var(--line)';

  const head = el('div');
  head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';
  const title = el('strong', null, BALE.label);
  const badge = el('span', 'field__hint', 'ذخیره نشده است');
  badge.id = 'blState';
  badge.style.marginInlineStart = 'auto';
  head.append(title, badge);
  wrap.append(head);

  const token = el('input', 'input');
  token.type = 'password';
  token.id = 'blToken';
  token.dir = 'ltr';
  token.autocomplete = 'off';
  token.spellcheck = false;
  token.placeholder = '۱۲۳۴۵۶۷۸۹:AA...';
  wrap.append(wrapField(`${BALE.label} — توکن ربات`, token));

  const chat = el('input', 'input');
  chat.type = 'text';
  chat.id = 'blChat';
  chat.dir = 'ltr';
  chat.inputMode = 'numeric';
  chat.autocomplete = 'off';
  chat.placeholder = '۱۲۳۴۵۶۷۸۹';
  wrap.append(wrapField(`${BALE.label} — شناسهٔ گفت‌وگو`, chat));

  const hint = el('p', 'field__hint');
  hint.innerHTML = `ربات را از <a href="${BALE.link}" target="_blank" rel="noopener">${BALE.father}</a> `
    + 'بسازید، توکن را بگذارید، یک پیام به ربات بدهید و «خواندن شناسه» را بزنید.';
  wrap.append(hint);

  const row = el('div', 'row-2');
  row.style.marginTop = '10px';
  const check = el('button', 'btn btn--ghost', 'بررسی توکن');
  const discover = el('button', 'btn btn--ghost', 'خواندن شناسه');
  row.append(check, discover);
  wrap.append(row);

  const save = el('button', 'btn btn--primary btn--block', 'ذخیره و ارسال پیام آزمایشی');
  save.style.marginTop = '10px';
  wrap.append(save);

  check.addEventListener('click', () => checkBaleToken(token.value.trim()));
  discover.addEventListener('click', () => discoverBaleChat(token.value.trim()));
  save.addEventListener('click', () => saveBale(token, chat, badge));

  return wrap;
}

function buildMessengerForms() {
  const box = $('messengerForms');
  if (box.childElementCount) return; // یک‌بار می‌سازیم، نه با هر بارگذاری
  box.innerHTML = '';
  box.append(buildBaleForm());
}

// فرم همین‌جا ساخته می‌شود و نه بالاتر. const بالا نمی‌رود و تا خط
// خودش اجرا نشود در ناحیهٔ مرده است؛ فراخوانیِ زودتر یعنی
// «Cannot access 'BALE' before initialization» و کل صفحه می‌میرد.
buildMessengerForms();

/**
 * نشان دادن وضعیت ذخیرهٔ بله.
 * سرور توکن را هرگز نمی‌فرستد — فقط می‌گوید پر است یا نه — پس این
 * تنها چیزی است که اینجا قابل نمایش است.
 */
function renderMessengerState() {
  const badge = $('blState');
  if (!badge) return;
  badge.textContent = state.settings?.bl_token_set
    ? 'ذخیره شده است'
    : 'ذخیره نشده است';
  const chat = $('blChat');
  // اگر کاربر چیزی در کادر نوشته، زیرنویس نشود
  if (chat && document.activeElement !== chat) {
    chat.value = state.settings?.bl_chat_id ?? '';
  }
}

async function saveBale(tokenInput, chatInput, badge) {
  const token = tokenInput.value.trim();
  const chat = chatInput.value.trim();

  if (!token) { toast(`توکن ربات ${BALE.label} را وارد کنید.`, 'error'); return; }
  if (!chat) { toast(`شناسهٔ گفت‌وگوی ${BALE.label} را وارد کنید.`, 'error'); return; }

  try {
    await api('/api/settings', {
      method: 'PUT',
      body: { bl_token: token, bl_chat_id: chat },
    });

    state.settings = (await api('/api/settings')).settings;
    await api('/api/messenger/test', { method: 'POST' });

    tokenInput.value = '';
    badge.textContent = 'ذخیره شد و پیام آزمایشی فرستاده شد';
    toast(`${BALE.label} تنظیم شد — پیام آزمایشی را ببینید.`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function checkBaleToken(token) {
  if (!token) {
    toast(`توکن ${BALE.label} را وارد کنید؛ اگر ذخیره شده، همان را بفرستید.`, 'error');
    return;
  }
  try {
    // توکن را در بدنه می‌فرستیم تا ذخیره نشود؛ بررسی نباید چیزی را عوض کند
    const r = await api('/api/messenger/check', { method: 'POST', body: { token } });
    toast(`توکن سالم است — ربات: @${r.username}`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function discoverBaleChat(token) {
  try {
    // اگر چیزی در کادر نیست، سرور از توکن ذخیره‌شده استفاده می‌کند
    const r = await api('/api/messenger/discover', {
      method: 'POST', body: token ? { token } : {},
    });
    $('blChat').value = r.chatId;
    toast(`شناسهٔ «${r.title}» خوانده شد. حالا ذخیره کنید.`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/**
 * بازگردانی پشتیبان.
 * فایل به base64 تبدیل و در JSON فرستاده می‌شود چون سرور هیچ
 * وابستگی بیرونی برای تجزیه multipart ندارد.
 */
$('restoreNow').addEventListener('click', async () => {
  const file = $('restoreFile').files?.[0];
  const box = $('restoreError');
  box.textContent = '';
  if (!file) { box.textContent = 'اول یک فایل پشتیبان انتخاب کنید.'; return; }

  const ok = confirm(
    `اطلاعات فعلی با پشتیبان «${file.name}» جایگزین شود؟\n\n`
    + 'همه رزروهای فعلی از بین می‌روند.\n'
    + 'پیش از جایگزینی، یک پشتیبان از وضعیت فعلی گرفته می‌شود.',
  );
  if (!ok) return;

  const btn = $('restoreNow');
  btn.disabled = true;
  btn.textContent = 'در حال بازگردانی…';

  try {
    const b64 = await fileToBase64(file);
    const r = await api('/api/backups/restore', {
      method: 'POST',
      body: { confirm: true, content: b64 },
    });
    $('restoreFile').value = '';
    // نشست جاری به پایگاه‌داده قبلی وصل بوده و پس از جایگزینی معتبر نیست،
    // پس کاربر باید دوباره وارد شود — با کاربرانی که در فایل پشتیبان هستند.
    alert(
      'بازگردانی انجام شد.\n\n'
      + `پشتیبان ایمنی: ${r.safetyBackup}\n\n`
      + 'اطلاعات با نسخهٔ پشتیبان جایگزین شد. اکنون با نام کاربری و رمزی که\n'
      + 'در آن نسخه تعریف شده بود وارد شوید.',
    );
    await logout();
  } catch (err) {
    box.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'بازگردانی';
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // «data:application/octet-stream;base64,XXXX» → فقط بخش داده
      resolve(String(reader.result).split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('فایل خوانده نشد.'));
    reader.readAsDataURL(file);
  });
}

async function loadRequesters() {
  // فهرست درخواست‌دهندگان از مسیر گزارش می‌آید که فقط برای مدیر باز است؛
  // کاربر عادی فرم رزرو را بدون فهرست پیشنهادی پر می‌کند.
  if (!state.user?.isAdmin) return;
  try {
    const data = await api('/api/reports/detail?jy=' + state.reportMonth.jy + '&jm=' + state.reportMonth.jm);
    state.requesters = data.options.requesters;
    const list = $('requesterList');
    list.innerHTML = '';
    for (const r of state.requesters) {
      const o = document.createElement('option');
      o.value = r;
      list.append(o);
    }
  } catch { /* بی‌اهمیت */ }
}

// ───────────────  کمکی‌ها  ───────────────

function banner(text, kind = 'info') {
  const b = el('div', `banner banner--${kind}`);
  b.append(el('span', 'banner__body', text));
  return b;
}

function openModal(id) {
  $(id).classList.add('is-open');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  $(id).classList.remove('is-open');
  if (!document.querySelector('.modal.is-open')) document.body.classList.remove('modal-open');
}

$('bookingClose').addEventListener('click', () => closeModal('bookingModal'));
$('bookingCancel').addEventListener('click', () => closeModal('bookingModal'));
$('detailClose').addEventListener('click', () => closeModal('detailModal'));

for (const id of ['bookingModal', 'detailModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === $(id)) closeModal(id);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.is-open').forEach((m) => {
      m.classList.remove('is-open');
    });
    document.body.classList.remove('modal-open');
  }
});

// ───────────────  شروع  ───────────────

boot();

// اجازه استفاده از توابع در کنسول برای اشکال‌زدایی
window.__state = state;

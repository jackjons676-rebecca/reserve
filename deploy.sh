#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  استقرار سامانه رزرو سالن‌ها روی سرور لینوکسی
#
#  نصب:
#    curl -sSL https://raw.githubusercontent.com/USER/REPO/main/deploy.sh \
#      | sudo bash -s -- --repo https://github.com/USER/REPO.git --ip 1.2.3.4
#
#  به‌روزرسانی (همان دستور، داده‌ها دست‌نخورده می‌ماند):
#    curl -sSL .../deploy.sh | sudo bash -s -- --repo URL --ip IP
#
#  گزینه‌ها:
#    --repo URL       آدرس مخزن گیت یا فایل tar.gz   (الزامی)
#    --ip ADDRESS     آی‌پی سرور، فقط برای پیام پایانی (پیش‌فرض: خودکار)
#    --port PORT      پورت سرویس (پیش‌فرض: 8080)
#    --dir PATH       محل نصب (پیش‌فرض: /opt/reserve)
#    --user USER      کاربر اجرای سرویس (پیش‌فرض: کاربر جایی که با آن وارد شده‌اید)
#    --no-firewall    فایروال دست‌نخورده بماند
#    --uninstall      حذف سرویس (پایگاه‌داده را پاک نمی‌کند)
#
#  اسکریپت idem potent است: اجرای دوباره روی سرور نصب‌شده
#  اطلاعات را پاک نمی‌کند و فقط کد را به‌روز می‌کند.
# ─────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR="/opt/reserve"
PORT="8080"
REPO=""
IP=""
RUN_USER="${SUDO_USER:-${USER:-root}}"
DO_FIREWALL=1
MODE="install"

# ───────────────────────────  خروجی  ───────────────────────────

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf '\n%s▸ %s%s\n' "$BLUE$BOLD" "$1" "$RESET"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
fail()  { printf '\n  %s✗ %s%s\n\n' "$RED" "$1" "$RESET"; exit 1; }
hint()  { printf '    %s%s%s\n' "$DIM" "$1" "$RESET"; }

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ───────────────────────────  آرگومان‌ها  ───────────────────────────

[ $# -eq 0 ] && usage

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)       REPO="${2:-}"; shift 2 ;;
    --repo=*)     REPO="${1#*=}"; shift ;;
    --ip)         IP="${2:-}"; shift 2 ;;
    --ip=*)       IP="${1#*=}"; shift ;;
    --port)       PORT="${2:-}"; shift 2 ;;
    --port=*)     PORT="${1#*=}"; shift ;;
    --dir)        APP_DIR="${2:-}"; shift 2 ;;
    --dir=*)      APP_DIR="${1#*=}"; shift ;;
    --user)       RUN_USER="${2:-}"; shift 2 ;;
    --user=*)     RUN_USER="${1#*=}"; shift ;;
    --no-firewall) DO_FIREWALL=0; shift ;;
    --uninstall)  MODE="uninstall"; shift ;;
    -h|--help)    usage ;;
    *)            fail "گزینه ناشناخته: $1  (با --help راهنما را ببینید)" ;;
  esac
done

# ───────────────────────────  بررسی دسترسی  ───────────────────────────

[ "$(id -u)" -eq 0 ] || fail "این اسکریپت باید با دسترسی root اجرا شود:
    sudo bash -s -- --repo URL --ip IP"

# ───────────────────────────  حذف  ───────────────────────────

if [ "$MODE" = "uninstall" ]; then
  step "حذف سرویس"
  systemctl stop reserve 2>/dev/null || true
  systemctl disable reserve 2>/dev/null || true
  rm -f /etc/systemd/system/reserve.service
  systemctl daemon-reload
  ok "سرویس حذف شد"
  hint "پوشه $APP_DIR و فایل‌های پایگاه‌داده دست‌نخورده ماندند."
  hint "برای حذف کامل، دستی پوشه را پاک کنید: rm -rf $APP_DIR"
  exit 0
fi

[ -n "$REPO" ] || fail "آدرس مخزن لازم است. نمونه:
    sudo bash -s -- --repo https://github.com/USER/REPO.git --ip 1.2.3.4"

if [ "$MODE" = "install" ] && [ ! -d "$APP_DIR" ]; then
  step "بررسی پیش‌نیازها"

  # ─────────────────────────  سیستم‌عامل  ─────────────────────────
  if [ ! -r /etc/os-release ]; then
    fail "سیستم‌عامل شناسایی نشد. این اسکریپت برای اوبونتو و دبیان نوشته شده است."
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-} ${ID_LIKE:-}" in
    *debian*|*ubuntu*) PKG="apt"; OS_FAMILY="debian" ;;
    *fedora*|*rhel*|*centos*) PKG="dnf"; OS_FAMILY="rhel" ;;
    *arch*)           PKG="pacman"; OS_FAMILY="arch" ;;
    *) fail "توزیع پشتیبانی‌نشده: ${ID:-نامشخص}
    این اسکریپت برای اوبونتو/دبیان نوشته شده. برای بقیه، بخش ۶ راهنمای استقرار را دنبال کنید." ;;
  esac
  ok "سیستم‌عامل: $PRETTY_NAME"

  # ─────────────────────────  ابزارهای لازم  ─────────────────────────
  for tool in curl tar; do
    command -v "$tool" >/dev/null 2>&1 || fail "ابزار $tool نصب نیست."
  done

  need_pkg=""
  if ! command -v git >/dev/null 2>&1 && [[ "$REPO" == *.git* ]]; then
    need_pkg="git"
  fi
  if [ -n "$need_pkg" ]; then
    warn "نصب $need_pkg ..."
    case "$PKG" in
      apt)    apt-get update -qq && apt-get install -y -qq git ;;
      dnf)    dnf install -y -q git ;;
      pacman) pacman -Sy --noconfirm git ;;
    esac
    ok "$need_pkg نصب شد"
  fi

  # ─────────────────────────  Node.js ۲۴  ─────────────────────────
  need_node=24
  if command -v node >/dev/null 2>&1; then
    have_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$have_major" -ge "$need_node" ]; then
      ok "Node.js $(node -v) نصب است"
    else
      warn "Node.js $(node -v) قدیمی است؛ نسخه ۲۴ یا بالاتر لازم است (پایگاه‌داده داخلی)."
      INSTALL_NODE=1
    fi
  else
    INSTALL_NODE=1
  fi

  if [ "${INSTALL_NODE:-0}" = "1" ]; then
    warn "نصب Node.js ۲۴ ..."
    case "$OS_FAMILY" in
      debian)
        apt-get update -qq
        apt-get install -y -qq ca-certificates curl gnupg
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
          | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
        echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
          > /etc/apt/sources.list.d/nodesource.list
        apt-get update -qq && apt-get install -y -qq nodejs
        ;;
      rhel)
        curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
        dnf install -y -q nodejs
        ;;
      arch)
        pacman -Sy --noconfirm nodejs
        ;;
    esac
    ok "Node.js $(node -v) نصب شد"
  fi
fi

# ───────────────────────────  دریافت کد  ───────────────────────────

step "دریافت کد"
FIRST_INSTALL=0
[ -d "$APP_DIR" ] || FIRST_INSTALL=1

mkdir -p "$APP_DIR"
cd "$APP_DIR"

# کد از ریپو گرفته می‌شود ولی data/ هرگز دست نمی‌خورد
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [[ "$REPO" == *.tar.gz || "$REPO" == *.tgz ]]; then
  hint "دانلود فایل فشرده"
  curl -fsSL "$REPO" -o "$STAGE/app.tar.gz"
  tar -xzf "$STAGE/app.tar.gz" -C "$STAGE"
elif command -v git >/dev/null 2>&1 && [[ "$REPO" == *://* || "$REPO" == *git@* ]]; then
  hint "کپی از مخزن گیت"
  if [ "$FIRST_INSTALL" = "1" ]; then
    git clone --depth 1 "$REPO" "$STAGE/src"
  else
    # به‌روزرسانی: کش و شاخه را نگه می‌داریم، فایل‌های محلی دست‌نخورده
    if [ -d "$APP_DIR/.git" ]; then
      git -C "$APP_DIR" fetch --depth 1 origin || warn "به‌روزرسانی مخزن ناموفق بود؛ نسخه فعلی استفاده می‌شود."
      git -C "$APP_DIR" reset --hard origin/HEAD 2>/dev/null || warn "ادغام شاخه‌ها ممکن نشد؛ نسخه فعلی می‌ماند."
    else
      git clone --depth 1 "$REPO" "$STAGE/src"
    fi
  fi
else
  fail "آدرس مخزن شناخته نشد. باید یکی از این‌ها باشد:
    https://github.com/USER/REPO.git
    https://example.com/app.tar.gz"
fi

# کد جدید را روی نسخه قبلی می‌نشانیم، به‌جز پوشه داده
SRC="$STAGE/src"
[ -d "$SRC" ] || SRC="$STAGE"
for item in server.js src public tools deploy.sh; do
  if [ -e "$SRC/$item" ]; then
    rm -rf "${APP_DIR:?}/$item"
    cp -r "$SRC/$item" "$APP_DIR/$item"
  fi
done
ok "کد در $APP_DIR قرار گرفت"

# ───────────────────────────  آمادسازی  ───────────────────────────

step "آمادسازی"
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
chmod 700 "$APP_DIR/data"
ok "پوشه داده آماده شد"

if [ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/node_modules" ]; then
  chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR/node_modules"
fi

# ───────────────────────────  سرویس  ───────────────────────────

step "سرویس systemd"
cat > /etc/systemd/system/reserve.service <<UNIT
[Unit]
Description=سامانه رزرو سالن‌های مجتمع
Documentation=https://github.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/env node server.js
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
Environment=NODE_ENV=production
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# محدودیت دسترسی
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${APP_DIR}/data

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable reserve >/dev/null 2>&1
ok "سرویس reserve تعریف شد"

# ───────────────────────────  فایروال  ───────────────────────────

if [ "$DO_FIREWALL" = "1" ]; then
  step "فایروال"
  if command -v ufw >/dev/null 2>&1; then
    ufw allow "$PORT/tcp" >/dev/null 2>&1 && ok "ufw: پورت $PORT باز شد" || warn "تنظیم ufw ناموفق بود."
  elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$PORT/tcp" >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1
    ok "firewalld: پورت $PORT باز شد"
  else
    warn "فایروالی پیدا نشد. اگر پورت باز نیست، دستی باز کنید."
  fi
else
  step "فایروال"
  hint "با --no-firewall رد شد"
fi

# ───────────────────────────  راه‌اندازی  ───────────────────────────

step "راه‌اندازی سرویس"
systemctl restart reserve
sleep 3

if systemctl is-active --quiet reserve; then
  ok "سرویس در حال اجراست"
else
  echo
  fail "سرویس بالا نیامد. آخرین لاگ‌ها:"
  journalctl -u reserve -n 30 --no-pager
fi

# بررسی اینکه واقعاً پاسخ می‌دهد
if command -v curl >/dev/null 2>&1; then
  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:${PORT}/api/status" >/dev/null 2>&1; then
      ok "برنامه پاسخ می‌دهد"
      break
    fi
    sleep 1
  done
fi

# ───────────────────────────  نتیجه  ───────────────────────────

DETECTED_IP="$IP"
if [ -z "$DETECTED_IP" ]; then
  DETECTED_IP="$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$DETECTED_IP" ] || DETECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

echo
printf '%s════════════════════════════════════════════════════════%s\n' "$GREEN$BOLD" "$RESET"
if [ "$FIRST_INSTALL" = "1" ]; then
  printf '%s  نصب کامل شد.%s\n\n' "$GREEN$BOLD" "$RESET"
  printf '  در مرورگر باز کنید:\n'
  printf '    %shttp://%s:%s%s\n\n' "$BOLD$BLUE" "${DETECTED_IP:-SERVER_IP}" "$PORT" "$RESET"
  printf '  بار اول، سامانه از شما نام کاربری، نام کامل و رمز می‌پرسد.\n'
  printf '  %sاین اولین مدیر است و به همه بخش‌ها دسترسی دارد.%s\n' "$DIM" "$RESET"
else
  printf '%s  به‌روزرسانی انجام شد.%s\n\n' "$GREEN$BOLD" "$RESET"
  printf '  آدرس:  %shttp://%s:%s%s\n' "$BOLD$BLUE" "${DETECTED_IP:-SERVER_IP}" "$PORT" "$RESET"
  printf '  %sاطلاعات شما دست‌نخورده مانده است.%s\n' "$DIM" "$RESET"
fi

printf '  %sگزارش وضعیت:%s  systemctl status reserve\n' "$DIM" "$RESET"
printf '  %sدیدن لاگ:%s    journalctl -u reserve -f\n' "$DIM" "$RESET"
printf '  %sپشتیبان:%s    %s/data/backups\n' "$DIM" "$RESET" "$APP_DIR"
printf '  %sری‌استارت:%s   systemctl restart reserve\n' "$DIM" "$RESET"
printf '%s════════════════════════════════════════════════════════%s\n' "$GREEN$BOLD" "$RESET"
echo

if [ "$PORT" = "8080" ] && [ "${DETECTED_IP:-}" != "127.0.0.1" ] && [ "${DETECTED_IP:-}" != "localhost" ]; then
  printf '  %sهشدار:%s برنامه بدون HTTPS اجرا می‌شود.\n' "$YELLOW$BOLD" "$RESET"
  printf '  %sاگر از اینترنت عمومی استفاده می‌کنید، رمز عبور در شبکه رمزنگاری نمی‌شود.\n' "$DIM"
  printf '  راه‌حل: بخش ۹ راهنمای استقرار (دامنه + گواهی رایگان) یا محدود کردن به شبکه داخلی.%s\n\n' "$RESET"
fi
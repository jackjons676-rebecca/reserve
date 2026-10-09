// ساخت آیکون PNG از پیکسل خام — بدون هیچ کتابخانه تصویری.
// خروجی: icon-192.png، icon-512.png، icon-maskable.png و favicon
//
// PNG از سه بخش تشکیل شده: امضا، بلوک‌های IDAT (داده فشرده)، و IEND.
// هر بلوک داده قبل از فشرده‌سازی، با الگوریتم فیلتر هر سطر پیش می‌رود.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

// رنگ‌ها
const BRAND = [0x1f, 0x6f, 0x5c];
const WHITE = [0xff, 0xff, 0xff];

/** فاصله تا نزدیک‌ترین نقطه */
function distSq(px, py, cx, cy) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * رنگ پیکسل در اندازه size
 * maskable یعنی ناحیه امن کوچک‌تر است تا هنگام برش گرد نشکند
 */
function drawIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;
  // در حالت maskable، شکل‌ها کوچک‌تر و وسط‌چین‌تر می‌شوند
  const scale = maskable ? 0.72 : 1;
  const radius = maskable ? 0 : size * 0.22;

  const ringOuter = c * scale * 0.78;
  const ringInner = c * scale * 0.60;
  const ringHalf = size * 0.026;

  // ساعت: دست‌ها
  const handLen = c * scale * 0.46;
  const handHalf = size * 0.030;
  const hubR = size * 0.038;

  // پنجره‌های سالن
  const winW = size * 0.088 * scale;
  const winH = size * 0.088 * scale;
  const winGap = size * 0.028 * scale;
  const winY = c + size * 0.16 * scale;
  const winCount = 4;
  const winTotalW = winW * winCount + winGap * (winCount - 1);
  const winStartX = c - winTotalW / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // پس‌زمینه سبز با گوشه گرد
      let bg = BRAND;
      if (radius > 0) {
        const dx = Math.max(radius - px, px - (size - radius), 0);
        const dy = Math.max(radius - py, py - (size - radius), 0);
        if (dx * dx + dy * dy > radius * radius) {
          rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
          continue;
        }
      }

      let color = bg;
      let alpha = 255;

      // حلقه ساعت
      const dRing = distSq(px, py, c, c);
      if (Math.abs(Math.sqrt(dRing) - (ringOuter + ringInner) / 2) < ringHalf) {
        color = WHITE;
      }

      // دست ساعت عمودی
      if (Math.abs(px - c) < handHalf && py >= c - handLen && py <= c + hubR) {
        color = WHITE;
      }
      // دست ساعت مورب (به سمت پایین‌راست)
      {
        const dx = px - c;
        const dy = py - c;
        // محور دست دوم: زاویه ۴۵ درجه
        const along = (dx + dy) / Math.SQRT2;
        const off = (dx - dy) / Math.SQRT2;
        if (off >= -handHalf && off <= handHalf && along >= -hubR && along <= handLen * 0.62) {
          color = WHITE;
        }
      }

      // مرکز ساعت
      if (dRing < hubR * hubR) color = WHITE;

      // پنجره‌های سالن
      for (let k = 0; k < winCount; k += 1) {
        const wx = winStartX + k * (winW + winGap);
        if (px >= wx && px <= wx + winW && py >= winY && py <= winY + winH) {
          // شفاف‌تر از حلقه، تا شکل ساعت غالب بماند
          color = [Math.round((WHITE[0] + BRAND[0]) / 2),
                   Math.round((WHITE[1] + BRAND[1]) / 2),
                   Math.round((WHITE[2] + BRAND[2]) / 2)];
        }
      }

      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = alpha;
    }
  }
  return rgba;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** ساخت فایل PNG از پیکسل‌های RGBA */
function encodePng(rgba, size) {
  // هر سطر با فیلتر صفر شروع می‌شود، سپس داده فشرده می‌شود
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // عمق بیت
  ihdr[9] = 6;   // نوع رنگ: RGBA
  ihdr[10] = 0;  // فشرده‌سازی
  ihdr[11] = 0;  // فیلتر
  ihdr[12] = 0;  // درون‌یابی

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(PUBLIC, { recursive: true });

const jobs = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable.png', size: 512, maskable: true },
  { file: 'favicon-32.png', size: 32, maskable: false },
];

for (const { file, size, maskable } of jobs) {
  const png = encodePng(drawIcon(size, maskable), size);
  writeFileSync(join(PUBLIC, file), png);
  console.log(`${file} ساخته شد — ${(png.length / 1024).toFixed(1)} کیلوبایت`);
}

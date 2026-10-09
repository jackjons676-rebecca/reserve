// سازنده ZIP با zlib داخلی Node
// فایل اکسل در واقع یک ZIP از چند فایل XML است، پس این لایه پایه آن است.

import { deflateRawSync } from 'node:zlib';

// جدول CRC32
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * ساخت بایت‌های یک فایل ZIP.
 * files: آرایه‌ای از { name, data } — data می‌تواند رشته یا Buffer باشد
 */
export function createZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    // سرآیند محلی فایل
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // امضای محلی
    local.writeUInt16LE(20, 4);        // نسخه لازم برای فشرده‌سازی
    local.writeUInt16LE(0x0800, 6);    // پرچم: نام فایل به‌صورت UTF-8
    local.writeUInt16LE(8, 8);         // روش فشرده‌سازی: deflate
    local.writeUInt16LE(0, 10);        // زمان
    local.writeUInt16LE(0x21, 12);     // تاریخ — ۱ ژانویه ۱۹۸۰
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, compressed);

    // رکورد دفترچه مرکزی
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);   // امضای مرکزی
    cd.writeUInt16LE(20, 4);           // نسخه سازنده
    cd.writeUInt16LE(20, 6);           // نسخه لازم
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);           // طول توضیح اضافه
    cd.writeUInt16LE(0, 32);           // طول یادداشت
    cd.writeUInt16LE(0, 34);           // شماره دیسک
    cd.writeUInt16LE(0, 36);           // ویژگی داخلی
    cd.writeUInt32LE(0, 38);           // ویژگی خارجی
    cd.writeUInt32LE(offset, 42);      // محل سرآیند محلی
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);      // امضای پایان دفترچه
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

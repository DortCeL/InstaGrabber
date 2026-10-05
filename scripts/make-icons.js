// Generates icons/icon{16,32,48,128}.png with no dependencies: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;
const STOPS = [
  [0, [254, 218, 117]],
  [0.25, [250, 126, 30]],
  [0.5, [214, 41, 118]],
  [0.75, [150, 47, 191]],
  [1, [79, 91, 213]],
];
const STROKE = 0.065;
const SEGMENTS = [
  [0.5, 0.22, 0.5, 0.58],
  [0.31, 0.41, 0.5, 0.6],
  [0.69, 0.41, 0.5, 0.6],
  [0.26, 0.77, 0.74, 0.77],
];

function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function insideRoundedSquare(x, y, r) {
  const dx = Math.max(r - x, 0, x - (1 - r));
  const dy = Math.max(r - y, 0, y - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

function segDist(px, py, [x1, y1, x2, y2]) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (!insideRoundedSquare(u, v, 0.23)) continue;
          const glyph = SEGMENTS.some((s) => segDist(u, v, s) <= STROKE);
          const c = glyph ? [255, 255, 255] : gradient((u + (1 - v)) / 2);
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = r / a;
        px[i + 1] = g / a;
        px[i + 2] = b / a;
        px[i + 3] = (a / (SAMPLES * SAMPLES)) * 255;
      }
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

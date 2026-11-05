import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const size = 1024;
const raw = Buffer.alloc((size * 4 + 1) * size);
const wine = [123, 40, 58];
const white = [255, 255, 255];

// macOS app icon grid: an 824/1024 rounded square, centred, with transparent padding around it.
const tile = size * (824 / 1024);
const radius = tile * 0.225;
const discRadius = tile * 0.34;

// Signed distance to the rounded square; negative inside.
function tileDistance(x, y) {
  const half = tile / 2 - radius;
  const qx = Math.abs(x - size / 2) - half;
  const qy = Math.abs(y - size / 2) - half;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

// Turns a signed distance into pixel coverage, which anti-aliases the edges.
const coverage = (distance) => Math.min(Math.max(0.5 - distance, 0), 1);

for (let y = 0; y < size; y++) {
  const row = y * (size * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    const disc = coverage(Math.hypot(px - size / 2, py - size / 2) - discRadius);
    const i = row + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[i + c] = Math.round(wine[c] + (white[c] - wine[c]) * disc);
    raw[i + 3] = Math.round(255 * coverage(tileDistance(px, py)));
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);

// Node.js 내장 zlib로 PNG 아이콘 생성 (외부 패키지 불필요)
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function makePNG(size, r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB

  // 각 스캔라인: filter 바이트(0) + RGB 픽셀
  const scanline = Buffer.alloc(1 + size * 3);
  scanline[0] = 0;
  for (let x = 0; x < size; x++) {
    scanline[1 + x * 3] = r;
    scanline[2 + x * 3] = g;
    scanline[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array(size).fill(scanline));

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });

// #1a73e8 = rgb(26, 115, 232)
for (const size of [16, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, makePNG(size, 26, 115, 232));
  console.log(`✅ icons/icon${size}.png`);
}
console.log('아이콘 생성 완료!');

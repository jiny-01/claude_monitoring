// icon.ico 생성 (256x256 PNG 내장). 실행: node gen-icon.js
const fs = require('fs');
const zlib = require('zlib');
const { pixels } = require('./iconlib');

const S = 256; // electron-builder 요구: 최소 256x256
const bgra = pixels(0, 0, S, false); // 바로가기 아이콘은 점 없이 캐릭터만
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const o = y * (S * 4 + 1) + 1 + x * 4;
    raw[o] = bgra[i + 2]; raw[o + 1] = bgra[i + 1]; raw[o + 2] = bgra[i]; raw[o + 3] = bgra[i + 3];
  }
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = S >= 256 ? 0 : S; head[7] = S >= 256 ? 0 : S; // 0 = 256px head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(__dirname + '/icon.ico', Buffer.concat([head, png]));
console.log('icon.ico 생성 완료');

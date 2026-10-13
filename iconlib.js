// Claude Code 캐릭터(주황색 블록 모양) + 오른쪽 아래 상태 점. 반환: BGRA 버퍼
// 점 색: 회색=쉬는 중 / 초록=작업 중 / 빨강=응답 필요(점 안에 숫자)
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];
const ORANGE = [217, 119, 87];
const EYE = [38, 30, 28];
const RECTS = [
  // [u0, v0, u1, v1] 몸통, 팔, 다리 (32x32 기준 좌표)
  [5, 6, 27, 20], [2, 11, 5, 16], [27, 11, 30, 16],
  [7, 20, 10, 26], [12, 20, 15, 26], [17, 20, 20, 26], [22, 20, 25, 26],
];
const EYES = [[10, 10, 12, 15], [20, 10, 22, 15]];
const inRect = (u, v, r) => u >= r[0] && u < r[2] && v >= r[1] && v < r[3];

function pixels(attn, run, S = 32, withDot = true) {
  const dot = attn ? [217, 71, 63] : run ? [47, 158, 106] : [163, 158, 147];
  const g = attn ? DIGITS[Math.min(attn, 9)] : null;
  const buf = Buffer.alloc(S * S * 4);
  const k = S / 32;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / k;
      const v = (y + 0.5) / k;
      let c = null;
      if (RECTS.some((r) => inRect(u, v, r))) c = ORANGE;
      if (EYES.some((r) => inRect(u, v, r))) c = EYE;
      let a = c ? 1 : 0;
      if (withDot) {
        const d = Math.hypot(u - 24, v - 24);
        const ring = Math.max(0, Math.min(1, (8.5 - d) * k + 0.5)); // 바깥 흰 테두리
        const fill = Math.max(0, Math.min(1, (7 - d) * k + 0.5));
        if (ring > 0) {
          const t = ring;
          c = c ? c.map((ch, i) => Math.round(ch * (1 - t) + 255 * t)) : [255, 255, 255];
          a = Math.max(a, t);
        }
        if (fill > 0) {
          let col = dot;
          if (g) {
            const cc = Math.floor((u - 21) / 2);
            const rr = Math.floor((v - 19) / 2);
            if (cc >= 0 && cc < 3 && rr >= 0 && rr < 5 && g[rr * 3 + cc] === '1') col = [255, 255, 255];
          }
          c = c ? c.map((ch, i) => Math.round(ch * (1 - fill) + col[i] * fill)) : col;
          a = Math.max(a, fill);
        }
      }
      if (!c) continue;
      const o = (y * S + x) * 4;
      buf[o] = c[2]; buf[o + 1] = c[1]; buf[o + 2] = c[0]; buf[o + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

module.exports = { pixels };

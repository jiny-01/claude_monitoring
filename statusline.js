// Claude Code statusLine 수집기: stdin 의 세션 JSON 을 파일로만 저장한다.
// 화면 출력 0바이트, 네트워크·LLM 호출 없음 (토큰 0).
const fs = require('fs');
const path = require('path');

const OUT = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '.', 'claude-board', 'status');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(raw.replace(/^﻿/, ''));
    const id = String(j.session_id || '').replace(/[^\w-]/g, '');
    if (!id) return;
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = path.join(OUT, `${id}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ ...j, _at: Date.now() }));
    fs.renameSync(tmp, path.join(OUT, `${id}.json`));
  } catch {
    /* 조용히 무시: 상태줄 때문에 세션이 방해받지 않게 */
  }
});

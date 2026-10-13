// 세션 표시 이름 결정: (1) 사용자가 붙인 제목 → (2) 첫 요청 내용 → (3) 자동 별칭
// ~/.claude/projects/*/<sessionId>.jsonl 을 읽기만 한다 (LLM·네트워크 호출 없음).
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const TAIL = 1024 * 1024;
const HEAD = 512 * 1024;
const RECHECK_MS = 15000;

const pathCache = new Map(); // sessionId -> 파일 경로
const firstCache = new Map(); // 파일 -> 첫 요청 요약(문자열|null)
const custCache = new Map(); // 파일 -> { size, at, title }

function findFile(id) {
  if (!id) return null;
  const hit = pathCache.get(id);
  if (hit && fs.existsSync(hit)) return hit;
  let dirs = [];
  try {
    dirs = fs.readdirSync(ROOT);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const p = path.join(ROOT, d, `${id}.jsonl`);
    if (fs.existsSync(p)) {
      pathCache.set(id, p);
      return p;
    }
  }
  return null;
}

function readRange(file, start, len) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function customTitle(file) {
  const st = fs.statSync(file);
  const c = custCache.get(file);
  if (c && (c.size === st.size || Date.now() - c.at < RECHECK_MS)) return c.title;
  const start = Math.max(0, st.size - TAIL);
  const text = readRange(file, start, Math.min(TAIL, st.size));
  let title = null;
  for (const m of text.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)) {
    try {
      title = JSON.parse(`"${m[1]}"`);
    } catch {
      /* 잘린 항목은 무시 */
    }
  }
  custCache.set(file, { size: st.size, at: Date.now(), title });
  return title;
}

function snippet(s) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 40 ? `${one.slice(0, 40)}…` : one;
}

function firstPrompt(file) {
  if (firstCache.has(file)) return firstCache.get(file);
  let out = null;
  try {
    const lines = readRange(file, 0, HEAD).split('\n');
    lines.pop(); // 잘렸을 수 있는 마지막 줄
    for (const line of lines) {
      if (!line.includes('"type":"user"')) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.isMeta || o.isSidechain || o.type !== 'user') continue;
      const c = o.message && o.message.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text') || {}).text : '';
      const raw = (t || '').trim().replace(/^[@"'`\s]+/, '');
      if (!raw || raw.startsWith('<') || raw.startsWith('[Image') || raw.startsWith('/')) continue; // 태그·슬래시 명령 제외
      // 경로 같은 긴 토큰은 빼고 사람이 쓴 말만 남긴다
      const s = raw.split(/\s+/).filter((w) => !/[\\/]/.test(w) || w.length <= 8).join(' ').replace(/^["'`]+/, '');
      if (!s) continue;
      out = snippet(s);
      break;
    }
  } catch {
    out = null;
  }
  if (out) firstCache.set(file, out); // 못 찾은 경우는 다음에 다시 시도
  return out;
}

// Claude 앱(데스크톱) 세션 저장소: cliSessionId -> 앱에 표시되는 제목
function appRoots() {
  const out = [];
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
  try {
    for (const d of fs.readdirSync(pk)) {
      if (/^Claude_/.test(d)) out.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions'));
    }
  } catch {
    /* MSIX 설치가 아니면 없음 */
  }
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'Claude', 'claude-code-sessions'));
  return out;
}
let appMap = new Map();
let appAt = 0;
function appTitles() {
  if (Date.now() - appAt < 15000) return appMap;
  appAt = Date.now();
  const m = new Map();
  const walk = (d) => {
    let es;
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) {
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (j.cliSessionId && j.title) m.set(j.cliSessionId, j.title);
        } catch {
          /* 형식이 다른 파일은 건너뜀 */
        }
      }
    }
  };
  appRoots().forEach(walk);
  appMap = m;
  return m;
}

// 표시 제목: 실제 제목이 있으면 그대로, 없으면 원래 별칭 그대로 (real=false)
function resolveTitle(s) {
  if (s.nameSource === 'user' && s.name) return { title: s.name, real: true };
  const app = appTitles().get(s.sessionId);
  if (app) return { title: app, real: true };
  const file = findFile(s.sessionId);
  if (file) {
    try {
      const c = customTitle(file);
      if (c) return { title: c, real: true };
    } catch {
      /* 읽기 실패 시 별칭 */
    }
  }
  return { title: s.name || String(s.pid), real: false };
}

// 사용자가 실제로 입력한 문장만 추린다 (태그·슬래시 명령·도구 결과·너무 짧은 응답 제외)
function userText(o) {
  if (!o || o.type !== 'user' || o.isMeta || o.isSidechain) return '';
  const c = o.message && o.message.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text') || {}).text : '';
  const s = (t || '').trim().replace(/^[@"'`\s]+/, '');
  if (s.length < 6 || s.startsWith('<') || s.startsWith('[') || s.startsWith('/')) return '';
  return s.replace(/\s+/g, ' ');
}

const lastCache = new Map(); // 파일 -> { size, at, text }
function lastPrompt(file) {
  const st = fs.statSync(file);
  const c = lastCache.get(file);
  if (c && (c.size === st.size || Date.now() - c.at < RECHECK_MS)) return c.text;
  const n = Math.min(st.size, TAIL);
  const lines = readRange(file, st.size - n, n).split('\n');
  let text = '';
  for (let i = lines.length - 1; i >= 0 && !text; i--) {
    if (!lines[i].includes('"type":"user"')) continue;
    try {
      text = userText(JSON.parse(lines[i]));
    } catch {
      /* 잘린 줄은 건너뜀 */
    }
  }
  lastCache.set(file, { size: st.size, at: Date.now(), text });
  return text;
}

function promptHints(s) {
  const file = findFile(s.sessionId);
  if (!file) return { first: '', last: '' };
  try {
    return { first: firstPrompt(file) || '', last: lastPrompt(file) };
  } catch {
    return { first: '', last: '' };
  }
}

// 서브에이전트 기록(<세션>/subagents/agent-*.jsonl): 마지막 줄이 종료(end_turn)가 아니고 최근에 갱신됐으면 실행 중
function isFinished(file, size) {
  const n = Math.min(size, 65536);
  const lines = readRange(file, size - n, n).split('\n').filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return last.includes('"stop_reason":"end_turn"') || last.includes('"stop_reason":"stop_sequence"');
}

function runningSubagents(sessionId, status) {
  const file = findFile(sessionId);
  if (!file) return [];
  const dir = path.join(path.dirname(file), sessionId, 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // 부모가 쉬는 중이면 더 엄격하게(60초), 작업 중이면 도구가 오래 걸릴 수 있어 5분
  const limit = status === 'idle' || status === 'waiting' ? 60000 : 300000;
  const now = Date.now();
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const jp = path.join(dir, n);
    let st;
    try {
      st = fs.statSync(jp);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > limit || !st.size) continue;
    try {
      if (isFinished(jp, st.size)) continue;
    } catch {
      continue;
    }
    const mp = jp.replace(/\.jsonl$/, '.meta.json');
    let meta = {};
    let started = st.mtimeMs;
    try {
      meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
      started = fs.statSync(mp).mtimeMs;
    } catch {
      /* 메타가 없으면 기본값 */
    }
    out.push({
      id: n.replace(/\.jsonl$/, ''),
      type: meta.agentType || 'agent',
      desc: meta.description || '',
      startedAt: started,
      updatedAt: st.mtimeMs,
    });
  }
  return out;
}

module.exports = { resolveTitle, runningSubagents, promptHints };

const ATTN = new Set(['waiting']);
const REST = new Set(['idle']);
const LABEL = { waiting: '입력 대기', idle: '쉬는 중', shell: '명령 실행 중', busy: '작업 중', working: '작업 중' };

let sessions = [];
let restClosed = true;
let armed = null;
let editing = false;
let armTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return '방금';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '분 전';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '시간 전';
  return Math.floor(h / 24) + '일 전';
}
const kind = (s) => (ATTN.has(s.status) ? 'attn' : REST.has(s.status) ? 'rest' : 'run');
const folder = (cwd) => cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

// 제목이 없는 세션: 실제로 입력한 요청 문장을 그대로 보여 줘서 구분하게 한다
function hintLines(s) {
  if (s.titleReal !== false) return '';
  const cut = (t) => (t.length > 46 ? t.slice(0, 46) + '…' : t);
  const rows = [];
  if (s.last) rows.push(`<div class="hint2" title="${esc(s.last)}"><b>최근 요청</b> ${esc(cut(s.last))}</div>`);
  return rows.join('');
}

// 작업 폴더 · 브랜치 · 변경 수 · 원격 대비 앞섬/뒤처짐
function gitLine(s) {
  const parts = [`<span class="dir" title="${esc(s.cwd)}">${esc(folder(s.cwd))}</span>`];
  const g = s.git;
  if (g && g.branch) {
    const main = /^(main|master)$/.test(g.branch);
    parts.push(`<span class="br${main ? ' warn' : ''}" title="브랜치">⎇ ${esc(g.branch)}</span>`);
    parts.push(g.changed ? `<span class="chg">변경 ${g.changed}</span>` : '<span class="ok">변경 없음</span>');
    if (g.hasUp && (g.ahead || g.behind)) parts.push(`<span title="원격 대비">↑${g.ahead} ↓${g.behind}</span>`);
    else if (!g.hasUp && g.branch !== '(detached)') parts.push('<span>원격 없음</span>');
  }
  return parts.join(' · ');
}

function ctxText(s) {
  if (typeof s.ctx !== 'number') return '';
  const p = Math.round(s.ctx);
  const cls = p >= 85 ? 'hot' : p >= 70 ? 'warn' : '';
  return ` · 컨텍스트 <span class="ctx ${cls}" title="${esc(s.model || '')}">${p}%</span>`;
}

function card(s) {
  const k = kind(s);
  const label = LABEL[s.status] || '작업 중';
  const btnText = armed === s.pid ? '정말 종료?' : '종료';
  return `<div class="card ${k}">
    <span class="badge"></span>
    <div class="info">
      <div class="meta"><span class="state">${esc(label)}</span> · ${ago(s.updatedAt)}${ctxText(s)}</div>
      <div class="name${s.titleReal === false ? ' untitled' : ''}" data-sid="${esc(s.sessionId)}" title="${s.titleReal === false ? '제목 없음 · ' : ''}더블클릭해서 제목 지정 · 별칭 ${esc(s.name)}">${esc(s.title || s.name)}</div>
        ${hintLines(s)}
        <div class="meta git">${gitLine(s)}</div>
    </div>
    <button data-pid="${s.pid}" class="${armed === s.pid ? 'confirm' : ''}">${btnText}</button>
  </div>`;
}

function group(title, items, opts = {}) {
  if (!items.length) return '';
  const fold = opts.fold ? `fold ${restClosed ? 'closed' : ''}` : '';
  const body = opts.fold && restClosed ? '' : items.map(card).join('');
  return `<section><div class="group-title ${fold}" ${opts.fold ? 'data-fold="1"' : ''}>${title}<span class="count">${items.length}</span></div>${body}</section>`;
}

function tickClock() {
  const d = new Date();
  const t = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
  $('synced').innerHTML = esc(t) + '<br>' + esc(d.toLocaleDateString('sv-SE'));
  if (typeof renderUsage === 'function') renderUsage();
}
setInterval(() => { if (typeof tickClock === 'function') tickClock(); }, 5000);

function dur(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + '초째';
  const m = Math.floor(s / 60);
  return m < 60 ? m + '분 ' + (s % 60) + '초째' : Math.floor(m / 60) + '시간째';
}

// 실행 중인 서브에이전트: 세션 구역 아래에 별도 목록으로 표시
function agentGroup(list) {
  const rows = [];
  list.forEach((s) => (s.agents || []).forEach((a) => rows.push({ ...a, parent: s.title || s.name })));
  if (!rows.length) return '';
  rows.sort((a, b) => a.startedAt - b.startedAt);
  const body = rows
    .map(
      (a) => `<div class="card run agent">
      <span class="badge"></span>
      <div class="info">
        <div class="name"><span class="pill">${esc(a.type)}</span>${esc(a.desc || '작업 중')}</div>
        <div class="meta"><span class="state">${dur(a.startedAt)}</span> · ${esc(a.parent)}</div>
      </div>
    </div>`
    )
    .join('');
  return `<section><div class="group-title">서브에이전트 실행 중<span class="count">${rows.length}</span></div>${body}</section>`;
}

function render() {
  if (editing) return;
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const attn = sorted.filter((s) => kind(s) === 'attn');
  const run = sorted.filter((s) => kind(s) === 'run');
  const rest = sorted.filter((s) => kind(s) === 'rest');

  const subs = sorted.reduce((n, s) => n + (s.agents ? s.agents.length : 0), 0);
  const tiles = [
    ['', sessions.length, '세션'],
    ['run', run.length, '● 작업 중'],
    ['attn', attn.length, '○ 입력 대기'],
    ['', rest.length, '✓ 쉬는 중'],
    ['', subs, '↳ 서브에이전트'],
  ];
  $('stats').innerHTML = tiles
    .map(([k, n, l]) => `<div class="stat ${n ? k : 'zero'}" title="${l.replace(/^[^ ]+ /, '')} ${n}건"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');

  const sum = $('summary');
  sum.className = 'summary ' + (attn.length ? 'attn' : run.length ? 'run' : '');
  $('title').textContent = attn.length
    ? `내 응답이 필요한 세션 ${attn.length}개`
    : run.length ? `작업 중인 세션 ${run.length}개` : '실행 중인 세션이 없어요';
  $('hint').textContent = sessions.length ? `이 PC에서 열려 있는 Claude Code 세션 ${sessions.length}개` : '';

  $('list').innerHTML = sessions.length
    ? group('응답 필요', attn) + group('작업 중', run) + agentGroup(sorted) + group('쉬는 중', rest, { fold: true })
    : '<div class="empty"><b>열려 있는 세션이 없어요</b>Claude Code를 실행하면 여기에 표시돼요</div>';
  $('count').textContent = `총 ${sessions.length}개`;
  tickClock();
}

function drawTray(attn, run) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = attn ? '#d9473f' : run ? '#2f9e6a' : '#a39e93';
  g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  if (attn) {
    g.fillStyle = '#fff'; g.font = 'bold 20px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(attn > 9 ? '9+' : String(attn), 16, 17);
  }
  window.board.setTrayIcon(c.toDataURL('image/png'));
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

$('list').addEventListener('click', async (e) => {
  if (e.target.closest('[data-fold]')) { restClosed = !restClosed; render(); return; }
  const btn = e.target.closest('button[data-pid]');
  if (!btn) return;
  const pid = Number(btn.dataset.pid);
  armed = null;
  const s = sessions.find((x) => x.pid === pid);
  if (!s) return;
  const r = await window.board.kill(s);
  toast(r.msg);
});

function setPinUi(on) {
  $('pin').classList.toggle('on', on);
  document.body.classList.toggle('pinned', on);
  $('pinLabel').textContent = on ? '· 고정됨' : '';
  $('pin').title = on ? '고정됨 (다시 누르면 해제)' : '화면에 고정 (바깥을 눌러도 닫히지 않아요)';
}
$('pin').addEventListener('click', () => {
  const on = !$('pin').classList.contains('on');
  setPinUi(on);
  window.board.setPin(on);
});
window.board.getPin().then(setPinUi);

// 이름 더블클릭 → 입력칸. Enter 저장 / Esc 취소 / 비우면 원래 이름으로 복원
$('list').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.name[data-sid]');
  if (!el || editing) return;
  editing = true;
  const sid = el.dataset.sid;
  const input = document.createElement('input');
  input.className = 'name-edit';
  input.value = el.textContent;
  input.maxLength = 60;
  el.replaceWith(input);
  input.focus();
  input.select();
  const done = (save) => {
    if (!editing) return;
    editing = false;
    if (save) window.board.rename(sid, input.value);
    else render();
  };
  input.addEventListener('keydown', (k) => {
    if (k.key === 'Enter') done(true);
    if (k.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
});

// 5시간·주간 한도 (statusLine 입력의 rate_limits, Pro/Max)
let usage = null;
function until(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return m + '분';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '시간 ' + (m % 60) + '분';
  return Math.floor(h / 24) + '일 ' + (h % 24) + '시간';
}
function renderUsage() {
  const el = $('usage');
  if (!usage || (!usage.five && !usage.week)) {
    el.innerHTML = '<div class="u-empty">사용량 정보 대기 중 (세션이 응답하면 표시돼요)</div>';
    return;
  }
  const row = (label, w) => {
    const p = Math.round(w.pct);
    const cls = p >= 85 ? 'hot' : p >= 60 ? 'warn' : '';
    return `<div class="u-row"><span class="t">${label}</span><span class="p">${p}%</span>
      <div class="bar"><i class="${cls}" style="width:${Math.min(100, p)}%"></i></div>
      <span class="r">${w.resets ? '초기화까지 ' + until(w.resets) : ''}</span></div>`;
  };
  el.innerHTML = (usage.five ? row('5시간 한도', usage.five) : '') + (usage.week ? row('주간 한도', usage.week) : '');
}
window.board.onUsage((u) => { usage = u; renderUsage(); });

window.board.onSessions((list) => { sessions = list; render(); });
setInterval(render, 30000);
render();

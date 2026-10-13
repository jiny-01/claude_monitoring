// Claude Board: ~/.claude/sessions/*.json 만 읽는 트레이 위젯.
// LLM·네트워크 호출 없음 (토큰 0). .key 파일은 읽지 않는다.
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DIR = path.join(os.homedir(), '.claude', 'sessions');
const W = 380;
const H = 560;

let win;
let tray;
let lastJson = '';
let lastUsageJson = '';
let lastList = [];

// 핀 고정 상태·위치 저장 (userData/config.json)
const CFG_PATH = path.join(app.getPath('userData'), 'config.json');
let cfg = { pinned: false, pos: null, size: null, aliases: {} };
try {
  cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) };
} catch {
  /* 첫 실행 */
}
function saveCfg() {
  try {
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg));
  } catch {
    /* 저장 실패는 무시 */
  }
}

if (!app.requestSingleInstanceLock()) app.quit();

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

const gitCache = new Map(); // cwd -> { at, busy, info }
function gitInfo(cwd) {
  if (!cwd) return null;
  let rec = gitCache.get(cwd);
  if (!rec) {
    rec = { at: 0, busy: false, info: null };
    gitCache.set(cwd, rec);
  }
  if (!rec.busy && Date.now() - rec.at > 10000) {
    rec.busy = true;
    execFile(
      'git',
      ['-C', cwd, 'status', '--porcelain=v2', '--branch'],
      { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, out) => {
        rec.busy = false;
        rec.at = Date.now();
        let info = null;
        if (!err) {
          info = { branch: '', ahead: 0, behind: 0, changed: 0, hasUp: false };
          for (const l of String(out).split('\n')) {
            if (l.startsWith('# branch.head ')) info.branch = l.slice(14).trim();
            else if (l.startsWith('# branch.upstream')) info.hasUp = true;
            else if (l.startsWith('# branch.ab ')) {
              const m = l.match(/\+(\d+) -(\d+)/);
              if (m) {
                info.ahead = Number(m[1]);
                info.behind = Number(m[2]);
              }
            } else if (l && l[0] !== '#') info.changed++;
          }
        }
        if (JSON.stringify(info) !== JSON.stringify(rec.info)) {
          rec.info = info;
          lastJson = '';
          refresh();
        }
      }
    );
  }
  return rec.info;
}

function readSessions() {
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      if (!s.pid || !alive(s.pid)) continue;
      const st = readStatus(s.sessionId);
      const cw = st && st.context_window;
      out.push({
        pid: s.pid,
        name: s.name || String(s.pid),
        sessionId: s.sessionId || '',
        ...(() => {
          const a = cfg.aliases && cfg.aliases[s.sessionId];
          if (a) return { title: a, titleReal: true };
          const r = resolveTitle(s);
          if (r.real) return { title: r.title, titleReal: true };
          const h = promptHints(s);
          return { title: r.title, titleReal: false, first: h.first, last: h.last };
        })(),
        agents: runningSubagents(s.sessionId, s.status),
        git: gitInfo(s.cwd),
        ctx: cw && typeof cw.used_percentage === 'number' ? cw.used_percentage : null,
        model: (st && st.model && st.model.display_name) || '',
        status: s.status || 'unknown',
        cwd: s.cwd || '',
        startedAt: s.startedAt || 0,
        updatedAt: s.statusUpdatedAt || s.updatedAt || s.startedAt || 0,
        procStart: String(s.procStart || ''),
      });
    } catch {
      /* 쓰는 도중인 파일은 다음 틱에 다시 읽는다 */
    }
  }
  return out;
}

function refresh() {
  const usage = readUsage();
  const uj = JSON.stringify(usage);
  if (uj !== lastUsageJson) {
    lastUsageJson = uj;
    if (win && !win.isDestroyed()) win.webContents.send('usage', usage);
  }
  lastList = readSessions();
  const json = JSON.stringify(lastList);
  if (json === lastJson) return;
  lastJson = json;
  if (win && !win.isDestroyed()) win.webContents.send('sessions', lastList);
  const waiting = lastList.filter((s) => s.status === 'waiting').length;
  const running = lastList.filter((s) => s.status !== 'waiting' && s.status !== 'idle').length;
  tray.setImage(makeIcon(waiting, running));
  tray.setToolTip(
    waiting
      ? `클로드 모니터링 · 응답 필요 ${waiting}개 (전체 ${lastList.length}개)`
      : `클로드 모니터링 · 세션 ${lastList.length}개`
  );
}

function placeWindow() {
  if (cfg.pos) {
    win.setPosition(cfg.pos.x, cfg.pos.y, false);
    return;
  }
  const b = tray.getBounds();
  const d = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const wa = d.workArea;
  const [cw, ch] = win.getSize();
  const x = Math.min(Math.max(b.x + b.width / 2 - cw / 2, wa.x + 8), wa.x + wa.width - cw - 8);
  const y = wa.y + wa.height - ch - 8;
  win.setPosition(Math.round(x), Math.round(y), false);
}

function toggle() {
  if (win.isVisible()) {
    win.hide();
    return;
  }
  placeWindow();
  win.show();
  win.focus();
  refresh();
  win.webContents.send('sessions', lastList);
}

// 트레이 아이콘: 모니터 모양, 화면 색 = 상태, 응답 필요 시 화면에 숫자 (렌더러에 의존하지 않음)
const { pixels } = require('./iconlib');
const { resolveTitle, runningSubagents, promptHints, readStatus, readUsage } = require('./titles');
const APP_ICON = path.join(__dirname, 'icon.ico');

function makeIcon(attn, run) {
  return nativeImage.createFromBitmap(pixels(attn, run, 32), { width: 32, height: 32 });
}

app.setAppUserModelId('claude.board');
// 작업표시줄에 고정한 바로가기를 다시 누르면 패널을 연다(방금 포커스를 잃어 닫힌 직후라면 닫힌 채로 둔다)
let lastBlurHide = 0;
app.on('second-instance', () => {
  if (!win || win.isVisible() || Date.now() - lastBlurHide < 1500) return;
  toggle();
});

ipcMain.on('rename', (_e, { sessionId, title }) => {
  if (!sessionId) return;
  cfg.aliases = cfg.aliases || {};
  const t = String(title || '').trim().slice(0, 60);
  if (t) cfg.aliases[sessionId] = t;
  else delete cfg.aliases[sessionId];
  saveCfg();
  lastJson = '';
  refresh();
});

ipcMain.handle('get-pin', () => cfg.pinned);
ipcMain.on('set-pin', (_e, v) => {
  cfg.pinned = !!v;
  if (cfg.pinned) {
    const [x, y] = win.getPosition();
    cfg.pos = { x, y };
  }
  saveCfg();
});

ipcMain.handle('kill', (_e, { pid, procStart }) =>
  new Promise((resolve) => {
    const id = Number(pid);
    if (!Number.isInteger(id)) return resolve({ ok: false, msg: '잘못된 요청이에요' });
    // PID 재사용 방지: 시작 시각(FILETIME)이 세션 파일과 같은지 확인한 뒤에만 종료
    const ps = `(Get-Process -Id ${id}).StartTime.ToFileTime()`;
    execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, out) => {
      if (err) return resolve({ ok: false, msg: '이미 종료된 세션이에요' });
      let same = false;
      try {
        const diff = BigInt(String(out).trim()) - BigInt(procStart);
        same = (diff < 0n ? -diff : diff) < 100000000n; // 10초 이내
      } catch {
        same = false;
      }
      if (!same) return resolve({ ok: false, msg: '다른 프로세스로 바뀌어 중단했어요' });
      execFile('taskkill', ['/PID', String(id), '/T', '/F'], { windowsHide: true }, (e2) => {
        refresh();
        resolve(e2 ? { ok: false, msg: '종료에 실패했어요' } : { ok: true, msg: '세션을 종료했어요' });
      });
    });
  })
);

app.whenReady().then(() => {
  tray = new Tray(makeIcon(0, 0));
  tray.setToolTip('클로드 모니터링');
  tray.on('click', toggle);
  tray.on('right-click', () =>
    tray.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: '열기', click: toggle },
        {
          label: '로그인 시 자동 실행',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }),
        },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() },
      ])
    )
  );

  win = new BrowserWindow({
    width: (cfg.size && cfg.size.w) || W,
    height: (cfg.size && cfg.size.h) || H,
    minWidth: 320,
    minHeight: 320,
    show: false,
    icon: APP_ICON,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.on('blur', () => {
    if (cfg.pinned) return;
    lastBlurHide = Date.now();
    win.hide();
  });
  win.on('resized', () => {
    const [w, h] = win.getSize();
    const [x, y] = win.getPosition();
    cfg.size = { w, h };
    cfg.pos = { x, y };
    saveCfg();
  });
  // 어디로 옮기든 위치를 기억한다 (고정 여부와 무관)
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    cfg.pos = { x, y };
    saveCfg();
  });
  win.webContents.on('did-finish-load', () => {
    lastUsageJson = '';
    refresh();
    win.webContents.send('sessions', lastList);
    if (cfg.pinned) {
      placeWindow();
      win.showInactive();
    }
  });

  // 변경 감지(즉시) + 느린 보조 확인(프로세스 사망 감지용)
  try {
    fs.watch(DIR, { persistent: false }, () => setTimeout(refresh, 150));
  } catch {
    /* 폴더가 아직 없으면 보조 확인만 동작 */
  }
  setInterval(refresh, 3000);
});

app.on('window-all-closed', (e) => e.preventDefault());

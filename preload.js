const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('board', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, u) => cb(u)),
  onSessions: (cb) => ipcRenderer.on('sessions', (_e, list) => cb(list)),
  kill: (s) => ipcRenderer.invoke('kill', { pid: s.pid, procStart: s.procStart }),
  rename: (sessionId, title) => ipcRenderer.send('rename', { sessionId, title }),
  getPin: () => ipcRenderer.invoke('get-pin'),
  setPin: (v) => ipcRenderer.send('set-pin', v),
});

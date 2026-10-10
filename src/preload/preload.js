const { contextBridge, ipcRenderer } = require("electron");

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, cb) => { const fn = (_e, p) => cb(p); ipcRenderer.on(ch, fn); return () => ipcRenderer.removeListener(ch, fn); };

contextBridge.exposeInMainWorld("kcc", {
  getState: () => invoke("state:get"),
  login: () => invoke("account:login"),
  offlineAccount: (name) => invoke("account:offline", name),
  removeAccount: (uuid) => invoke("account:remove", uuid),
  selectAccount: (uuid) => invoke("account:select", uuid),
  setConfig: (patch) => invoke("config:set", patch),
  checkVersion: () => invoke("version:check"),
  install: (opts) => invoke("client:install", opts),
  launch: () => invoke("game:launch"),
  kill: () => invoke("game:kill"),
  pickZip: () => invoke("dialog:pickZip"),
  pickJava: () => invoke("dialog:pickJava"),
  openExternal: (url) => invoke("shell:openExternal", url),
  openGameDir: () => invoke("shell:openGameDir"),
  on,
});

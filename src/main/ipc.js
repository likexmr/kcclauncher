// 렌더러 ↔ 메인 통신. 진행률/로그는 webContents.send 로 밀어준다.
const { ipcMain, dialog, shell, app } = require("electron");
const fs = require("fs");
const path = require("path");
const { dirs } = require("./paths");
const { store, accounts, selected, upsertAccount, removeAccount } = require("./store");
const auth = require("./auth");
const installer = require("./installer");
const javaMgr = require("./java");
const { launch } = require("./launch");

const DEV = !!process.env.KCC_DEV;
let gameChild = null;

function publicConfig() {
  return {
    site: store.get("site"),
    azureClientId: store.get("azureClientId"),
    hasClientId: !!auth.clientId(store),
    ramMb: store.get("ramMb"),
    javaPath: store.get("javaPath"),
    gameDir: store.get("gameDir"),
    closeOnLaunch: store.get("closeOnLaunch"),
    installedBuild: store.get("installedBuild"),
  };
}

function versionJsonPath() { return path.join(dirs.versions, "KoreaCom", "KoreaCom.json"); }
function clientJarPath() { return path.join(dirs.versions, "KoreaCom", "KoreaCom.jar"); }
function isInstalled() { return fs.existsSync(versionJsonPath()) && fs.existsSync(clientJarPath()); }

function register(win) {
  const send = (ch, payload) => win && !win.isDestroyed() && win.webContents.send(ch, payload);
  const onProgress = (p) => send("progress", p);
  const onStage = (s) => send("stage", s);

  ipcMain.handle("state:get", () => ({
    accounts: accounts().map((a) => ({ name: a.name, uuid: a.uuid, type: a.type })),
    selected: selected() ? selected().uuid : "",
    config: publicConfig(),
    installed: isInstalled(),
    dev: DEV,
    appVersion: app.getVersion(),
  }));

  ipcMain.handle("account:login", async () => {
    const acc = await auth.login(store, win);
    upsertAccount(acc);
    return { name: acc.name, uuid: acc.uuid, type: acc.type };
  });

  ipcMain.handle("account:offline", (_e, name) => {
    if (!DEV) throw new Error("오프라인 계정은 개발 모드에서만 가능");
    const clean = String(name || "Player").replace(/[^A-Za-z0-9_]/g, "").slice(0, 16) || "Player";
    // 오프라인 UUID(이름 기반, 바닐라 방식과 동일)
    const crypto = require("crypto");
    const md5 = crypto.createHash("md5").update("OfflinePlayer:" + clean).digest();
    md5[6] = (md5[6] & 0x0f) | 0x30; md5[8] = (md5[8] & 0x3f) | 0x80;
    const hex = md5.toString("hex");
    const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    const acc = { type: "offline", name: clean, uuid, accessToken: "0", obtained: Date.now() };
    upsertAccount(acc);
    return { name: acc.name, uuid: acc.uuid, type: acc.type };
  });

  ipcMain.handle("account:remove", (_e, uuid) => { removeAccount(uuid); return true; });
  ipcMain.handle("account:select", (_e, uuid) => { store.set("selectedUuid", uuid); return true; });

  ipcMain.handle("config:set", (_e, patch) => {
    for (const k of ["site", "azureClientId", "ramMb", "javaPath", "gameDir", "closeOnLaunch"]) {
      if (k in patch) store.set(k, patch[k]);
    }
    return publicConfig();
  });

  ipcMain.handle("version:check", async () => {
    try {
      const r = await installer.fetchRemoteVersion(store.get("site"));
      return { ok: true, remote: r, installedBuild: store.get("installedBuild"), installed: isInstalled() };
    } catch (e) {
      return { ok: false, error: e.message, installedBuild: store.get("installedBuild"), installed: isInstalled() };
    }
  });

  ipcMain.handle("dialog:pickZip", async () => {
    const r = await dialog.showOpenDialog(win, { title: "KoreaCom zip 고르기", filters: [{ name: "zip", extensions: ["zip"] }], properties: ["openFile"] });
    return r.canceled ? "" : r.filePaths[0];
  });
  ipcMain.handle("dialog:pickJava", async () => {
    const r = await dialog.showOpenDialog(win, { title: "java 실행 파일 고르기", properties: ["openFile"] });
    return r.canceled ? "" : r.filePaths[0];
  });
  ipcMain.handle("shell:openExternal", (_e, url) => shell.openExternal(url));
  ipcMain.handle("shell:openGameDir", () => shell.openPath(store.get("gameDir") || dirs.gameDir));

  // 설치/업데이트(명시적). opts.localZip 있으면 그 파일에서.
  ipcMain.handle("client:install", async (_e, opts = {}) => {
    try {
      onStage("자바 확인 중");
      await javaMgr.ensureJava(store.get("javaPath"), onProgress);
      let remote = null;
      if (!opts.localZip) { try { remote = await installer.fetchRemoteVersion(store.get("site")); } catch (_) {} }
      const res = await installer.ensureClient({ site: store.get("site"), localZip: opts.localZip || null, remote, onProgress, onStage });
      if (res.build) store.set("installedBuild", res.build);
      onStage("설치 완료");
      return { ok: true, build: res.build || store.get("installedBuild") };
    } catch (e) {
      onStage("오류");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("game:launch", async () => {
    const acc = selected();
    if (!acc) return { ok: false, error: "계정을 먼저 추가하세요." };
    try {
      onStage("자바 확인 중");
      const java = await javaMgr.ensureJava(store.get("javaPath"), onProgress);

      // 업데이트 확인(가능하면). 설치 안 됐거나 빌드가 다르면 설치.
      let remote = null;
      try { remote = await installer.fetchRemoteVersion(store.get("site")); } catch (_) {}
      const needInstall = !isInstalled() || (remote && remote.build && remote.build !== store.get("installedBuild"));
      if (needInstall) {
        const res = await installer.ensureClient({ site: store.get("site"), remote, onProgress, onStage });
        if (res.build) store.set("installedBuild", res.build);
      }
      if (!isInstalled()) return { ok: false, error: "클라이언트가 설치되지 않았어요." };

      const versionJson = JSON.parse(fs.readFileSync(versionJsonPath(), "utf8"));

      // 정품 토큰 갱신(오래됐으면)
      let account = acc;
      if (account.type === "msa") {
        const old = Date.now() - (account.obtained || 0) > 20 * 3600 * 1000;
        if (old) {
          onStage("로그인 갱신 중");
          try { account = await auth.refreshAccount(store, account); upsertAccount(account); }
          catch (e) { return { ok: false, error: "로그인이 만료됐어요. 계정을 다시 추가하세요." }; }
        }
      }

      onStage("실행 중");
      gameChild = launch({
        java, account, versionJson, clientJar: clientJarPath(),
        ramMb: store.get("ramMb"), gameDir: store.get("gameDir") || dirs.gameDir,
        onLog: (l) => send("log", l),
        onExit: (code) => { gameChild = null; send("game:exit", code); },
      });
      send("game:started", {});
      if (store.get("closeOnLaunch")) setTimeout(() => win.minimize(), 800);
      return { ok: true };
    } catch (e) {
      onStage("오류");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("game:kill", () => { if (gameChild) { try { gameChild.kill(); } catch (_) {} } return true; });
}

module.exports = { register };

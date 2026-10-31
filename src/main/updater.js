// 런처 자동 업데이트(GitHub Releases: likexmr/kcclauncher).
// 설치판(NSIS)·AppImage 는 electron-updater 로 백그라운드에서 받아 두고 "다시 시작" 한 번(또는 다음 종료 때) 적용.
// 포터블 exe·tar.gz 는 스스로 못 바꾸므로 새 버전이 있다는 것만 알리고 릴리스 페이지를 연다.
const { app } = require("electron");
const net = require("./net");

const OWNER = "likexmr";
const REPO = "kcclauncher";
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const CHECK_EVERY = 6 * 3600 * 1000;

let send = () => {};
let state = { status: "idle" }; // idle|checking|none|available|downloading|ready|manual|error
let autoUpdater = null;
let gameRunning = () => false;

function set(patch) {
  state = { ...state, ...patch };
  send("updater", state);
}

// 이 실행 파일이 스스로 업데이트할 수 있는 형태인지
function canSelfUpdate() {
  if (!app.isPackaged) return false;
  if (process.platform === "win32") return !process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return false;
}

// "1.2.10" > "1.2.9"
function newer(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// 포터블 등: GitHub API 로 최신 태그만 비교
async function checkManual() {
  set({ status: "checking" });
  try {
    const r = await net.getJson(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
    const v = String(r.tag_name || "").replace(/^v/, "");
    if (v && newer(v, app.getVersion())) set({ status: "manual", version: v, url: r.html_url || RELEASES });
    else set({ status: "none" });
  } catch (e) {
    // 릴리스가 아직 하나도 없으면 404 — 오류로 띄우지 않는다
    set({ status: /HTTP 404/.test(e.message) ? "none" : "error", error: e.message });
  }
}

function setupAuto() {
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
  autoUpdater.on("update-not-available", () => set({ status: "none" }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", version: i.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) => set({ status: "ready", version: i.version }));
  autoUpdater.on("error", (e) => {
    const msg = (e && e.message) || String(e);
    // 릴리스가 없거나 latest.yml 이 없으면 조용히 넘어감
    set(/404|latest(-linux)?\.yml/i.test(msg) ? { status: "none" } : { status: "error", error: msg.split("\n")[0] });
  });
}

async function check() {
  if (!app.isPackaged) { set({ status: "none", dev: true }); return state; }
  if (autoUpdater) {
    try { await autoUpdater.checkForUpdates(); } catch (_) { /* error 이벤트로 감 */ }
  } else {
    await checkManual();
  }
  return state;
}

// 받아 둔 업데이트 적용(런처 재시작). 게임이 켜져 있으면 안 함 — 게임을 끝낸 뒤 종료할 때 자동 적용된다.
function install() {
  if (state.status !== "ready" || !autoUpdater) return { ok: false, error: "받아 둔 업데이트가 없어요." };
  if (gameRunning()) return { ok: false, error: "게임을 끈 뒤에 다시 시작할 수 있어요. (런처를 닫을 때도 자동 적용돼요)" };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
}

function init(sendFn, isGameRunning) {
  send = sendFn;
  gameRunning = isGameRunning;
  if (canSelfUpdate()) {
    try { setupAuto(); } catch (e) { autoUpdater = null; }
  }
  setTimeout(check, 3000);
  setInterval(check, CHECK_EVERY).unref();
}

module.exports = { init, check, install, getState: () => state, newer, RELEASES };

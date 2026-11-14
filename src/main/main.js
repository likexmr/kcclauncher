const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { ensureAll } = require("./paths");
const ipc = require("./ipc");

let win;

function createWindow() {
  const isWin = process.platform === "win32";
  win = new BrowserWindow({
    width: 1000, height: 640, minWidth: 860, minHeight: 560,
    backgroundColor: "#0b0e12",
    show: !process.env.KCC_SHOT,
    title: "KoreaCom Launcher",
    autoHideMenuBar: true,
    // 윈도우: 제목 표시줄을 화면에 녹이고 최소화·닫기 버튼만 OS 것 그대로
    ...(isWin ? { titleBarStyle: "hidden", titleBarOverlay: { color: "#0b0e12", symbolColor: "#8b96a0", height: 40 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [isWin ? "--kcc-overlay" : "--kcc-frame"],
      offscreen: !!process.env.KCC_SHOT,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  if (process.env.KCC_DEV) win.webContents.openDevTools({ mode: "detach" });
  ipc.register(win);
  // 개발용: KCC_SHOT=파일.png 면 창을 안 띄우고(화면 밖 렌더링) 찍고 끝냄. KCC_SHOT_JS 로 찍기 전에 화면 조작
  if (process.env.KCC_SHOT) {
    let lastFrame = null;
    win.webContents.on("paint", (_e, _d, image) => { lastFrame = image; });
    win.webContents.setFrameRate(30);
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      if (process.env.KCC_SHOT_JS) await win.webContents.executeJavaScript(process.env.KCC_SHOT_JS).catch(() => {});
      await new Promise((r) => setTimeout(r, 900));
      if (lastFrame) require("fs").writeFileSync(process.env.KCC_SHOT, lastFrame.toPNG());
      app.exit(0);
    }, 2500));
  }
}

// 한 인스턴스만
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    ensureAll();
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

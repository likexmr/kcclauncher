const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { ensureAll } = require("./paths");
const ipc = require("./ipc");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 940, height: 600, minWidth: 820, minHeight: 540,
    backgroundColor: "#0e0b14",
    title: "KoreaCom Launcher",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  if (process.env.KCC_DEV) win.webContents.openDevTools({ mode: "detach" });
  ipc.register(win);
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

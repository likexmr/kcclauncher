// 런처가 쓰는 폴더들. 설정은 electron userData, 게임 인스턴스는 그 아래에 자립형으로 둔다.
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const root = app.getPath("userData"); // Win: %APPDATA%/KoreaCom Launcher, Linux: ~/.config/KoreaCom Launcher
const dirs = {
  root,
  instance: path.join(root, "instance"), // 자립형 .minecraft 역할
  libraries: path.join(root, "instance", "libraries"),
  assets: path.join(root, "instance", "assets"),
  natives: path.join(root, "instance", "natives"),
  versions: path.join(root, "instance", "versions"),
  gameDir: path.join(root, "instance", "game"), // --gameDir (세이브·설정·config.json 여기)
  java: path.join(root, "java"), // 관리형 자바 8
  cache: path.join(root, "cache"),
};

function ensureAll() {
  for (const d of Object.values(dirs)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  }
}

// 에셋 해시 → assets/objects/ab/abcd... 경로
function assetObjectPath(hash) {
  return path.join(dirs.assets, "objects", hash.slice(0, 2), hash);
}

module.exports = { dirs, ensureAll, assetObjectPath };

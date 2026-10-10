// 게임 실행: 클래스패스(라이브러리 + KoreaCom.jar) + 1.8 인자 템플릿 치환 → java 프로세스 spawn.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dirs } = require("./paths");
const { allowed } = require("./installer");

const SEP = process.platform === "win32" ? ";" : ":";

function classpath(versionJson, clientJar) {
  const cp = [];
  for (const lib of versionJson.libraries) {
    if (!allowed(lib.rules)) continue;
    const art = lib.downloads && lib.downloads.artifact;
    if (art) cp.push(path.join(dirs.libraries, art.path));
  }
  cp.push(clientJar);
  return cp.join(SEP);
}

function fillArgs(template, vars) {
  return template.split(" ").map((tok) => tok.replace(/\$\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "${" + k + "}")));
}

// opts: {java, account, versionJson, clientJar, ramMb, gameDir, onLog, onExit}
function launch(opts) {
  const { java, account, versionJson, clientJar, ramMb = 2048, onLog = () => {}, onExit = () => {} } = opts;
  const gameDir = opts.gameDir || dirs.gameDir;
  fs.mkdirSync(gameDir, { recursive: true });

  const vars = {
    auth_player_name: account.name,
    version_name: versionJson.id,
    game_directory: gameDir,
    assets_root: dirs.assets,
    assets_index_name: versionJson.assetIndex.id,
    auth_uuid: (account.uuid || "").replace(/-/g, ""),
    auth_access_token: account.accessToken || "0",
    user_properties: "{}",
    user_type: account.type === "msa" ? "msa" : "legacy",
    auth_session: "token:" + (account.accessToken || "0"),
  };
  const gameArgs = fillArgs(versionJson.minecraftArguments, vars);

  const jvm = [
    `-Xmx${ramMb}M`,
    `-Xms${Math.min(ramMb, 1024)}M`,
    `-Djava.library.path=${dirs.natives}`,
    `-Dorg.lwjgl.librarypath=${dirs.natives}`,
    "-Dminecraft.launcher.brand=KoreaCom-Launcher",
    "-cp", classpath(versionJson, clientJar),
  ];
  if (process.platform === "darwin") jvm.unshift("-XstartOnFirstThread");

  const args = [...jvm, versionJson.mainClass, ...gameArgs];
  onLog(`$ ${path.basename(java)} ${versionJson.mainClass} (Xmx${ramMb}M)\n`);

  const child = spawn(java, args, { cwd: gameDir, detached: false });
  child.stdout.on("data", (d) => onLog(d.toString()));
  child.stderr.on("data", (d) => onLog(d.toString()));
  child.on("close", (code) => onExit(code));
  child.on("error", (e) => { onLog("실행 오류: " + e.message + "\n"); onExit(-1); });
  return child;
}

module.exports = { launch, classpath };

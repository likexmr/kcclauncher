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

// opts: {java, account, versionJson, clientJar, ramMb, gameDir, logPath, onLog, onExit}
// 게임은 런처와 떨어진 프로세스로 띄운다(detached). 윈도우에서 Node 는 detached 아닌 자식을
// '부모가 끝나면 같이 끝나는' 잡에 넣어서, 런처를 닫으면 게임도 꺼졌다.
// 출력도 파이프 대신 로그 파일로 바로 쓰게 해서 런처가 없어져도 게임 쪽 쓰기가 막히지 않게 하고,
// 런처는 그 파일을 따라 읽어 화면에 보여 준다.
function launch(opts) {
  const { java, account, versionJson, clientJar, ramMb = 2048, logPath, onLog = () => {}, onExit = () => {} } = opts;
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
    // 로그 파일을 UTF-8 로(자바 18+; 8 은 무시) — 한글 로그가 깨지지 않게
    "-Dstdout.encoding=UTF-8",
    "-Dstderr.encoding=UTF-8",
    "-cp", classpath(versionJson, clientJar),
  ];
  if (process.platform === "darwin") jvm.unshift("-XstartOnFirstThread");

  const args = [...jvm, versionJson.mainClass, ...gameArgs];
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `$ ${path.basename(java)} ${versionJson.mainClass} (Xmx${ramMb}M)\n`);
  const fd = fs.openSync(logPath, "a");
  let child;
  try {
    child = spawn(java, args, { cwd: gameDir, detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
  } finally {
    fs.closeSync(fd); // 자식은 자기 핸들을 갖고 있다
  }
  child.unref();

  // 로그 파일 따라 읽기
  let pos = 0, ended = false;
  const dec = new (require("string_decoder").StringDecoder)("utf8"); // 읽기 경계에서 한글이 잘려도 안 깨지게
  const pump = () => {
    try {
      const size = fs.statSync(logPath).size;
      if (size <= pos) return;
      const h = fs.openSync(logPath, "r");
      const buf = Buffer.alloc(Math.min(size - pos, 1 << 20));
      const n = fs.readSync(h, buf, 0, buf.length, pos);
      fs.closeSync(h);
      pos += n;
      if (n) onLog(dec.write(buf.slice(0, n)));
    } catch (_) {}
  };
  const timer = setInterval(pump, 400);
  const finish = (code) => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    pump(); pump();
    onExit(code);
  };
  child.on("exit", (code) => finish(code));
  child.on("error", (e) => { onLog("실행 오류: " + e.message + "\n"); finish(-1); });
  return child;
}

module.exports = { launch, classpath };

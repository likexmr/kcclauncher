// 자바 8 관리: 설정에 지정된 경로 → 관리형(내려받은) 자바 → 없으면 Adoptium Temurin 8 JRE 다운로드.
// MC 1.8.8 + LWJGL 2.9 는 자바 8 에서 가장 안정적이라 8 을 쓴다.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const AdmZip = require("adm-zip");
const { dirs } = require("./paths");
const net = require("./net");

function javaExe(home) {
  return path.join(home, "bin", process.platform === "win32" ? "javaw.exe" : "java");
}

// 이 바이너리가 자바 8 인가? (실제로 VM 이 떠야 통과 → 반쯤 풀린 JRE 도 걸러짐)
// Windows 의 javaw.exe 는 -version 출력을 안 낼 수 있어 같은 폴더의 java.exe 로 검사.
function isJava8(exe) {
  try {
    const probe = /javaw\.exe$/i.test(exe) ? exe.replace(/javaw\.exe$/i, "java.exe") : exe;
    const r = spawnSync(fs.existsSync(probe) ? probe : exe, ["-version"], { encoding: "utf8", timeout: 15000 });
    const out = (r.stderr || "") + (r.stdout || "");
    return r.status === 0 && /version "1\.8\.|openjdk version "8|version "8/.test(out);
  } catch (_) { return false; }
}

// 설치가 끝까지 검증된 자바 홈에만 남기는 표시
const MARKER = ".kcc-java-ok";

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }

// 홈 후보(macOS 번들은 Contents/Home)
function homeIn(dir) {
  for (const cand of [dir, path.join(dir, "Contents", "Home")]) {
    if (fs.existsSync(javaExe(cand))) return cand;
  }
  return null;
}

// 관리형 자바 홈(검증 표시 있는 것만). 표시 없는 폴더 = 중간에 끊긴 설치 → 지움.
function managedHome() {
  if (!fs.existsSync(dirs.java)) return null;
  for (const name of fs.readdirSync(dirs.java)) {
    const dir = path.join(dirs.java, name);
    if (fs.existsSync(path.join(dir, MARKER))) {
      const home = homeIn(dir);
      if (home) return home;
    }
    rmrf(dir);
  }
  return null;
}

// 쓸 자바 실행 파일을 고른다(설정 경로 → 관리형). 없으면 null.
function resolveJava(configuredPath) {
  if (configuredPath && fs.existsSync(configuredPath) && isJava8(configuredPath)) return configuredPath;
  const m = managedHome();
  if (m) return javaExe(m);
  return null;
}

// Temurin 8 JRE 다운로드+압축해제. onProgress({phase,received,total})
// 임시 폴더에 풀고 실제로 실행돼야 java/ 로 옮김 → 끊겨도 깨진 JRE 가 남지 않음.
async function installJava8(onProgress = () => {}) {
  const osName = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const api = `https://api.adoptium.net/v3/binary/latest/8/ga/${osName}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  fs.mkdirSync(dirs.cache, { recursive: true });
  const ext = osName === "windows" ? "zip" : "tar.gz";
  const archive = path.join(dirs.cache, `temurin8-jre.${ext}`);

  onProgress({ phase: "자바 8 내려받는 중", received: 0, total: 0 });
  // 전체 크기 모를 수 있어 받은 바이트만 보고
  let received = 0;
  await net.download(api, archive, { onBytes: (n) => { received += n; onProgress({ phase: "자바 8 내려받는 중", received, total: 0 }); } });

  onProgress({ phase: "자바 8 푸는 중", received, total: received });
  const tmp = path.join(dirs.cache, "java-extract");
  rmrf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    if (ext === "zip") {
      new AdmZip(archive).extractAllTo(tmp, true);
    } else {
      const r = spawnSync("tar", ["-xzf", archive, "-C", tmp], { encoding: "utf8" });
      if (r.status !== 0) throw new Error("tar 실패: " + (r.stderr || ""));
    }
    const name = fs.readdirSync(tmp).find((n) => homeIn(path.join(tmp, n)));
    if (!name) throw new Error("자바 압축을 풀었지만 실행 파일을 못 찾음");
    const exe = javaExe(homeIn(path.join(tmp, name)));
    if (process.platform !== "win32") { try { fs.chmodSync(exe, 0o755); } catch (_) {} }
    if (!isJava8(exe)) throw new Error("내려받은 자바 8 이 실행되지 않음(파일 손상)");

    // 검증 통과 → 기존 관리형 자바 비우고 교체
    rmrf(dirs.java);
    fs.mkdirSync(dirs.java, { recursive: true });
    const dest = path.join(dirs.java, name);
    fs.renameSync(path.join(tmp, name), dest);
    fs.writeFileSync(path.join(dest, MARKER), new Date().toISOString());
  } finally {
    rmrf(tmp);
    try { fs.unlinkSync(archive); } catch (_) {}
  }
  const home = managedHome();
  if (!home) throw new Error("자바 설치 실패");
  return javaExe(home);
}

// 자바 확보: 있으면 경로, 없으면 다운로드. 동시에 여러 번 불려도 설치는 한 번만.
let installing = null;
async function ensureJava(configuredPath, onProgress) {
  const found = resolveJava(configuredPath);
  if (found) return found;
  if (!installing) installing = installJava8(onProgress).finally(() => { installing = null; });
  return installing;
}

module.exports = { ensureJava, resolveJava, isJava8, javaExe };

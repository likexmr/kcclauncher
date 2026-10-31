// 자바 관리: 설정에 지정된 경로 → 관리형(내려받은) 자바 → 없으면 Adoptium Temurin JRE 다운로드.
// 주 버전은 클라이언트 버전 json 의 javaVersion 을 따른다(KoreaCom b11~ 은 21, 옛 빌드·바닐라 1.8 은 8).
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

// 이 바이너리의 자바 주 버전(8, 17, 21 …). 실행이 안 되면 0 (실제로 VM 이 떠야 통과 → 반쯤 풀린 JRE 도 걸러짐)
// Windows 의 javaw.exe 는 -version 출력을 안 낼 수 있어 같은 폴더의 java.exe 로 검사.
function javaMajor(exe) {
  try {
    const probe = /javaw\.exe$/i.test(exe) ? exe.replace(/javaw\.exe$/i, "java.exe") : exe;
    const r = spawnSync(fs.existsSync(probe) ? probe : exe, ["-version"], { encoding: "utf8", timeout: 15000 });
    const out = (r.stderr || "") + (r.stdout || "");
    if (r.status !== 0) return 0;
    const m = out.match(/version "(\d+)(?:\.(\d+))?/);
    if (!m) return 0;
    const major = parseInt(m[1], 10);
    return major === 1 ? parseInt(m[2] || "0", 10) : major; // "1.8.0_x" → 8
  } catch (_) { return 0; }
}

function isJava8(exe) { return javaMajor(exe) === 8; }

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

// 표시 파일 내용: {"major":21,...}. 옛 런처는 날짜 문자열만 썼고 그땐 자바 8 뿐이었다.
function markerMajor(dir) {
  try {
    const txt = fs.readFileSync(path.join(dir, MARKER), "utf8");
    const j = JSON.parse(txt);
    if (j && typeof j.major === "number") return j.major;
  } catch (_) {}
  return 8;
}

// 관리형 자바 홈(검증 표시 있고 주 버전이 맞는 것). 표시 없는 폴더 = 중간에 끊긴 설치 → 지움.
function managedHome(major) {
  if (!fs.existsSync(dirs.java)) return null;
  for (const name of fs.readdirSync(dirs.java)) {
    const dir = path.join(dirs.java, name);
    if (!fs.existsSync(path.join(dir, MARKER))) { rmrf(dir); continue; }
    if (markerMajor(dir) !== major) continue;
    const home = homeIn(dir);
    if (home) return home;
    rmrf(dir);
  }
  return null;
}

// 쓸 자바 실행 파일을 고른다(설정 경로 → 관리형). 없으면 null.
// 직접 고른 자바는 8 이상이면 그대로 쓴다(유저 선택 존중 — 클라이언트는 자바 8 대상으로 컴파일됨).
function resolveJava(configuredPath, major = 8) {
  if (configuredPath && fs.existsSync(configuredPath) && javaMajor(configuredPath) >= 8) return configuredPath;
  const m = managedHome(major);
  if (m) return javaExe(m);
  return null;
}

// Temurin JRE(주 버전 major) 다운로드+압축해제. onProgress({phase,received,total})
// 임시 폴더에 풀고 실제로 실행돼야 java/ 로 옮김 → 끊겨도 깨진 JRE 가 남지 않음.
async function installJava(major, onProgress = () => {}) {
  const osName = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "aarch64" : "x64";
  const api = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  fs.mkdirSync(dirs.cache, { recursive: true });
  const ext = osName === "windows" ? "zip" : "tar.gz";
  const archive = path.join(dirs.cache, `temurin${major}-jre.${ext}`);
  const label = `자바 ${major}`;

  onProgress({ phase: `${label} 내려받는 중`, received: 0, total: 0 });
  // 전체 크기 모를 수 있어 받은 바이트만 보고
  let received = 0;
  await net.download(api, archive, { onBytes: (n) => { received += n; onProgress({ phase: `${label} 내려받는 중`, received, total: 0 }); } });

  onProgress({ phase: `${label} 푸는 중`, received, total: received });
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
    if (javaMajor(exe) !== major) throw new Error(`내려받은 ${label} 가 실행되지 않음(파일 손상)`);

    // 검증 통과 → 같은 주 버전의 관리형 자바만 비우고 교체(다른 버전은 둔다)
    fs.mkdirSync(dirs.java, { recursive: true });
    for (const n of fs.readdirSync(dirs.java)) {
      const d = path.join(dirs.java, n);
      if (fs.existsSync(path.join(d, MARKER)) && markerMajor(d) === major) rmrf(d);
    }
    const dest = path.join(dirs.java, name);
    rmrf(dest);
    fs.renameSync(path.join(tmp, name), dest);
    fs.writeFileSync(path.join(dest, MARKER), JSON.stringify({ major, at: new Date().toISOString() }));
  } finally {
    rmrf(tmp);
    try { fs.unlinkSync(archive); } catch (_) {}
  }
  const home = managedHome(major);
  if (!home) throw new Error(`${label} 설치 실패`);
  return javaExe(home);
}

// 버전 json 이 원하는 자바 주 버전(javaVersion.majorVersion, 없으면 8 — 1.8 기본)
function requiredMajor(versionJson) {
  const v = versionJson && versionJson.javaVersion && versionJson.javaVersion.majorVersion;
  return typeof v === "number" && v >= 8 ? v : 8;
}

// 자바 확보: 있으면 경로, 없으면 다운로드. 동시에 여러 번 불려도 같은 버전 설치는 한 번만.
const installing = new Map();
async function ensureJava(configuredPath, onProgress, major = 8) {
  const found = resolveJava(configuredPath, major);
  if (found) return found;
  if (!installing.has(major)) installing.set(major, installJava(major, onProgress).finally(() => installing.delete(major)));
  return installing.get(major);
}

module.exports = { ensureJava, resolveJava, isJava8, javaMajor, javaExe, requiredMajor };

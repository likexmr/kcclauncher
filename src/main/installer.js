// 클라이언트 설치: 사이트(또는 로컬 zip)에서 KoreaCom.json/jar → 라이브러리·네이티브·에셋 전부 받기.
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { dirs, assetObjectPath } = require("./paths");
const net = require("./net");

const OS_NAME = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
const RESOURCES = "https://resources.download.minecraft.net";

// 라이브러리 rules 평가(허용?)
function allowed(rules) {
  if (!rules) return true;
  let ok = false;
  for (const r of rules) {
    let match = true;
    if (r.os && r.os.name) match = r.os.name === OS_NAME;
    if (match) ok = r.action === "allow";
  }
  return ok;
}

// 사이트에서 최신 빌드 정보
async function fetchRemoteVersion(site) {
  const v = await net.getJson(site.replace(/\/$/, "") + "/api/version");
  const url = v.file ? `${site.replace(/\/$/, "")}/download/${encodeURIComponent(v.file)}` : null;
  return { build: v.build, file: v.file, size: v.size, url };
}

// zip(사이트 또는 로컬)에서 KoreaCom.json/jar 뽑아 versions/KoreaCom 에 저장. 버전 json 반환.
async function unpackClientZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const dest = path.join(dirs.versions, "KoreaCom");
  fs.mkdirSync(dest, { recursive: true });
  let json = null;
  for (const e of zip.getEntries()) {
    if (e.entryName.endsWith("KoreaCom.json")) {
      const txt = e.getData().toString("utf8");
      fs.writeFileSync(path.join(dest, "KoreaCom.json"), txt);
      json = JSON.parse(txt);
    } else if (e.entryName.endsWith("KoreaCom.jar")) {
      fs.writeFileSync(path.join(dest, "KoreaCom.jar"), e.getData());
    }
  }
  if (!json) throw new Error("zip 안에 KoreaCom.json 이 없음");
  return json;
}

// 전체 설치. opts: {site, localZip, remote(이미 받은 version 정보), onProgress, onStage}
// 반환: {versionJson, clientJar, build}
async function ensureClient({ site, localZip, remote, onProgress = () => {}, onStage = () => {} }) {
  let build = remote && remote.build;
  let versionJson;

  onStage("클라이언트 받는 중");
  if (localZip) {
    versionJson = await unpackClientZip(localZip);
  } else {
    const r = remote || (await fetchRemoteVersion(site));
    build = r.build;
    if (!r.url) throw new Error("사이트에 올라온 클라이언트 파일이 없어요. (관리자가 아직 업로드 안 함)");
    const zipPath = path.join(dirs.cache, r.file);
    let got = 0;
    await net.download(r.url, zipPath, { onBytes: (n) => { got += n; onProgress({ received: got, total: r.size || 0, label: "클라이언트" }); } });
    versionJson = await unpackClientZip(zipPath);
    try { fs.unlinkSync(zipPath); } catch (_) {}
  }
  const clientJar = path.join(dirs.versions, "KoreaCom", "KoreaCom.jar");

  // --- 다운로드 목록 모으기 ---
  const libTasks = [];
  const nativeTasks = [];
  for (const lib of versionJson.libraries) {
    if (!allowed(lib.rules)) continue;
    const dl = lib.downloads || {};
    if (dl.artifact) {
      libTasks.push({ url: dl.artifact.url, dest: path.join(dirs.libraries, dl.artifact.path), sha1: dl.artifact.sha1, size: dl.artifact.size || 0 });
    }
    if (lib.natives && lib.natives[OS_NAME] && dl.classifiers) {
      const cls = dl.classifiers[lib.natives[OS_NAME]];
      if (cls) nativeTasks.push({ url: cls.url, sha1: cls.sha1, size: cls.size || 0, exclude: (lib.extract && lib.extract.exclude) || ["META-INF/"] });
    }
  }

  // --- 에셋 인덱스 ---
  onStage("에셋 목록 받는 중");
  const ai = versionJson.assetIndex;
  const indexPath = path.join(dirs.assets, "indexes", ai.id + ".json");
  await net.download(ai.url, indexPath, { sha1: ai.sha1 });
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const assetTasks = [];
  for (const name of Object.keys(index.objects)) {
    const hash = index.objects[name].hash;
    assetTasks.push({ url: `${RESOURCES}/${hash.slice(0, 2)}/${hash}`, dest: assetObjectPath(hash), sha1: hash, size: index.objects[name].size || 0 });
  }

  // --- 진행률 총량 ---
  const total = [...libTasks, ...assetTasks].reduce((s, t) => s + t.size, 0) + nativeTasks.reduce((s, t) => s + t.size, 0);
  let received = 0;
  const bump = (n) => { received += n; onProgress({ received, total, label: "에셋·라이브러리" }); };

  // --- 라이브러리 ---
  onStage("라이브러리 받는 중");
  await net.pool(libTasks, (t) => net.download(t.url, t.dest, { sha1: t.sha1, onBytes: bump }), 8);

  // --- 네이티브 추출 ---
  onStage("네이티브 준비 중");
  fs.mkdirSync(dirs.natives, { recursive: true });
  for (const t of nativeTasks) {
    const tmp = path.join(dirs.cache, "native-" + path.basename(t.url));
    await net.download(t.url, tmp, { sha1: t.sha1, onBytes: bump });
    const zip = new AdmZip(tmp);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if (t.exclude.some((ex) => e.entryName.startsWith(ex.replace(/\/$/, "")))) continue;
      const out = path.join(dirs.natives, e.entryName);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, e.getData());
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
  }

  // --- 에셋 ---
  onStage("에셋 받는 중");
  await net.pool(assetTasks, (t) => net.download(t.url, t.dest, { sha1: t.sha1, onBytes: bump }), 16);

  // 1.8 은 legacy(virtual) 에셋이 아니지만, 혹시 map_to_resources 면 복사(안전망)
  if (index.virtual || index.map_to_resources) {
    onStage("에셋 정리 중");
    const base = index.map_to_resources ? path.join(dirs.gameDir, "resources") : path.join(dirs.assets, "virtual", ai.id);
    for (const name of Object.keys(index.objects)) {
      const src = assetObjectPath(index.objects[name].hash);
      const dst = path.join(base, name);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try { fs.copyFileSync(src, dst); } catch (_) {}
    }
  }

  return { versionJson, clientJar, build };
}

module.exports = { ensureClient, fetchRemoteVersion, allowed };

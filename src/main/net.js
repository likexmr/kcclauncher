// 다운로드 도우미: 리다이렉트 따라가기, sha1 검증, 진행률 콜백, 동시 다운로드 큐.
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha1File(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash("sha1");
    const s = fs.createReadStream(file);
    s.on("data", (d) => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", () => resolve(null));
  });
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { headers: { "User-Agent": "KoreaCom-Launcher" }, ...opts }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(request(next, opts));
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("시간 초과: " + url)));
  });
}

async function getJson(url) {
  const res = await request(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} ${url}`);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getText(url) {
  const res = await request(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} ${url}`);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// url → dest 파일. sha1 있으면 먼저 검사해 이미 맞으면 건너뜀. onBytes(delta) 로 진행률.
async function download(url, dest, { sha1, onBytes } = {}) {
  if (sha1 && fs.existsSync(dest) && (await sha1File(dest)) === sha1) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await request(url);
  if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} ${url}`);
  const tmp = dest + ".part";
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on("data", (d) => onBytes && onBytes(d.length));
    res.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    res.on("error", reject);
  });
  if (sha1) {
    const got = await sha1File(tmp);
    if (got !== sha1) { fs.unlinkSync(tmp); throw new Error(`sha1 불일치: ${path.basename(dest)}`); }
  }
  fs.renameSync(tmp, dest);
  return true;
}

// 작업 배열을 동시성 제한으로 실행
async function pool(items, worker, concurrency = 8) {
  const q = items.slice();
  const runners = [];
  for (let i = 0; i < concurrency; i++) {
    runners.push((async () => { while (q.length) await worker(q.shift()); })());
  }
  await Promise.all(runners);
}

// POST JSON → JSON (OAuth/Xbox 체인용)
function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "KoreaCom-Launcher", "Content-Length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null; try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("시간 초과: " + url)));
    req.write(data);
    req.end();
  });
}

function postForm(url, form, headers = {}) {
  const body = new URLSearchParams(form).toString();
  return postJson(url, body, { "Content-Type": "application/x-www-form-urlencoded", ...headers });
}

module.exports = { request, getJson, getText, download, pool, sha1File, postJson, postForm };

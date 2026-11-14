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

// 5xx(사이트가 Cloudflare 터널 뒤라 가끔 502/504)·끊김·시간 초과는 다시 해 볼 만한 오류
function retryable(e) {
  return !/HTTP 4\d\d/.test(e.message);
}

// 사람이 읽을 오류 문구
function friendly(e, what) {
  const m = /HTTP (\d+)/.exec(e.message || "");
  if (m) {
    const code = +m[1];
    if (code >= 500) return new Error(`${what}: 서버가 잠깐 응답하지 않아요 (HTTP ${code}). 잠시 뒤 다시 시도해 주세요.`);
    if (code === 404) return new Error(`${what}: 파일이 없어요 (HTTP 404).`);
    return new Error(`${what}: HTTP ${code}`);
  }
  const why = `${e.code || ""} ${e.message || ""}`;
  if (/ENOTFOUND|EAI_AGAIN/.test(why)) return new Error(`${what}: 인터넷 연결을 확인해 주세요.`);
  if (/시간 초과|연결이 끊김|크기 불일치|ETIMEDOUT|ECONNRESET|socket hang up|ECONNREFUSED/.test(why)) return new Error(`${what}: 연결이 끊겼어요. 다시 시도해 주세요.`);
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(attempt); }
    catch (e) {
      if (attempt >= tries || !retryable(e)) throw e;
      await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function readBody(res, url) {
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} ${url}`); }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function getJson(url) {
  return withRetry(async () => {
    const text = await readBody(await request(url), url);
    try { return JSON.parse(text); }
    catch (_) { throw new Error(`HTTP 502 잘못된 응답 ${url}`); } // Cloudflare 오류 페이지(HTML)가 200 으로 올 때
  });
}

async function getText(url) {
  return withRetry(async () => readBody(await request(url), url));
}

// url → dest 파일. sha1 있으면 먼저 검사해 이미 맞으면 건너뜀. onBytes(delta) 로 진행률.
// 끊김·시간 초과·5xx·크기/sha1 불일치는 다시(기다리는 시간을 늘려 가며). 실패한 시도에서 센 바이트는 진행률에서 다시 뺀다.
async function download(url, dest, { sha1, size, onBytes, tries = 5 } = {}) {
  if (sha1 && fs.existsSync(dest) && (await sha1File(dest)) === sha1) return false;
  for (let attempt = 1; ; attempt++) {
    let counted = 0;
    const count = (n) => { counted += n; if (onBytes) onBytes(n); };
    try {
      return await downloadOnce(url, dest, sha1, size, count);
    } catch (e) {
      if (counted && onBytes) onBytes(-counted);
      if (attempt >= tries || !retryable(e)) throw e;
      await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
    }
  }
}

async function downloadOnce(url, dest, sha1, size, onBytes) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} ${url}`); }
  const expect = parseInt(res.headers["content-length"] || "0", 10) || size || 0;
  const tmp = dest + ".part";
  let got = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on("data", (d) => { got += d.length; if (onBytes) onBytes(d.length); });
    res.on("aborted", () => reject(new Error("연결이 끊김(받는 중) " + url)));
    res.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    res.pipe(out);
  });
  // 중간에 끊겼는데 오류 없이 끝나는 경우(프록시·터널) → 잘린 파일을 쓰지 않는다
  if (expect && got !== expect) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error(`크기 불일치(${got}/${expect}) ${path.basename(dest)}`); }
  if (sha1) {
    const h = await sha1File(tmp);
    if (h !== sha1) { try { fs.unlinkSync(tmp); } catch (_) {} throw new Error(`sha1 불일치: ${path.basename(dest)}`); }
  }
  try { fs.unlinkSync(dest); } catch (_) {}
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

module.exports = { request, getJson, getText, download, pool, sha1File, postJson, postForm, friendly };

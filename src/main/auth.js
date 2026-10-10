// 마이크로소프트 정품 로그인. OAuth(PKCE) → Xbox Live → XSTS → Minecraft 토큰 → 프로필.
// Azure 앱(퍼블릭 클라이언트, 개인 MS 계정 허용, 리다이렉트=nativeclient)의 client_id 가 필요하다.
//   KCC_AZURE_CLIENT_ID 환경변수 또는 설정(store) azureClientId 로 넣는다.
const { BrowserWindow, shell } = require("electron");
const crypto = require("crypto");
const net = require("./net");

const REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const AUTHZ = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE = "XboxLive.signin offline_access";

// 기본 client_id 는 저장소에 없는 src/main/client-id.js 에서 읽는다(client-id.example.js 참고).
// 배포 빌드엔 이 파일을 넣어 두고, 없으면 환경변수/설정값만 쓴다.
let DEFAULT_CLIENT_ID = "";
try { DEFAULT_CLIENT_ID = require("./client-id"); } catch (_) {}

function b64url(buf) { return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }

// 에러 메시지에 붙일 응답 본문(너무 길면 자름)
function trunc(s, n = 300) { s = (s || "").toString().replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }

function clientId(store) {
  return process.env.KCC_AZURE_CLIENT_ID || (store && store.get("azureClientId")) || DEFAULT_CLIENT_ID;
}

// 브라우저 창을 띄워 인가 코드를 받는다(PKCE).
function getAuthCode(cid, parent) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const url = `${AUTHZ}?${new URLSearchParams({
    client_id: cid, response_type: "code", redirect_uri: REDIRECT,
    scope: SCOPE, prompt: "select_account",
    code_challenge: challenge, code_challenge_method: "S256",
  })}`;
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480, height: 640, parent, modal: true, autoHideMenuBar: true,
      title: "Microsoft 로그인", webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    let done = false;
    const check = (u) => {
      if (done || !u || !u.startsWith(REDIRECT)) return;
      const q = new URL(u).searchParams;
      done = true;
      if (q.get("code")) { resolve({ code: q.get("code"), verifier }); win.close(); }
      else { reject(new Error("로그인 취소 또는 오류: " + (q.get("error_description") || q.get("error") || ""))); win.close(); }
    };
    win.webContents.on("will-redirect", (_e, u) => check(u));
    win.webContents.on("did-navigate", (_e, u) => check(u));
    win.on("closed", () => { if (!done) reject(new Error("로그인 창이 닫힘")); });
    win.loadURL(url);
  });
}

async function exchangeCode(cid, code, verifier) {
  const r = await net.postForm(TOKEN, {
    client_id: cid, grant_type: "authorization_code", code, redirect_uri: REDIRECT,
    scope: SCOPE, code_verifier: verifier,
  });
  if (r.status !== 200) throw new Error("토큰 교환 실패: " + (r.json && r.json.error_description || r.text));
  return r.json; // {access_token, refresh_token, expires_in}
}

async function refreshMs(cid, refreshToken) {
  const r = await net.postForm(TOKEN, {
    client_id: cid, grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPE,
  });
  if (r.status !== 200) throw new Error("MS 토큰 갱신 실패");
  return r.json;
}

// MS access_token → Minecraft 토큰 + 프로필
async function msToMinecraft(msAccessToken) {
  // 1) Xbox Live
  const xbl = await net.postJson("https://user.auth.xboxlive.com/user/authenticate", {
    Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccessToken },
    RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT",
  });
  if (xbl.status !== 200 || !xbl.json) throw new Error(`Xbox Live 인증 실패 (HTTP ${xbl.status}) ${trunc(xbl.text)}`);
  const xblToken = xbl.json.Token;
  const uhs = xbl.json.DisplayClaims && xbl.json.DisplayClaims.xui && xbl.json.DisplayClaims.xui[0] && xbl.json.DisplayClaims.xui[0].uhs;
  if (!xblToken || !uhs) throw new Error("Xbox Live 응답에 토큰/uhs 없음: " + trunc(xbl.text));

  // 2) XSTS
  const xsts = await net.postJson("https://xsts.auth.xboxlive.com/xsts/authorize", {
    Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
    RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT",
  });
  if (xsts.status === 401 && xsts.json && xsts.json.XErr) {
    const m = { 2148916233: "이 계정엔 Xbox 프로필이 없어요(Xbox 가입 필요).", 2148916238: "미성년 계정은 가족 그룹에 속해야 해요." };
    throw new Error(m[xsts.json.XErr] || "XSTS 오류 " + xsts.json.XErr);
  }
  if (xsts.status !== 200 || !xsts.json) throw new Error(`XSTS 인증 실패 (HTTP ${xsts.status}) ${trunc(xsts.text)}`);
  const xstsToken = xsts.json.Token;
  const xstsUhs = xsts.json.DisplayClaims && xsts.json.DisplayClaims.xui && xsts.json.DisplayClaims.xui[0] && xsts.json.DisplayClaims.xui[0].uhs;

  // 3) Minecraft 토큰 (uhs 는 XSTS 응답 것을 쓴다 — XBL 것과 다를 수 있음)
  const mc = await net.postJson("https://api.minecraftservices.com/authentication/login_with_xbox", {
    identityToken: `XBL3.0 x=${xstsUhs || uhs};${xstsToken}`,
  });
  if (mc.status !== 200 || !mc.json || !mc.json.access_token)
    throw new Error(`Minecraft 인증 실패 (HTTP ${mc.status}) ${trunc(mc.text)}`);
  const mcToken = mc.json.access_token;

  // 4) 프로필(소유 확인 겸)
  const prof = await net.request("https://api.minecraftservices.com/minecraft/profile", {
    headers: { Authorization: "Bearer " + mcToken, "User-Agent": "KoreaCom-Launcher" },
  });
  const chunks = [];
  for await (const c of prof) chunks.push(c);
  const body = Buffer.concat(chunks).toString("utf8");
  if (prof.statusCode === 404) throw new Error("이 계정은 마인크래프트(자바 에디션)를 소유하고 있지 않아요.");
  if (prof.statusCode !== 200) throw new Error(`프로필 조회 실패 (HTTP ${prof.statusCode}) ${trunc(body)}`);
  const p = JSON.parse(body);
  return { accessToken: mcToken, uuid: p.id, name: p.name };
}

// 전체 로그인. 저장용 계정 객체 반환.
async function login(store, parent) {
  const cid = clientId(store);
  if (!cid) throw new Error("Azure client_id 가 없어요. 설정에서 넣거나 KCC_AZURE_CLIENT_ID 환경변수로 지정하세요.");
  const { code, verifier } = await getAuthCode(cid, parent);
  const ms = await exchangeCode(cid, code, verifier);
  const mc = await msToMinecraft(ms.access_token);
  return {
    type: "msa",
    name: mc.name, uuid: mc.uuid, accessToken: mc.accessToken,
    msRefresh: ms.refresh_token,
    obtained: Date.now(),
  };
}

// 저장된 계정을 갱신(토큰 만료 대비). 실패하면 재로그인 필요.
async function refreshAccount(store, account) {
  const cid = clientId(store);
  if (!cid || !account.msRefresh) throw new Error("재로그인 필요");
  const ms = await refreshMs(cid, account.msRefresh);
  const mc = await msToMinecraft(ms.access_token);
  return { ...account, name: mc.name, uuid: mc.uuid, accessToken: mc.accessToken, msRefresh: ms.refresh_token || account.msRefresh, obtained: Date.now() };
}

module.exports = { login, refreshAccount, clientId };

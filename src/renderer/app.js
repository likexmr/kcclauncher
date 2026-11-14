const $ = (s) => document.querySelector(s);
const fmtMB = (b) => (b / 1048576).toFixed(b >= 1048576 * 100 ? 0 : 1) + " MB";
let state = null, remote = null, busy = false, running = false;
let lastAction = null; // 오류 카드 '다시 시도'가 다시 할 일

if (window.kcc.overlay) document.body.classList.add("overlay");

function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 3800);
}

function showError(msg, retry) {
  lastAction = retry || null;
  $("#err-txt").textContent = msg;
  $("#err-retry").classList.toggle("hidden", !retry);
  $("#err").classList.remove("hidden");
}
function clearError() { $("#err").classList.add("hidden"); }
$("#err-retry").onclick = () => { const a = lastAction; clearError(); if (a) a(); };

function avatarUrl(name) { return name ? `https://minotar.net/helm/${encodeURIComponent(name)}/88` : ""; }

// Electron 은 window.prompt 미지원 → 자체 입력창
function askText(title, def = "") {
  return new Promise((resolve) => {
    const m = $("#modal"), inp = $("#modal-input");
    $("#modal-title").textContent = title; inp.value = def;
    m.classList.remove("hidden"); inp.focus(); inp.select();
    const cleanup = () => { $("#modal-ok").onclick = null; $("#modal-cancel").onclick = null; inp.onkeydown = null; };
    const done = (v) => { m.classList.add("hidden"); cleanup(); resolve(v); };
    $("#modal-ok").onclick = () => done(inp.value.trim() || null);
    $("#modal-cancel").onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === "Enter") done(inp.value.trim() || null); if (e.key === "Escape") done(null); };
  });
}

// ---- 탭 ----
function moveInd() {
  const a = document.querySelector(".tab.active"), ind = $("#tab-ind");
  if (!a) return;
  ind.style.left = a.offsetLeft + 10 + "px";
  ind.style.width = a.offsetWidth - 20 + "px";
}
document.querySelectorAll(".tab").forEach((b) => b.onclick = () => {
  if (b.classList.contains("active")) return;
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  const v = b.dataset.view;
  $("#view-home").classList.toggle("hidden", v !== "home");
  $("#view-settings").classList.toggle("hidden", v !== "settings");
  if (window.kccScene) (v === "home" ? window.kccScene.run() : window.kccScene.stop());
  moveInd();
});
window.addEventListener("resize", moveInd);
document.fonts && document.fonts.ready.then(moveInd);

// ---- 상태 ----
async function refreshState() {
  state = await window.kcc.getState();
  renderAccount();
  renderConfig();
  updatePlay();
  $("#about").textContent = `KoreaCom Launcher v${state.appVersion}` + (state.dev ? " · 개발 모드" : "");
  renderUpdater(state.updater);
  checkVersion();
}

function renderAccount() {
  const sel = state.accounts.find((a) => a.uuid === state.selected);
  const el = $("#account");
  if (sel) {
    el.classList.remove("empty");
    $("#avatar").src = avatarUrl(sel.name);
    $("#acc-name").textContent = sel.name;
    $("#acc-type").textContent = sel.type === "msa" ? "정품 · Microsoft" : sel.type === "offline" ? "오프라인" : sel.type;
  } else {
    el.classList.add("empty");
    $("#avatar").removeAttribute("src");
    $("#acc-name").textContent = "로그인하기";
    $("#acc-type").textContent = "Microsoft 계정으로 정품 로그인";
  }
}

function renderConfig() {
  const c = state.config;
  // RAM 상한: 컴퓨터 메모리에서 2GB 는 OS 몫으로 남김(최소 2GB, 최대 16GB)
  const maxRam = Math.max(2048, Math.min(16384, Math.floor(((state.totalMemMb || 8192) - 2048) / 512) * 512));
  $("#ram").max = maxRam;
  $("#ram").value = c.ramMb; $("#ram-val").textContent = c.ramMb + " MB";
  $("#i-ram").textContent = (c.ramMb / 1024).toFixed(c.ramMb % 1024 ? 1 : 0) + " GB";
  $("#gameDir").value = c.gameDir || "";
  $("#javaPath").value = c.javaPath || "";
  $("#azureClientId").value = c.azureClientId || "";
  $("#site").value = c.site || "";
  document.querySelectorAll("#after button").forEach((b) => b.classList.toggle("on", b.dataset.v === c.afterLaunch));
}

// ---- 계정 메뉴 ----
$("#acc-menu-btn").onclick = (e) => { e.stopPropagation(); toggleAccMenu(); };
$("#account").onclick = (e) => { if ($("#account").classList.contains("empty") && !e.target.closest(".menu")) doLogin(); };
document.body.addEventListener("click", () => $("#acc-menu").classList.add("hidden"));

function toggleAccMenu() {
  const m = $("#acc-menu");
  if (!m.classList.contains("hidden")) { m.classList.add("hidden"); return; }
  m.innerHTML = "";
  const item = (html, cls, fn) => {
    const b = document.createElement("button");
    if (cls) b.className = cls;
    b.innerHTML = html;
    b.onclick = async (e) => { e.stopPropagation(); m.classList.add("hidden"); await fn(); };
    m.appendChild(b);
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  state.accounts.forEach((a) => item(
    `<img src="${avatarUrl(a.name)}"><span>${esc(a.name)}</span>` + (a.uuid === state.selected ? `<i class="sel"></i>` : ""), "",
    async () => { await window.kcc.selectAccount(a.uuid); await refreshState(); }));
  if (state.accounts.length) m.appendChild(document.createElement("hr"));
  item("+ 정품 로그인 (Microsoft)", "add", doLogin);
  if (state.dev) item("+ 오프라인 계정 (개발)", "", async () => {
    const n = await askText("오프라인 이름", "Tester");
    if (n) { await window.kcc.offlineAccount(n); await refreshState(); }
  });
  const sel = state.accounts.find((a) => a.uuid === state.selected);
  if (sel) item("이 계정 로그아웃", "danger", async () => { await window.kcc.removeAccount(sel.uuid); await refreshState(); });
  m.classList.remove("hidden");
}

async function doLogin() {
  try { toast("로그인 창을 여는 중…"); await window.kcc.login(); await refreshState(); toast("로그인 완료"); }
  catch (e) { toast(e.message || "로그인 실패", true); }
}

// ---- 버전 ----
async function checkVersion() {
  const btn = $("#refresh");
  btn.classList.add("spin");
  $("#build-line").textContent = "버전 확인 중…";
  const r = await window.kcc.checkVersion();
  btn.classList.remove("spin");
  remote = r.remote || null;
  const inst = r.installedBuild || 0;
  $("#i-installed").textContent = inst && r.installed ? "b" + inst : "없음";
  $("#i-latest").textContent = remote ? "b" + remote.build : "—";
  $("#i-latest").className = remote && remote.build > inst ? "new" : remote ? "ok" : "";
  if (!r.ok) {
    $("#build-line").innerHTML = inst ? `b${inst} · <span class="bad">사이트 연결 안 됨</span>` : `<span class="bad">사이트 연결 안 됨</span>`;
    $("#build-line").title = r.error || "";
  } else if (remote && remote.build > inst) {
    $("#build-line").innerHTML = inst ? `b${inst} → <span class="new">b${remote.build} 업데이트</span>` : `<span class="new">b${remote.build} 설치 필요</span>`;
  } else if (inst) {
    $("#build-line").innerHTML = `<span class="ok">b${inst}</span> · 최신`;
  } else {
    $("#build-line").textContent = remote ? `b${remote.build}` : "설치 필요";
  }
  updatePlay();
}

function setProgress(p) {
  const play = $("#play");
  play.style.setProperty("--p", p == null ? 0 : Math.max(0, Math.min(1, p)));
  play.classList.toggle("has-p", p != null && p > 0);
}

function updatePlay() {
  const hasAcc = state && state.accounts.length > 0;
  const p = $("#play"), label = $("#play-label"), sub = $("#play-sub");
  p.classList.remove("busy", "running", "off");
  $("#kill").classList.toggle("hidden", !running);
  if (running) { label.textContent = "실행 중"; sub.textContent = "런처를 닫아도 게임은 계속돼요"; p.disabled = true; p.classList.add("running"); setProgress(null); return; }
  if (busy) { p.disabled = true; p.classList.add("busy"); return; }
  setProgress(null);
  if (!hasAcc) { label.textContent = "로그인 필요"; sub.textContent = "오른쪽에서 계정을 추가하세요"; p.disabled = true; p.classList.add("off"); return; }
  const needInstall = !state.installed || (remote && remote.build > (state.config.installedBuild || 0));
  label.textContent = needInstall ? (state.installed ? "업데이트하고 플레이" : "설치하고 플레이") : "플레이";
  sub.textContent = needInstall && remote ? `b${remote.build}` : "";
  p.disabled = false;
}

// ---- 런처 업데이트 ----
let lastUpd = null, checkingByHand = false;
function renderUpdater(u) {
  lastUpd = u || { status: "idle" };
  const pill = $("#upd-pill");
  pill.disabled = false;
  switch (lastUpd.status) {
    case "downloading":
      pill.textContent = `런처 업데이트 받는 중 ${lastUpd.percent || 0}%`; pill.disabled = true; pill.onclick = null; break;
    case "ready":
      pill.textContent = `런처 v${lastUpd.version} 적용하기`;
      pill.onclick = async () => { const r = await window.kcc.installLauncherUpdate(); if (!r.ok) toast(r.error, true); };
      break;
    case "manual":
      pill.textContent = `런처 v${lastUpd.version} 받기`;
      pill.onclick = () => window.kcc.openReleases(lastUpd.url);
      break;
    default:
      pill.classList.add("hidden"); return;
  }
  pill.classList.remove("hidden");
}
window.kcc.on("updater", (u) => {
  const was = lastUpd && lastUpd.status;
  renderUpdater(u);
  if (u.status === "ready" && was !== "ready") toast(`런처 v${u.version} 업데이트를 받았어요`);
  if (checkingByHand && ["none", "error", "ready", "manual", "downloading"].includes(u.status)) {
    checkingByHand = false;
    if (u.status === "none") toast(u.dev ? "개발 실행에선 업데이트 확인 안 함" : "런처가 최신이에요");
    if (u.status === "error") toast("업데이트 확인 실패: " + (u.error || ""), true);
  }
});
$("#check-launcher").onclick = () => { checkingByHand = true; window.kcc.checkLauncherUpdate(); };

// ---- 진행률·로그 ----
window.kcc.on("stage", (s) => { if (s !== "오류") $("#stage").textContent = s; if (busy) $("#play-label").textContent = s; });
let speedMark = { t: 0, bytes: 0 }, speedTxt = "";
window.kcc.on("progress", (p) => {
  const total = p.total || 0, received = p.received || 0;
  const pct = total ? Math.min(100, (received / total) * 100) : 0;
  const now = performance.now();
  if (now - speedMark.t > 1000 || received < speedMark.bytes) {
    if (speedMark.t && received >= speedMark.bytes) speedTxt = `${((received - speedMark.bytes) / 1048576 / ((now - speedMark.t) / 1000)).toFixed(1)} MB/s`;
    speedMark = { t: now, bytes: received };
  }
  if (busy) {
    setProgress(total ? pct / 100 : null);
    $("#play-sub").textContent = total ? `${pct.toFixed(0)}%` : fmtMB(received);
    if (p.phase) $("#play-label").textContent = p.phase;
  }
  const what = p.label || p.phase || "";
  $("#prog-txt").textContent = (total ? `${what} ${fmtMB(received)} / ${fmtMB(total)}` : `${what} ${fmtMB(received)}`) + (speedTxt ? ` · ${speedTxt}` : "");
});

const LOG_MAX = 120000;
let logBuf = "";
function renderLog() {
  const log = $("#log");
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.textContent = logBuf;
  if (stick) log.scrollTop = log.scrollHeight;
}
let logPending = false;
window.kcc.on("log", (l) => {
  logBuf += l;
  if (logBuf.length > LOG_MAX) logBuf = logBuf.slice(-LOG_MAX + 20000);
  if (!logPending && $("#drawer").classList.contains("open")) { logPending = true; requestAnimationFrame(() => { logPending = false; renderLog(); }); }
});
function openLog(open) {
  $("#drawer").classList.toggle("open", open);
  if (open) { renderLog(); const log = $("#log"); log.scrollTop = log.scrollHeight; }
}
$("#toggle-log").onclick = () => openLog(!$("#drawer").classList.contains("open"));
$("#close-log").onclick = () => openLog(false);
$("#open-log").onclick = () => window.kcc.openGameLog();

window.kcc.on("game:started", () => {
  running = true; busy = false; clearError(); updatePlay();
  $("#stage").textContent = "게임이 켜졌어요"; $("#prog-txt").textContent = "";
});
window.kcc.on("game:exit", (e) => {
  const code = typeof e === "object" ? e.code : e;
  running = false; busy = false; updatePlay();
  $("#prog-txt").textContent = "";
  if (code === 0 || code === null) { $("#stage").textContent = "게임 종료"; return; }
  // 비정상 종료: 로그를 펼쳐 마지막 오류가 보이게
  $("#stage").textContent = `게임이 비정상 종료됐어요 (코드 ${code})`;
  showError("게임이 튕겼어요. 문의할 땐 로그 파일을 같이 보내 주세요.", null);
  openLog(true);
});

// ---- 플레이 ----
async function play() {
  clearError();
  busy = true; updatePlay(); setProgress(null);
  logBuf = ""; renderLog();
  $("#play-label").textContent = "준비 중"; $("#play-sub").textContent = "";
  $("#stage").textContent = "시작하는 중…"; $("#prog-txt").textContent = "";
  speedMark = { t: 0, bytes: 0 }; speedTxt = "";
  const r = await window.kcc.launch();
  if (!r.ok) {
    busy = false; updatePlay();
    $("#stage").innerHTML = "&nbsp;"; $("#prog-txt").textContent = "";
    showError(r.error || "실행하지 못했어요.", play);
    checkVersion();
  }
}
$("#play").onclick = play;
$("#kill").onclick = () => window.kcc.kill();
$("#refresh").onclick = () => checkVersion();
$("#open-gamedir").onclick = () => window.kcc.openGameDir();
$("#open-gamedir2").onclick = () => window.kcc.openGameDir();
$("#open-site").onclick = () => window.kcc.openExternal((state && state.config.site) || "https://korcomclient.xyz");

// ---- 설정(바꾸면 바로 저장) ----
async function save(patch) {
  await window.kcc.setConfig(patch);
  state = await window.kcc.getState();
  renderConfig(); updatePlay();
}
$("#ram").oninput = () => { $("#ram-val").textContent = $("#ram").value + " MB"; };
$("#ram").onchange = () => save({ ramMb: parseInt($("#ram").value, 10) });
document.querySelectorAll("#after button").forEach((b) => b.onclick = () => save({ afterLaunch: b.dataset.v }));
for (const id of ["gameDir", "javaPath", "azureClientId", "site"]) {
  $("#" + id).onchange = () => {
    let v = $("#" + id).value.trim();
    if (id === "site" && !v) v = "https://korcomclient.xyz";
    save({ [id]: v }).then(() => { if (id === "site") checkVersion(); toast("저장됨"); });
  };
}
$("#pick-java").onclick = async () => { const p = await window.kcc.pickJava(); if (p) { $("#javaPath").value = p; save({ javaPath: p }); } };

async function install(opts) {
  if (busy || running) return;
  document.querySelector('.tab[data-view="home"]').click();
  clearError();
  busy = true; updatePlay(); setProgress(null);
  $("#play-label").textContent = "설치 중";
  const r = await window.kcc.install(opts);
  busy = false; await refreshState();
  if (r.ok) { toast(`설치 완료 (b${r.build || "?"})`); $("#stage").textContent = "설치 완료"; }
  else showError(r.error || "설치하지 못했어요.", () => install(opts));
}
$("#reinstall").onclick = () => install({});
$("#import-zip").onclick = async () => { const zip = await window.kcc.pickZip(); if (zip) install({ localZip: zip }); };

refreshState().then(moveInd);

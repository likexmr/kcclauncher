const $ = (s) => document.querySelector(s);
const fmtMB = (b) => (b / 1048576).toFixed(0) + " MB";
let state = null, remote = null, busy = false, running = false;

function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), 3800);
}

function avatarUrl(name) { return name ? `https://minotar.net/avatar/${encodeURIComponent(name)}/64` : ""; }

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

// ---- 화면 전환 ----
document.querySelectorAll(".nav-item").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".nav-item").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  const v = b.dataset.view;
  $("#view-home").classList.toggle("hidden", v !== "home");
  $("#view-settings").classList.toggle("hidden", v !== "settings");
});

// ---- 상태 로드 ----
async function refreshState() {
  state = await window.kcc.getState();
  renderAccount();
  renderConfig();
  updatePlay();
  $("#about").textContent = `KoreaCom Launcher v${state.appVersion}` + (state.dev ? " · 개발 모드" : "");
  checkVersion();
}

function renderAccount() {
  const sel = state.accounts.find((a) => a.uuid === state.selected);
  const el = $("#account");
  if (sel) {
    el.classList.remove("empty");
    $("#avatar").src = avatarUrl(sel.name);
    $("#acc-name").textContent = sel.name;
    $("#acc-type").textContent = sel.type === "msa" ? "정품 (Microsoft)" : sel.type === "offline" ? "오프라인" : sel.type;
  } else {
    el.classList.add("empty");
    $("#avatar").removeAttribute("src");
    $("#acc-name").textContent = "로그인 안 됨";
    $("#acc-type").textContent = "계정을 추가하세요";
  }
}

function renderConfig() {
  const c = state.config;
  $("#ram").value = c.ramMb; $("#ram-val").textContent = c.ramMb + " MB";
  $("#gameDir").value = c.gameDir || "";
  $("#javaPath").value = c.javaPath || "";
  $("#azureClientId").value = c.azureClientId || "";
  $("#site").value = c.site || "";
  $("#closeOnLaunch").checked = !!c.closeOnLaunch;
}

// ---- 계정 메뉴 ----
$("#acc-menu-btn").onclick = (e) => { e.stopPropagation(); buildAccMenu(); };
document.body.addEventListener("click", () => $("#acc-menu").classList.add("hidden"));

function buildAccMenu() {
  const m = $("#acc-menu");
  m.innerHTML = "";
  state.accounts.forEach((a) => {
    const b = document.createElement("button");
    b.className = "acc-row";
    b.innerHTML = `<img src="${avatarUrl(a.name)}"><span>${a.name}</span>`;
    if (a.uuid === state.selected) b.innerHTML += ` <span style="margin-left:auto;color:var(--accent)">●</span>`;
    b.onclick = async (e) => { e.stopPropagation(); await window.kcc.selectAccount(a.uuid); await refreshState(); m.classList.add("hidden"); };
    m.appendChild(b);
  });
  if (state.accounts.length) m.appendChild(document.createElement("hr"));
  const add = document.createElement("button");
  add.textContent = "+ 정품 로그인 (Microsoft)";
  add.onclick = async (e) => { e.stopPropagation(); m.classList.add("hidden"); doLogin(); };
  m.appendChild(add);
  if (state.dev) {
    const off = document.createElement("button");
    off.textContent = "+ 오프라인 계정 (개발)";
    off.onclick = async (e) => { e.stopPropagation(); m.classList.add("hidden"); const n = await askText("오프라인 이름", "Tester"); if (n) { await window.kcc.offlineAccount(n); await refreshState(); } };
    m.appendChild(off);
  }
  const sel = state.accounts.find((a) => a.uuid === state.selected);
  if (sel) {
    const rm = document.createElement("button");
    rm.className = "danger"; rm.textContent = "현재 계정 제거";
    rm.onclick = async (e) => { e.stopPropagation(); m.classList.add("hidden"); await window.kcc.removeAccount(sel.uuid); await refreshState(); };
    m.appendChild(rm);
  }
  m.classList.remove("hidden");
}

async function doLogin() {
  try { toast("로그인 창을 여는 중…"); await window.kcc.login(); await refreshState(); toast("로그인 완료"); }
  catch (e) { toast(e.message || "로그인 실패", true); }
}

// ---- 버전 확인 ----
async function checkVersion() {
  $("#build-line").textContent = "버전 확인 중…";
  const r = await window.kcc.checkVersion();
  remote = r.remote || null;
  const inst = r.installedBuild || 0;
  if (!r.ok) {
    $("#build-line").innerHTML = inst ? `설치됨 b${inst} · <span class="new">사이트 연결 실패</span>` : `<span class="new">사이트에 연결할 수 없어요</span>`;
  } else if (remote && remote.build > inst) {
    $("#build-line").innerHTML = inst ? `설치됨 b${inst} · <span class="new">새 버전 b${remote.build} 있음</span>` : `<span class="new">최신 b${remote.build} 설치 필요</span>`;
  } else if (inst) {
    $("#build-line").innerHTML = `설치됨 <span class="ok">b${inst}</span> · 최신`;
  } else {
    $("#build-line").textContent = remote ? `최신 b${remote.build}` : "설치 필요";
  }
  updatePlay();
}

function updatePlay() {
  const hasAcc = state && state.accounts.length > 0;
  const p = $("#play"), label = $("#play-label");
  if (running) { label.textContent = "실행 중…"; p.disabled = true; p.classList.add("busy"); $("#kill").classList.remove("hidden"); return; }
  $("#kill").classList.add("hidden");
  p.classList.toggle("busy", busy);
  if (busy) { p.disabled = true; return; }
  if (!hasAcc) { label.textContent = "로그인 필요"; p.disabled = true; return; }
  const needInstall = !state.installed || (remote && remote.build > (state.config.installedBuild || 0));
  label.textContent = needInstall ? "설치하고 플레이" : "플레이";
  p.disabled = false;
}

// ---- 진행률/로그 이벤트 ----
window.kcc.on("stage", (s) => { $("#stage").textContent = s; });
window.kcc.on("progress", (p) => {
  const pct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0;
  $("#bar-fill").style.width = pct + "%";
  $("#prog-txt").textContent = p.total ? `${(p.label || "")} ${fmtMB(p.received)} / ${fmtMB(p.total)} (${pct.toFixed(0)}%)` : `${p.label || ""} ${fmtMB(p.received)}`;
});
window.kcc.on("log", (l) => {
  const log = $("#log"); log.textContent += l;
  if (log.textContent.length > 60000) log.textContent = log.textContent.slice(-50000);
  log.scrollTop = log.scrollHeight;
});
window.kcc.on("game:started", () => { running = true; busy = false; updatePlay(); $("#stage").textContent = "게임이 실행됐어요"; });
window.kcc.on("game:exit", (code) => {
  running = false; busy = false; updatePlay();
  $("#stage").textContent = code === 0 ? "게임 종료" : `게임 종료 (코드 ${code})`;
  $("#bar-fill").style.width = "0%"; $("#prog-txt").textContent = "";
});

// ---- 플레이 ----
$("#play").onclick = async () => {
  busy = true; updatePlay(); $("#log").textContent = ""; $("#stage").textContent = "시작…";
  const r = await window.kcc.launch();
  if (!r.ok) { busy = false; updatePlay(); $("#stage").textContent = "—"; toast(r.error || "실행 실패", true); }
};
$("#kill").onclick = () => window.kcc.kill();
$("#refresh").onclick = () => checkVersion();

// ---- 로그 토글 ----
$("#toggle-log").onclick = () => {
  const log = $("#log"), hidden = log.classList.toggle("hidden");
  $("#toggle-log").textContent = hidden ? "보이기" : "숨기기";
};

// ---- 설정 ----
$("#ram").oninput = () => $("#ram-val").textContent = $("#ram").value + " MB";
$("#pick-java").onclick = async () => { const p = await window.kcc.pickJava(); if (p) $("#javaPath").value = p; };
$("#open-gamedir").onclick = () => window.kcc.openGameDir();
$("#save-settings").onclick = async () => {
  await window.kcc.setConfig({
    ramMb: parseInt($("#ram").value, 10),
    gameDir: $("#gameDir").value.trim(),
    javaPath: $("#javaPath").value.trim(),
    azureClientId: $("#azureClientId").value.trim(),
    site: $("#site").value.trim() || "https://korcomclient.xyz",
    closeOnLaunch: $("#closeOnLaunch").checked,
  });
  $("#saved").classList.remove("hidden"); setTimeout(() => $("#saved").classList.add("hidden"), 1600);
  await refreshState();
};
$("#reinstall").onclick = async () => {
  busy = true; updatePlay(); $("#log").classList.remove("hidden"); $("#toggle-log").textContent = "숨기기";
  const r = await window.kcc.install({});
  busy = false; await refreshState();
  toast(r.ok ? `설치 완료 (b${r.build})` : (r.error || "설치 실패"), !r.ok);
};
$("#import-zip").onclick = async () => {
  const zip = await window.kcc.pickZip(); if (!zip) return;
  busy = true; updatePlay();
  const r = await window.kcc.install({ localZip: zip });
  busy = false; await refreshState();
  toast(r.ok ? `설치 완료 (b${r.build || "?"})` : (r.error || "설치 실패"), !r.ok);
};

refreshState();

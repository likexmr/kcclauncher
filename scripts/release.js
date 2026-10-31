// 런처 출시: 빌드 + GitHub Releases(likexmr/kcclauncher)에 올리기 → 설치된 런처들이 자동 업데이트로 받음.
//   1) package.json version 올리기(예: 1.0.1 → 1.0.2)
//   2) npm run release           (윈도우: 설치판+포터블 / 리눅스: AppImage+tar.gz)
// GitHub 토큰은 GH_TOKEN 환경변수, 없으면 `gh auth token`.
// 정품 로그인용 src/main/client-id.js(.gitignore)가 없으면 멈춘다 — 그대로 내보내면 로그인이 안 되는 런처가 나감.
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
if (!fs.existsSync(path.join(root, "src", "main", "client-id.js"))) {
  console.error("src/main/client-id.js 가 없음 (client-id.example.js 참고)");
  process.exit(1);
}
let token = process.env.GH_TOKEN;
if (!token) {
  try { token = execSync("gh auth token", { encoding: "utf8" }).trim(); } catch (_) {}
}
if (!token) { console.error("GH_TOKEN 이 없고 gh 로그인도 안 돼 있음"); process.exit(1); }

const target = process.platform === "win32" ? "--win" : process.platform === "linux" ? "--linux" : null;
if (!target) { console.error("윈도우·리눅스에서만"); process.exit(1); }
const version = require(path.join(root, "package.json")).version;
console.log(`KoreaCom Launcher v${version} ${target} 빌드 → GitHub 릴리스 v${version}`);
const r = spawnSync("npx", ["electron-builder", target, "--publish", "always"], {
  cwd: root, stdio: "inherit", shell: true, env: { ...process.env, GH_TOKEN: token },
});
process.exit(r.status || 0);

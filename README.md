# KoreaCom Launcher

[KoreaCom Client](https://korcomclient.xyz)(마인크래프트 1.8.8) 전용 런처입니다. Electron 기반, Windows · Linux 지원.

## 기능

- **마이크로소프트 정품 로그인**: OAuth 2.0(PKCE) → Xbox Live → XSTS → Minecraft 순서로 인증하고, 토큰이 오래되면 자동으로 갱신합니다.
- **자바 8 자동 관리**: 설정한 자바가 없으면 [Adoptium Temurin](https://adoptium.net) 8 JRE를 내려받습니다. 실제로 실행되는지 확인한 뒤에만 반영해서, 설치가 중간에 끊겨도 깨진 JRE가 남지 않습니다.
- **클라이언트 설치 · 자동 업데이트**: 사이트에서 최신 빌드를 받아 설치하고, 빌드 번호가 바뀌면 다시 받습니다. 로컬 zip으로도 설치할 수 있습니다.
- **자립형 인스턴스**: 라이브러리 · 네이티브 · 에셋을 모두 받아 런처 전용 폴더에서 실행하므로 기존 `.minecraft`에 영향을 주지 않습니다. 받은 파일은 모두 sha1로 검증합니다.

## 시작하기

Node.js 18 이상이 필요합니다.

```bash
npm install
npm start          # 일반 실행
npm run dev        # 개발 모드(KCC_DEV=1): 오프라인 계정, DevTools
```

## 빌드

```bash
npm run dist:win     # Windows: NSIS 설치본 + 포터블 exe
npm run dist:linux   # Linux: AppImage + tar.gz
```

결과물은 `dist/` 폴더에 생성됩니다.

## 정품 로그인 설정 (Azure client_id)

정품 로그인을 쓰려면 Azure에 등록한 앱의 client_id가 필요합니다. 공식 client_id는 저장소에 포함되어 있지 않습니다.

1. [Azure 포털](https://portal.azure.com) → 앱 등록 → 새 등록
   - 지원되는 계정 유형: **개인 Microsoft 계정** 포함
   - 리다이렉트 URI: 플랫폼 **퍼블릭 클라이언트/네이티브**, 값 `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. 인증 탭에서 **퍼블릭 클라이언트 흐름 허용**을 켭니다. client secret은 필요 없습니다.
3. 새로 등록한 앱이 Minecraft API를 쓰려면 Mojang 승인이 필요합니다. [신청 양식](https://aka.ms/mce-reviewappid)을 제출하세요.

client_id는 아래 셋 중 하나로 지정합니다. 위에 있는 방법이 우선합니다.

| 방법 | 예시 |
|---|---|
| 환경변수 | `KCC_AZURE_CLIENT_ID=xxxxxxxx-... npm start` |
| 런처 설정 화면 | 설정 → "Azure 앱 client_id" |
| 빌드에 내장 | `src/main/client-id.example.js`를 `src/main/client-id.js`로 복사한 뒤 값 입력 (`.gitignore`에 포함됨) |

## 구조

```
src/
├─ main/            # Electron 메인 프로세스
│  ├─ main.js       # 창 생성, 단일 인스턴스
│  ├─ ipc.js        # 렌더러 ↔ 메인 통신
│  ├─ auth.js       # MS → Xbox → XSTS → Minecraft 인증
│  ├─ installer.js  # 클라이언트 · 라이브러리 · 네이티브 · 에셋 설치
│  ├─ java.js       # 자바 8 탐색 / 다운로드
│  ├─ launch.js     # 클래스패스 · 인자 구성 후 실행
│  ├─ net.js        # 다운로드(sha1 검증, 동시성 제한), HTTP 헬퍼
│  ├─ paths.js      # 데이터 폴더 경로
│  └─ store.js      # 설정 · 계정 저장(electron-store)
├─ preload/         # contextBridge API (window.kcc)
└─ renderer/        # UI (HTML/CSS/JS)
```

데이터 폴더 위치:

- Windows: `%APPDATA%\KoreaCom Launcher`
- Linux: `~/.config/KoreaCom Launcher`

### 클라이언트 배포 서버 API

런처는 설정된 사이트(기본값 `https://korcomclient.xyz`)에 다음을 요청합니다.

- `GET /api/version` → `{ "build": 12, "file": "KoreaCom-b12.zip", "size": 12345678 }`
- `GET /download/<file>` → `KoreaCom.json`(버전 json)과 `KoreaCom.jar`가 들어 있는 zip

## 라이선스

[WTFPL](LICENSE)

- [Pretendard](https://github.com/orioncactus/pretendard) 폰트는 SIL Open Font License 1.1을 따릅니다. 원문은 `src/renderer/fonts/OFL.txt`에 있습니다.
- Minecraft는 Mojang Studios의 상표입니다. 이 프로젝트는 Mojang · Microsoft와 관련이 없습니다.

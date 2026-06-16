# 레이저 리플렉트 (Laser Reflect)

전자칠판용 2D 레이저 반사 퍼즐 게임. 거울을 회전시켜 레이저를 장애물 너머 타깃까지 굴절시키는 **2팀 대항** 방식의 게임입니다. 단일 `<canvas>` 앱으로, 호스팅 플랫폼(타이핑엑스/alparka)의 iframe 안에 임베드되어 `postMessage`로 부모창과 통신합니다.

- **해상도**: 논리 좌표계 1280×800 고정 (화면 크기에 맞춰 레터박스 스케일링)
- **모든 UI/게임 텍스트**: 한국어
- **기획 원본**: `기획안.md`

---

## 🚀 빠른 실행 (대표님용 — Live Server)

> ⚠️ **`index.html`을 더블클릭(`file://`)으로 열면 안 됩니다.** 게임이 `data.json`을 `fetch`로 불러오기 때문에 반드시 **로컬 서버**로 열어야 합니다. 또 외부 라이브러리(three, howler 등)와 폰트를 CDN에서 받으므로 **인터넷 연결**이 필요합니다.

### 방법 A — VS Code Live Server (가장 쉬움)

1. **VS Code** 설치 → 확장(Extensions)에서 **`Live Server`** (작성자: Ritwick Dey) 설치
2. VS Code에서 이 프로젝트 폴더를 엽니다 (`File ▸ Open Folder…`)
3. 좌측 탐색기에서 **`app/index.html`** 우클릭 → **`Open with Live Server`**
4. 브라우저가 자동으로 열리고 게임이 실행됩니다 (예: `http://127.0.0.1:5500/app/index.html`)

### 방법 B — 터미널 (Python / Node)

`app/` 폴더 안에서 정적 서버를 띄우고 브라우저로 접속합니다.

```bash
cd app

# Python 3가 있으면
python3 -m http.server 8080
#  → http://localhost:8080  접속

# 또는 Node가 있으면
npx serve .
#  → 출력되는 주소로 접속
```

---

## 🗂 폴더 구조

배포·실행에 필요한 실제 앱은 전부 **`app/`** 안에 있습니다.

```
app/
├── index.html          ← 진입점 (Live Server로 이 파일을 엶)
├── main.js             ← 빌드 산출물(자동 생성). 실제로 실행되는 코드. 직접 수정 금지
├── data.json           ← 런타임 설정(라운드/팀/점수/난이도/UI 텍스트)
├── style.css
├── assets/             ← 스프라이트·폰트·오디오·썸네일
│   └── title/          ← 타이틀 화면 아트 + layout.json
│
├── main.ts             ← (개발용) 부트스트랩 + 플랫폼 연동
├── app.ts              ← (개발용) 게임 로직 전체 (~3300줄)
├── appHelper.ts        ← (개발용) 유틸리티
└── tsconfig.json
```

`index.html`, `main.js`, `data.json`, `style.css`, `assets/`만 있으면 **실행됩니다.** `*.ts`는 소스 수정 시에만 필요합니다.

---

## 🛠 소스 수정 후 재빌드 (개발자용)

`main.js`는 **손으로 고치지 않습니다.** TypeScript 소스(`main.ts`/`app.ts`/`appHelper.ts`)를 고친 뒤 esbuild로 다시 번들합니다. CDN 라이브러리는 `index.html`의 `<script type="importmap">`에서 런타임에 해석되므로 **external로 둡니다.**

```bash
npx esbuild app/main.ts --bundle --format=esm --outfile=app/main.js --packages=external
```

> 새 라이브러리를 `import` 하려면 `index.html`의 importmap에도 반드시 추가해야 브라우저에서 동작합니다 (esbuild가 해당 import를 해석하지 않고 그대로 두기 때문).

---

## 🌐 플랫폼(타이핑엑스) 임베드 메모

- 부모창(`source: "alparka-parent"`)의 `ping`/`request-canvas-capture`/`request-app-resolution` 요청에 응답하며, 회신에는 항상 `source: "typingx-x-iframe"`를 붙입니다.
- 키보드 입력은 호스트 iframe이 가로채지 못하도록 캡처 단계에서 등록됩니다.
- 썸네일 캡처를 위해 `canvas.getContext`에 `preserveDrawingBuffer`를 강제합니다.

---

## 📋 외부 의존성 (모두 CDN, 인터넷 필요)

`index.html` importmap에 선언됨: `three`, `cannon-es`, `howler`, `tone`, `gsap`, `mathjs`, `canvas-confetti`, `html-to-image`.
실제로 번들에 import되는 것은 `canvas-confetti`(결과 화면), `html-to-image`(캡처) 2개입니다. 폰트는 Pretendard(로컬 woff2) + Gmarket Sans(CDN)를 사용합니다.

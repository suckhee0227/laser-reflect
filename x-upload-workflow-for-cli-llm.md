# X 다운로드 → 로컬 수정 → 업로드 워크플로우 (CLI LLM 작업 지침서)

> **이 문서의 목적**
>
> TypingX(alparka) 서비스에서 다운로드한 X(앱) 폴더를, 로컬에서 CLI LLM(예: Claude Code, Cursor)으로 수정한 뒤,
> 어드민 업로드 API(`POST /admin/xs/upload`)를 이용해 **새 앱의 v2-1 버전**으로 올리고,
> 업로드 이후에도 스튜디오의 **리스토어/버전편집/리믹스 기능이 정상 동작**하도록 유지하기 위한
> 전 과정 지침입니다.
>
> CLI LLM이 이 문서만 보고도 추가 탐색 없이 작업을 완수할 수 있도록 작성되었습니다.
> 본문·설명은 한국어, JSON 필드명·파일 경로·코드 스니펫은 영문 원본 그대로 둡니다.

---

## 0. 핵심 용어 (외부 ↔ 내부 네이밍)

| 외부 (다운로드 zip, API, 프런트) | 내부 (서버 코드·DB) | 설명 |
|---|---|---|
| `x`, `x_id`, `x_name` | `app`, `app_id`, `app_name` | 단수 (X = 앱 하나) |
| `xs` | `apps` | 복수 |
| `mongo_app_id` | `mongo_app_id` | X의 문자열 식별자 (예: `20260416101005_fedb0311-1c27-40ac-b4d5-930f0b2803b0`). app_metadata.json의 `id` 값과 동일 |
| `version_name` | `version` | 버전 표기 (`v1-1`, `v2-1`, …) |
| `version_id` | `id` (UUID, `app_versions.id`) | 버전 행의 PK UUID |

이 문서에서는 외부 zip 기준으로 설명하므로 **`x_id` = 다운로드 폴더 루트의 `app_metadata.json` 안의 `id`** 로 보면 된다.

---

## 1. 배경 — 다운로드 zip 안의 정보는 어디서 왔나

어드민 다운로드(`GET /admin/xs/{x_id}/download`)는 다음을 ZIP으로 묶어 내려준다.

| 항목 | 출처 | 신뢰도 |
|---|---|---|
| 루트 코드/데이터 파일 (`app.ts`, `main.ts`, `main.js`, `index.html`, `style.css`, `data.json`, `appHelper.ts`, `tsconfig.json`) | EFS (`BASE_PUBLIC_DIR/{mongo_app_id}/`) 현재 파일 그대로 | 현재 활성 버전의 실제 바이트 |
| `assets/**` | 같음 | 동일 |
| `archive/v{N}-{M}/files/**` | 같음 (각 버전에서 변경·추가된 파일의 델타) | 동일 |
| `archive/v{N}-{M}/meta.json` | **DB `app_versions` 테이블에서 재생성** (`_inject_db_metadata`) | DB 기준 진실 소스 |
| `archive/change_log.json` | **DB `apps`·`app_versions`에서 재생성** | DB 기준 진실 소스 |
| `app_metadata.json` | **DB `apps` 테이블에서 재생성** | DB 기준 진실 소스 |
| `chat.json` | **DB `chat_histories` 테이블에서 재생성** | DB 기준 진실 소스 |

즉 `meta.json` / `change_log.json` / `app_metadata.json` / `chat.json`은 EFS 파일이 아니라 **DB 스냅샷**이다. 따라서 로컬에서 수정한 결과를 서버에 다시 반영하려면 **파일뿐 아니라 이 4종 메타파일도 새 버전 기준으로 재작성**해야 한다.

(참고: 구현 위치 — `alparka-back/app/api/admin/apps.py` 의 `_inject_db_metadata` 함수, 837–902행)

---

## 2. 작업자 흐름 개요

```
┌──────────────────────────────────────────────────────────────────────┐
│  1) 어드민 페이지에서 X를 다운로드 (ZIP)                             │
│         ↓ ZIP 해제                                                   │
│  2) CLI LLM이 로컬에서 파일을 수정                                   │
│         (코드·데이터 내용 수정 / 에셋 추가·삭제·교체 등)             │
│         ↓                                                            │
│  3) v2-1 패키징: archive/v2-1/ 폴더 생성 + change_log.json 갱신      │
│         (해시 재계산, meta.json 생성, v2-1/files/에 복사)            │
│         ↓                                                            │
│  4) 어드민 업로드 API로 폴더 전체 POST                               │
│         (/admin/xs/upload, multipart: title, files[], paths[])       │
│         ↓                                                            │
│  5) 서버가 새 mongo_app_id 발급 + archive 전체를 DB로 복원           │
│         → 새 X가 생성되고, v1-1 / v2-1 두 버전이 모두 DB에 존재      │
│         → active_version_id = v2-1                                   │
│         → 스튜디오에서 열면 v2-1이 활성화, v1-1로 리스토어 가능      │
└──────────────────────────────────────────────────────────────────────┘
```

중요:

- **원본 X는 그대로 살아있다.** 업로드는 항상 **새 `x_id`**를 발급받아 별도의 앱으로 저장된다. 원본 앱에 v2-1을 추가하는 것이 아니다.
- 업로드 시 author는 요청을 보낸 **어드민 본인**으로 설정된다. 원저자는 보존되지 않는다. (원저자 이름 표시가 필요하면 업로드 후 별도로 `update_app_metadata` 엔드포인트를 사용)
- **업로드 직후 상태는 비공개(unpublished)이다.** 이는 **의도된 설계**이다. 구체적으로:
  - `apps.is_published = False` (`app_content.py:70` 기본값, `create_app` 호출 시 미전달하므로 유지됨)
  - `apps.approval_status = ApprovalStatus.NONE` (`app_content.py:78` 기본값)
  - 아케이드/홈/추천 리스트의 모든 조회 쿼리는 최소 `is_published=True`를 요구하며 (일부 쿼리는 추가로 `approval_status IN (APPROVED, PENDING+approved_at)`도 요구한다. `app_repository.py`의 `search_by_category`·`search_arcade_paginated`·`search_by_category_approved` 참고), 업로드 직후의 X는 둘 다 통과하지 못해 **아케이드·홈·추천 어디에도 노출되지 않는다**.
  - 스튜디오 URL(`/studio/{x_id}`)로는 접근 가능하므로, **수정본을 먼저 스튜디오에서 검수**한 뒤에만 공개하도록 의도된 흐름이다.
  - 공개하려면 §13.5 "업로드 후 공개 절차" 참고 (어드민 승인 버튼 또는 업로더 스튜디오 공개 플로우).
- 새로 생성된 X는 `allow_remix=False`로 하드코딩 된다 (`admin/apps.py:492`). 리믹스 허용은 §13.5 방법 B(스튜디오 공개 플로우)에서 `allow_remix=True`를 동시에 토글해야 한다. 어드민 전용 `allow_remix` 단일 토글 엔드포인트는 현재 없다.
- `/admin/xs/upload`의 `title` / `category` / `description` Form 값은 업로드 시점에 DB에 저장된다. 다운로드 zip 안의 `app_metadata.json` 은 서버가 읽거나 해석하지 않는다 (상세는 §3 참조). 로컬에서 `app_metadata.json` 을 편집해도 반영되지 않는다.
- 업로드 성공 시 응답의 `mongo_app_id` 는 `YYYYMMDDHHMMSS_{uuid}` 포맷 (예: `20260417091234_abc12345-...`). 검증·삭제·공개 요청 시 이 값을 사용한다 (`app_service.generate_unique_id`).

---

## 3. 다운로드 zip 해제 후 기준 폴더 구조

```
{work_dir}/
├── app.ts                     ← 소스 (TypeScript)
├── main.ts                    ← 진입점
├── main.js                    ← 빌드 결과물 (helper가 다시 만들 수 있으나, 업로드는 그대로 올림)
├── appHelper.ts               ← 헬퍼 (앱에 따라 존재)
├── index.html                 ← HTML 템플릿
├── style.css                  ← 스타일시트
├── tsconfig.json              ← TS 설정
├── data.json                  ← 앱 데이터
├── app_metadata.json          ← DB 스냅샷 (읽기전용: 업로드 시 무시, 다운로드 때 DB에서 재생성)
├── chat.json                  ← 채팅 히스토리 (선택)
├── assets/
│   ├── thumbnail.webp         ← 메인 썸네일 (없으면 thumbnail.png)
│   ├── thumbnail_64.webp      ← 피라미드 (64/128/256/512 — 작은 썸네일용)
│   ├── thumbnail_128.webp
│   ├── thumbnail_256.webp
│   ├── thumbnail_512.webp
│   ├── icon.webp              ← 앱 아이콘
│   └── *.mp3, *.webp …        ← 앱 고유 에셋
└── archive/
    ├── change_log.json        ← 버전 트리
    └── v1-1/
        ├── meta.json          ← v1-1 버전 메타
        └── files/             ← v1-1에서 Add/Change된 파일들의 복사본
            ├── app.ts
            ├── …
            └── assets/…
```

실제 예시 폴더:
`etc/20260416101005_fedb0311-1c27-40ac-b4d5-930f0b2803b0/`

실제 예시 값:
- `mongo_app_id`: `20260416101005_fedb0311-1c27-40ac-b4d5-930f0b2803b0`
- v1-1 `version_id`: `020851c2-231e-4494-bd37-0957f1bb51a3`
- v1-1 `timestamp`: `2026-04-16T10:10:54.706285+00:00`
- v1-1 `summary`: `"뱀게임 만들어줘"`
- `engine_version`: `0.3.1`

**`app_metadata.json` 에 대한 중요 사실 (한 문단 요약)**:

업로드 시 서버는 `app_metadata.json` 을 읽거나 해석하지 않는다 (`_restore_db_from_uploaded_files` 가 이 파일을 파싱하지 않음). 업로드된 파일 자체는 EFS 에 그대로 저장되지만, **다음 다운로드 때 서버가 `_inject_db_metadata`(`admin/apps.py:837-902`) 로 DB 값을 사용해 새로 생성하며 zip 에서 덮어쓴다** (zip 생성 루프가 루트의 기존 `app_metadata.json` 을 `continue` 로 스킵한다, `admin/apps.py:944-945`). 따라서 로컬에서 `app_metadata.json` 을 수정해 올려도 반영되지 않는다. 제목/카테고리/설명을 바꾸려면 업로드 Form 의 `title` / `category` / `description` 을 원하는 값으로 보내는 것이 유일한 방법이다.

---

## 4. CLI LLM이 수행할 수 있는 수정의 종류

| 수정 유형 | 결과 파일 변경 | v2-1 `changes` 항목 | v2-1 `file_index` | v2-1/files/ 복사 |
|---|---|---|---|---|
| 루트 코드/데이터 파일 내용 변경 (`app.ts`, `main.ts`, `main.js`, `data.json`, `style.css`, `index.html`, `tsconfig.json`, `appHelper.ts`) | 루트 파일 덮어쓰기 | `{type:"Change"}` | 새 hash/size/mtime | 수정된 파일 복사 |
| 에셋 추가 (`assets/newfile.png`) | 새 파일 생성 | `{type:"Add"}` | 신규 엔트리 | 새 파일 복사 |
| 에셋 삭제 | 파일 삭제 | `{type:"Delete"}` | 엔트리 제거 | 복사하지 않음 |
| 에셋 내용 교체 (`assets/bgm.mp3` → 새 mp3) | 파일 덮어쓰기 | `{type:"Change"}` | 새 hash/size/mtime | 새 파일 복사 |
| 썸네일 교체 (`assets/thumbnail.webp`) | 파일 교체 + **피라미드 재생성** | 각각 `Change` | 5개 엔트리 모두 갱신 | 5개 모두 복사 |
| 내용 그대로 유지 | 변화 없음 | (`no_changes`에 기재) | parent의 값 그대로 유지 | 복사하지 않음 |

**"무엇이 바뀌었는지 판정할 수 없거나 번거로우면, 전체 파일을 전부 `Change`로 표기해도 된다."**
- 이 경우 `no_changes`는 빈 배열 `[]`이 되고, `file_index`의 모든 파일을 `v2-1/files/` 에 복사한다.
- 리스토어 시 언제나 v2-1의 자체 파일에서 복원되므로 가장 안전하다.

---

## 5. 새 버전(v2-1) 생성 알고리즘

### 5.1. 전제
- parent(직전 활성 버전) 이름은 `archive/change_log.json`에서 `is_current: true`인 버전. 보통 `v1-1`.
- 새 버전 이름은 `v{parent_gen+1}-{같은_세대_max_idx+1}`.
  - parent = `v1-1` → new = `v2-1`
  - parent = `v2-3` → new = `v3-1` (그 세대에 v3-\*가 없으면)
  - parent = `v2-1`이고 archive에 이미 `v3-1`이 있으면 new = `v3-2`
  - 구현: `alparka-back/snapshot_manager.py:73` `make_new_version_name`

### 5.2. 의사코드

```python
from pathlib import Path
import hashlib, json, shutil, uuid, re, datetime

WORK = Path(".")                # 다운로드 zip 해제한 폴더
ARCHIVE = WORK / "archive"

# (1) parent 결정 ---------------------------------------------------------
change_log = json.loads((ARCHIVE / "change_log.json").read_text("utf-8"))
parent_entry = next(v for v in change_log["versions"] if v.get("is_current"))
parent_name = parent_entry["version"]          # 예: "v1-1"
parent_vid  = parent_entry["version_id"]       # 예: "020851c2-..."
parent_meta = json.loads(
    (ARCHIVE / parent_name / "meta.json").read_text("utf-8")
)
parent_idx  = parent_meta["file_index"]         # { path: {hash, size, mtime} }

# (2) 새 버전 이름 --------------------------------------------------------
def make_new_version_name(archive_root: Path, parent_name: str) -> str:
    dirs = [p.name for p in archive_root.iterdir() if p.is_dir()]
    m = re.match(r"v(\d+)-(\d+)", parent_name)
    child_gen = int(m.group(1)) + 1
    max_idx = 0
    for n in dirs:
        mm = re.match(rf"v{child_gen}-(\d+)", n)
        if mm:
            max_idx = max(max_idx, int(mm.group(1)))
    return f"v{child_gen}-{max_idx + 1}"

new_name = make_new_version_name(ARCHIVE, parent_name)   # "v2-1"

# (3) 현재 루트 스캔 + 해시 계산 -------------------------------------------
DEFAULT_IGNORE = [
    "archive/**", "_restore_*", "_live/**",
    "change_log.json", "meta.json", "chat.json",
    "*.bak", "app_metadata.json",
]
import fnmatch
def ignored(rel: str) -> bool:
    return any(fnmatch.fnmatch(rel, pat) for pat in DEFAULT_IGNORE)

def sha256_hex(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

current_idx = {}
for p in WORK.rglob("*"):
    if not p.is_file():
        continue
    rel = p.relative_to(WORK).as_posix()
    if rel.startswith("archive/") or ignored(rel):
        continue
    # 주의: DEFAULT_IGNORE 에는 숨김 파일 패턴이 없다. macOS 의 .DS_Store,
    # editor의 swap 파일(.vscode/, .idea/), .gitignore 같은 것도 포함된다.
    # 업로드 전에 로컬에서 제거하거나, 아래처럼 직접 걸러야 한다:
    # if Path(rel).name.startswith(".") or rel.startswith(".git/"): continue
    # 또한 symlink 는 Path.is_file() 이 target 을 따라가므로 hash 대상이 된다.
    st = p.stat()
    current_idx[rel] = {
        "hash":  sha256_hex(p),
        "size":  st.st_size,
        "mtime": st.st_mtime,
    }

# (4) diff 계산 -----------------------------------------------------------
changes, no_changes = [], []
for rel in parent_idx:
    if rel not in current_idx:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Delete"})
for rel, info in current_idx.items():
    if rel not in parent_idx:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Add"})
    elif parent_idx[rel]["hash"] != info["hash"]:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Change"})
    else:
        # 이전 버전의 no_changes를 추적해 최종 last_version 유지
        prev_last = parent_name
        prev_last_id = parent_vid
        for nc in parent_meta.get("no_changes", []):
            if nc["path"] == rel:
                prev_last    = nc.get("last_version", parent_name)
                prev_last_id = nc.get("last_version_id", parent_vid)
                break
        no_changes.append({
            "path": rel,
            "last_version": prev_last,
            "last_version_id": prev_last_id,
        })

# (5) v2-1/files/ 에 Add+Change 파일 복사 --------------------------------
new_dir = ARCHIVE / new_name
(new_dir / "files").mkdir(parents=True, exist_ok=True)
for ch in changes:
    if ch["type"] == "Delete":
        continue
    src = WORK / ch["path"]
    dst = new_dir / "files" / ch["path"]
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

# (6) v2-1/meta.json 작성 --------------------------------------------------
new_vid = str(uuid.uuid4())
now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
meta = {
    "version":        new_name,
    "version_id":     new_vid,
    "parent":         parent_name,
    "parent_id":      parent_vid,
    "timestamp":      now_iso,
    "summary":        "로컬 수정 업로드",           # 편집/요청 의도 요약
    "changes":        changes,
    "no_changes":     no_changes,
    "file_index":     current_idx,
    "engine_version": parent_meta.get("engine_version", "0.3.1"),
    "request_id":     str(uuid.uuid4()),
}
(new_dir / "meta.json").write_text(
    json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
)

# (7) change_log.json 갱신 -------------------------------------------------
for v in change_log["versions"]:
    v["is_latest"]  = False
    v["is_current"] = False
    # is_published 는 그대로 유지
change_log["versions"].append({
    "version":      new_name,
    "version_id":   new_vid,
    "parent":       parent_name,
    "parent_id":    parent_vid,
    "timestamp":    now_iso,
    "summary":      meta["summary"],
    "is_latest":    True,
    "is_current":   True,
    "is_published": False,
})
(ARCHIVE / "change_log.json").write_text(
    json.dumps(change_log, indent=2, ensure_ascii=False), encoding="utf-8"
)
```

### 5.3. "모두 Change" 간이 모드

복잡도를 낮추고 싶으면 (4)(5) 단계를 아래로 대체한다.

```python
changes = []
for rel in current_idx:
    if rel in parent_idx:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Change"})
    else:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Add"})
for rel in parent_idx:
    if rel not in current_idx:
        changes.append({"name": Path(rel).name, "path": rel, "type": "Delete"})
no_changes = []

# v2-1/files/ 에 file_index의 모든 파일 복사
for rel in current_idx:
    src = WORK / rel
    dst = new_dir / "files" / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
```

효과: `no_changes`가 비어 있으므로 리스토어 시 항상 `v2-1/files/`에서 바로 찾는다. 안전성이 가장 높고, 사용자가 요청한 기본 동작이 이것이다.

**간이모드는 (4)(5) 단계만 대체하며, (1)(2)(3) 은 정상 모드와 동일하게 먼저 수행해야 한다**. 또한 간이모드 이후에도 (6) `v2-1/meta.json` 작성 과 (7) `change_log.json` 갱신 단계는 정상 모드와 **완전히 동일**하게 그대로 이어서 수행한다. 유일한 차이는 (4)(5) 에서 diff 대신 모든 파일을 Change/Add 로 처리하고 전부 복사한다는 것뿐.

**⚠ EFS 공간 비용 경고**: 간이모드는 변경되지 않은 파일까지 `v2-1/files/` 에 **전부 복사**하므로, 정상 모드 대비 EFS 사용량이 **약 2배**가 된다. 예: 원본이 100MB인데 10MB만 실제로 수정했다면 정상 모드는 v2-1/files/ 에 10MB만 쌓이고, 간이모드는 100MB가 쌓인다. 대용량 앱(수십 MB 이상의 assets 포함)을 반복적으로 이 방식으로 업로드하면 EFS 용량이 빠르게 증가하므로 **에셋이 큰 앱은 정상 모드(§5.2) 사용을 권장**한다.

---

## 6. `meta.json` 스키마 (버전별 메타)

### 6.1. 전체 구조

```json
{
  "version":        "v2-1",
  "version_id":     "<UUID v4, 문자열>",
  "parent":         "v1-1",
  "parent_id":      "<parent의 version_id UUID, 문자열>",
  "timestamp":      "2026-04-17T00:00:00+00:00",
  "summary":        "한 줄 요약 텍스트",
  "changes":        [ { "name": "...", "path": "...", "type": "Add|Change|Delete" }, ... ],
  "no_changes":     [ { "path": "...", "last_version": "v1-1", "last_version_id": "<UUID>" }, ... ],
  "file_index":     { "<posix 경로>": { "hash": "<64자 sha256 hex>", "size": <int bytes>, "mtime": <float epoch sec> }, ... },
  "engine_version": "0.3.1",
  "request_id":     "<UUID v4 또는 생략 가능>"
}
```

### 6.2. 필드별 규칙

| 필드 | 타입 | 규칙 |
|---|---|---|
| `version` | string (VARCHAR 20) | `v{N}-{M}` 형식. 업로드 시 archive 폴더명과 일치해야 함. DB 컬럼은 `VARCHAR(20)` (`app_content.py` AppVersion 정의) 이므로 문자열 길이 20자 이하. `v1-1`(4자) ~ 현실적 범위는 문제없음. |
| `version_id` | string (UUID) | 임의 UUID v4. 업로드 시 서버가 **새 UUID로 재매핑**하지만, meta.json에는 값이 있어야 함. 파싱 실패에 대한 방어 코드가 없으므로 유효한 UUID 형식 권장. |
| `parent` | string \| null | parent 버전 이름. 루트 버전이면 `null`. 서버는 **이름으로만 매핑**한다 (`admin/apps.py:697-701`). |
| `parent_id` | string (UUID) \| null | parent의 version_id. **주의: parent(이름) 매핑에 실패하면 parent_id(구 UUID) fallback 없이 DB에 `parent_id=NULL`로 저장된다.** 따라서 parent 버전이 같은 업로드의 archive에 반드시 포함되어 있어야 한다 (예: v2-1을 올리면 v1-1도 함께). |
| `timestamp` | ISO-8601 string | `datetime.fromisoformat()`으로 파싱 가능해야 함. **파싱 실패 시 DB는 기본값(서버 현재 시각)을 사용**(`admin/apps.py:689-695`). 포맷이 깨지면 timestamp가 업로드 시각으로 바뀌니, ISO-8601 엄수 + timezone 포함 권장. |
| `summary` | string (TEXT) | 변경 내용 한 줄 요약. 스튜디오 version tree에서 표시됨. DB는 TEXT 이므로 길이 제한 없음. 30–60자 권장. |
| `changes` | array (JSONB) | 아래 §6.3 참조 |
| `no_changes` | array (JSONB) | 아래 §6.4 참조 |
| `file_index` | object (JSONB) | 아래 §6.5 참조 |
| `engine_version` | string (VARCHAR 50) | **DB 컬럼은 `VARCHAR(50)`으로 제약된다** (최근 alembic 마이그레이션으로 변경됨). 초과 시 업로드가 500 으로 실패할 수 있다. 서버는 업로드 시 `str(meta.get("engine_version", "0.0.0"))` 로 변환하므로 값이 없으면 `"0.0.0"` 으로 저장. 다운로드 원본의 값(예: `"0.3.1"`)을 그대로 유지 권장. |
| `request_id` | string (UUID) | 선택. **없으면 DB에 NULL 로 저장된다** (서버가 자동 생성하지 않는다, `admin/apps.py:681-686`). AI 호출 이력과 연결하고 싶을 때만 채운다. |

### 6.3. `changes` 엔트리

```json
{ "name": "app.ts", "path": "app.ts", "type": "Change" }
{ "name": "newfile.png", "path": "assets/newfile.png", "type": "Add" }
{ "name": "old.mp3", "path": "assets/old.mp3", "type": "Delete" }
```

- `name`: 파일 basename (경로 없음)
- `path`: POSIX 상대경로 (슬래시 `/`). 윈도우 백슬래시 금지.
- `type`: `"Add"` / `"Change"` / `"Delete"` 중 하나 (대소문자 정확히)

### 6.4. `no_changes` 엔트리

parent와 내용이 동일한 파일에 대해 기재. v2-1/files/에는 복사하지 않고, 리스토어 시 `last_version_id`의 archive 폴더에서 가져온다.

```json
{
  "path": "style.css",
  "last_version": "v1-1",
  "last_version_id": "020851c2-231e-4494-bd37-0957f1bb51a3"
}
```

- `path`: POSIX 상대경로
- `last_version`: 실제 해당 파일이 마지막으로 저장된 버전의 **이름**. 업로드 시 서버는 이 이름을 우선 사용해 재매핑 UUID를 찾는다.
- `last_version_id`: 같은 버전의 구 UUID. 이름 매핑이 실패했을 때 fallback 으로 쓰임.
- 추적 규칙: parent의 `no_changes`에 같은 path가 있으면 그 `last_version` / `last_version_id`를 **그대로 이어받는다** (chain). 없으면 parent 자신이 last.

**⚠ 매핑 실패 시 데이터 손실 주의** (`admin/apps.py:703-714`):
- 서버는 `last_version`(이름) → `name_to_new_id`, 실패 시 `last_version_id`(구 UUID) → `old_id_to_new` 순으로 새 UUID를 찾는다.
- **둘 다 실패하면 해당 엔트리는 `{"path": "..."}`만 남기고 `last_version_id` 키가 아예 저장되지 않는다.** 즉 no_changes 엔트리가 불완전한 채 DB 에 들어간다.
- 결과: 나중에 v2-1으로 restore 시 해당 파일을 찾아갈 참조가 없어 **ancestor chain 전체 walk**에 의존 → 조상 archive 에도 파일이 없으면 `FileNotFoundError` 발생.
- 방지: `no_changes`에 `last_version`(이름)을 **반드시** 채우고, 그 이름에 해당하는 버전 폴더(`archive/{last_version}/`)를 업로드에 포함해야 한다.

"모두 Change" 모드에서는 `no_changes`를 `[]`로 둔다 — 이 경우 위 매핑 실패 위험이 원천 차단된다.

### 6.5. `file_index` 엔트리

파일 내용 존재 여부의 표준 레퍼런스. **여기에 있는 모든 파일이 실제로 v2-1을 복원 가능해야 한다** (v2-1/files/ 에 있거나, no_changes 체인으로 parent 버전에서 찾아갈 수 있어야 함).

```json
"assets/thumbnail.webp": {
  "hash":  "574b084aacb120f466bc39b0b597b5bfb93b11ef48d191ded7cf4ff7933c7578",
  "size":  9088,
  "mtime": 1775728961.0
}
```

- **키**: POSIX 상대경로 (예: `assets/bgm.mp3`). 백슬래시 금지.
- `hash`: **소문자 64자 hex**의 SHA-256. 루트 파일의 실제 바이트를 8192-byte chunk로 읽어 계산한다.
- `size`: 바이트 수 (int).
- `mtime`: `Path.stat().st_mtime` (float, epoch 초).

**제외 파일 (`DEFAULT_IGNORE`, `snapshot_manager.py:18`)**:
`archive/**`, `_restore_*`, `_live/**`, `change_log.json`, `meta.json`, `chat.json`, `*.bak`, `app_metadata.json`
→ 이들을 file_index에 넣으면 안 된다.

---

## 7. `change_log.json` 스키마 (버전 트리)

```json
{
  "versions": [
    {
      "version":      "v1-1",
      "version_id":   "020851c2-231e-4494-bd37-0957f1bb51a3",
      "parent":       null,
      "parent_id":    null,
      "timestamp":    "2026-04-16T10:10:54.706285+00:00",
      "summary":      "뱀게임 만들어줘",
      "is_latest":    false,
      "is_current":   false,
      "is_published": false
    },
    {
      "version":      "v2-1",
      "version_id":   "<v2-1 UUID>",
      "parent":       "v1-1",
      "parent_id":    "020851c2-231e-4494-bd37-0957f1bb51a3",
      "timestamp":    "2026-04-17T00:00:00+00:00",
      "summary":      "로컬 수정 업로드",
      "is_latest":    true,
      "is_current":   true,
      "is_published": false
    }
  ]
}
```

- `is_latest`:
  - 업로드 시점에는 정확히 1개만 `true`로 두는 것이 관례이나, **서버는 이 값을 DB에 저장하지 않고 다운로드 시 `idx==last_idx` 로 다시 계산한다** (`version_service.py:620-639`, `version_debug_io.py:238`). 따라서 업로드 → 다시 다운로드 라운드트립에서 `is_latest` 분포가 달라질 수 있다.
- `is_current`:
  - **배열 중 `true`가 여러 개 있어도 서버는 검증하지 않고 마지막 `true` 값이 덮어쓴다** (`admin/apps.py:740-744` 루프 구조상). 혼란 방지를 위해 반드시 1개만 true로 둔다.
  - 업로드 후 `apps.active_version_id` = 이 버전의 새 UUID. 스튜디오에서 열면 이 버전이 활성화됨. v2-1을 current로.
- `is_published`:
  - **업로드 경로** (`_restore_db_from_uploaded_files`, `admin/apps.py:733-762`) 에서는 해당 버전의 UUID가 `apps.published_version_id` 에만 세팅되고, **`apps.is_published` 컬럼 자체는 기본값 `False` 그대로 남는다**. 즉 change_log.json 에 `is_published: true` 를 적어도 업로드 직후에는 아케이드에 노출되지 않는다.
  - 실제로 `apps.is_published = True` 로 바뀌는 시점은 §13.5의 공개 절차(어드민 `approve` 또는 업로더의 `publish-x`) 를 거칠 때이다. 두 엔드포인트는 `apps.is_published`·`apps.approval_status`를 함께 세팅한다.
- 서버는 업로드 시 이 값들을 읽어 `apps.active_version_id` / `apps.published_version_id`를 세팅한다 (`admin/apps.py:733-762`).

---

## 8. 해시 계산 규칙 (반드시 일치시킬 것)

```python
import hashlib
from pathlib import Path

def sha256_hex(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()
```

- 출력: 소문자 64자 hex.
- 구현 위치: `alparka-back/snapshot_manager.py:32-41`.
- **file_index의 hash = 루트에 올라가는 파일의 hash = v2-1/files/의 hash** 이 셋이 **바이트 단위로 동일**해야 한다.
- 이후 사용자가 스튜디오에서 추가 버전을 만들 때 parent의 file_index와 현재 파일을 비교하므로, 불일치가 있으면 잘못된 diff가 나온다.

---

## 9. 업로드 API 호출

### 9.1. 엔드포인트

```
POST {API_BASE}/admin/xs/upload
Content-Type: multipart/form-data
Authorization: Bearer <ADMIN_JWT>
```

- 로컬: `API_BASE=http://localhost:8000`
- 스테이징: `API_BASE=https://api-stg.typx.ai` (존재 시)
- 프로덕션: `API_BASE=https://api.typx.ai`

### 9.2. Form 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `title` | string (`VARCHAR(200)`) | O | 앱 제목. 200자 이내. 다운로드 zip의 `app_metadata.json`의 `app_title` 이 mongo_app_id 와 같아 이상해 보이면 실제 제목으로 바꾼다. |
| `category` | string (`VARCHAR(50)`) | X (기본 `"general"`) | 앱 카테고리. 50자 이내. 다운로드 값 그대로 권장. |
| `description` | string (TEXT) | X | 앱 설명. 길이 무제한. 다운로드 값 그대로 권장. `None`으로 두면 DB에 NULL 저장. |
| `files` | file\[\] | O | 폴더 안의 **모든 파일**을 하나씩. 아래 §9.3 참조. |
| `paths` | string\[\] | O | 각 파일에 대응되는 **상대경로**. `len(files) == len(paths)` 필수. |

**파일 크기 관련 주의**:
- FastAPI 기본 multipart 에는 전체 요청 크기 상한이 없으나, ALB/nginx 리버스 프록시 및 K8s Pod 메모리 (프로덕션 limit `3Gi`) 때문에 **단일 요청 총 크기를 ~300MB 이내**로 유지하는 것이 안전하다.
- 에셋이 많은 앱은 archive 이전 버전까지 포함하면 쉽게 수백 MB가 된다. 필요 이상의 이전 버전은 로컬에서 정리해 업로드할 수 있지만, parent 체인을 끊으면 §6.4 경고처럼 `last_version_id` 매핑 실패가 발생하므로, 보통 전체 archive 를 유지한다.
- `upload_file.read()` 가 파일 전체를 메모리에 올리므로 (`admin/apps.py:501`), 거대한 단일 파일(수백 MB~GB) 은 Pod OOM 을 유발할 수 있다.

### 9.3. `files` / `paths` 구성 규칙

업로드 폴더의 **모든 파일**을 포함:
- 루트 코드/데이터 파일 (수정본)
- `assets/**`
- `archive/v1-1/meta.json`, `archive/v1-1/files/**`
- `archive/v2-1/meta.json`, `archive/v2-1/files/**`
- `archive/change_log.json`
- `chat.json` (있으면)
- `app_metadata.json` (있어도 무방, 없어도 무방 — 서버가 무시함)

`paths[i]` 규칙 (`_strip_folder_prefix`, `admin/apps.py:427-436`):

- 서버는 `paths[i]` **첫 번째 경로 세그먼트를 무조건 제거**하고, 나머지 부분을 EFS 저장 경로로 사용한다. (브라우저의 `webkitRelativePath`가 항상 폴더명을 첫 세그먼트로 넣기 때문에 이를 호환하기 위한 동작)
- 따라서 프로그래매틱 업로드 시에는 **아무 접두어나 붙여서** 첫 세그먼트를 채워주면 된다. 관례적으로 `upload/` 를 쓴다.

예시:

| 로컬 파일 | `paths[i]` | 서버 저장 경로 (EFS 기준, `BASE_PUBLIC_DIR/{new_mongo_app_id}/` 하위) |
|---|---|---|
| `app.ts` | `upload/app.ts` | `app.ts` |
| `archive/v2-1/meta.json` | `upload/archive/v2-1/meta.json` | `archive/v2-1/meta.json` |
| `assets/bgm.mp3` | `upload/assets/bgm.mp3` | `assets/bgm.mp3` |

제약 (`_validate_path`, `admin/apps.py:439-446`):
- `..` 포함 금지
- 절대경로 금지
- `paths`는 **POSIX 슬래시 `/`** 구분 (Windows 백슬래시 금지)
- `len(files) == len(paths)` 필수 (불일치 시 400)
- `files[]` 가 비면 400 (§12.7 참고)

`paths[i]`의 첫 세그먼트(`upload/`)가 제거된 뒤의 경로를 서버가 저장 경로로 쓰므로, **multipart 의 파일명(tuple 의 filename 인자)은 사용되지 않는다**. 따라서 `requests` / `aiohttp` 로 만들 때 파일명은 아무렇게 넣어도 무방하다. 중요한 것은 오로지 `paths[i]` 값.

### 9.4. curl 예시

```bash
#!/usr/bin/env bash
set -euo pipefail

API_BASE="http://localhost:8000"
TOKEN="$(cat ~/.alparka/admin_jwt)"   # 어드민 JWT
WORK_DIR="./etc/20260416101005_fedb0311-1c27-40ac-b4d5-930f0b2803b0"
TITLE="뱀게임"
CATEGORY="general"
DESC="로컬 수정 업로드"

cd "$WORK_DIR"
ARGS=(-F "title=${TITLE}" -F "category=${CATEGORY}" -F "description=${DESC}")

# 폴더 전체를 files[]/paths[]로 변환해 덧붙이기
while IFS= read -r -d '' f; do
  rel="${f#./}"
  ARGS+=(-F "files=@${rel}" -F "paths=upload/${rel}")
done < <(find . -type f -print0)

curl -X POST "${API_BASE}/admin/xs/upload" \
  -H "Authorization: Bearer ${TOKEN}" \
  "${ARGS[@]}"
```

### 9.5. Python 예시

```python
import pathlib, requests

API_BASE = "http://localhost:8000"
TOKEN    = pathlib.Path("~/.alparka/admin_jwt").expanduser().read_text().strip()
WORK     = pathlib.Path("etc/20260416101005_fedb0311-1c27-40ac-b4d5-930f0b2803b0")

files = []
opened = []
for p in WORK.rglob("*"):
    if not p.is_file():
        continue
    rel = p.relative_to(WORK).as_posix()
    fh = p.open("rb")
    opened.append(fh)
    files.append(("files", (p.name, fh, "application/octet-stream")))
    files.append(("paths", (None, f"upload/{rel}")))

data = {"title": "뱀게임", "category": "general", "description": "로컬 수정 업로드"}
try:
    r = requests.post(
        f"{API_BASE}/admin/xs/upload",
        headers={"Authorization": f"Bearer {TOKEN}"},
        data=data,
        files=files,
        timeout=300,
    )
    r.raise_for_status()
    print(r.json())
finally:
    for fh in opened:
        fh.close()
```

### 9.6. 성공 응답

```json
{
  "status": "success",
  "x": {
    "id": "<새 app UUID>",
    "mongo_app_id": "<새 mongo_app_id, 예: 20260417HHMMSS_...>",
    "title": "뱀게임",
    "author_id": "<업로드한 어드민 UUID>",
    "thumbnail_url": "/static/{새_mongo_app_id}/assets/thumbnail.webp",
    "is_published": false,
    "approval_status": "none",
    "allow_remix": false,
    ...
  }
}
```

응답의 `mongo_app_id`(= 새 `x_id`)를 이후 스튜디오 URL·검증에 사용한다.

---

## 10. 업로드 후 검증 체크리스트

업로드 직후 X 는 **비공개 상태**이므로 아케이드에는 안 나온다 (§2 참조). 검증은 **어드민 페이지 + 스튜디오 직접 URL** 접근으로 수행한다.

1. **업로드 API 응답 확인**: `status: "success"` + 새 `x` 객체의 `id`, `mongo_app_id` 를 **반드시 저장** (이후 단계, 좀비 앱 정리, 공개 요청에서 모두 필요).
2. **어드민 리스트 노출**: 어드민 페이지에서 새 X 가 리스트에 보이는가? (approval_status 필터 없음 또는 "전체"로 설정한 상태에서 확인)
3. **스튜디오 접속**: `/studio/{새_x_id}` 로 직접 이동. 활성 버전이 `v2-1` 로 표시되는가?
4. **파일 내용 — 가독성 높은 방법**: 스튜디오의 코드 편집 뷰에서 `app.ts` / `main.js` 등 수정한 파일을 열어 편집 내용이 반영됐는지 눈으로 확인. 또는 `main.js` 경우 브라우저에서 게임을 실행해 로직 변화(점수 표시, BGM 등)를 관찰.
5. **버전 트리**: 스튜디오 version tree 에 `v1-1` 과 `v2-1` 이 모두 있고, v2-1 이 current 인가? parent 화살표가 v1-1 → v2-1 로 이어지는가?
6. **리스토어 동작**: v1-1 로 리스토어 → 추가한 에셋이 사라지고, 수정 전 원본 내용이 복원되는가?
7. **다시 앞으로**: v2-1 로 리스토어 → 수정본 내용이 되돌아오는가?
8. **채팅 보존** (chat.json 올렸다면): 원본 앱의 채팅 내역이 보이는가? (단, 모든 message 의 user_id 가 업로드한 어드민으로 바뀜 — §12.4)
9. **썸네일 (공개 후에만 의미 있음)**: 공개 처리한 뒤 아케이드 리스트에서 작은 썸네일이 정상 표시되는가? 피라미드 4종(`thumbnail_64/128/256/512.webp`)이 모두 있어야 하며, 누락 시 프런트의 `buildThumbnailCandidates` 폴백 체인에서 다음 후보로 넘어가다가 모두 실패하면 배경색만 표시된다.
10. **다음 수정 시도 (스모크 테스트)**: 스튜디오에서 "AI로 수정" 또는 "코드 직접 편집"으로 `v3-1` 만들기를 시도. 성공하면 parent file_index 일관성 + 버전 체인이 정상적으로 유효함을 의미한다. 실패하면 네트워크/AI 서버 원인일 수도 있으므로 에러 메시지로 원인 구분.
11. **비공개 상태 확인**: 비로그인/다른 유저로 아케이드/랜딩 페이지에 진입 시 이 X 가 **안 보이는 것이 정상**. 공개 전에 보이면 오히려 설정 오류이므로 `apps.is_published` / `approval_status` 를 DB에서 재확인.

검증이 모두 통과되면 §13.5 공개 절차로 이동한다.

---

## 11. 절대 하면 안 되는 것

| 금지 사항 | 결과 |
|---|---|
| `archive/v1-1/files/` 의 기존 파일을 수정 | v1-1으로 리스토어가 깨지거나 해시 검증 실패 |
| `DEFAULT_IGNORE`에 있는 파일(`meta.json`, `change_log.json`, `app_metadata.json`, `chat.json`, `*.bak`)을 `file_index`에 등록 | 리스토어 시 동작 비정상 |
| 경로에 Windows 백슬래시 `\` 사용 | scan·매칭 실패 |
| 경로/파일명에 null byte (`\x00`) 포함 | 플랫폼에 따라 잘림 발생 + 보안 위험 |
| hash 값을 대문자로 기록 | parent와 비교 시 항상 불일치로 판정됨 |
| 삭제한 에셋을 `file_index`에 남겨두기 | 리스토어 시 `FileNotFoundError` |
| v2-1/files/ 에는 파일을 안 넣고 `no_changes`도 안 적음 | 리스토어 3계층 탐색 실패 |
| `no_changes` 엔트리의 `last_version` 이름이 archive 에 없는 버전을 가리킴 | 업로드 시 매핑 실패 → `last_version_id` 가 DB 에 NULL 로 저장 → restore 시 파일 찾기 실패 가능 |
| `meta.json` 의 `parent` 이름이 archive 에 없는 버전을 가리킴 | `parent_id` 가 DB 에 NULL 로 저장되어 parent chain 끊김 |
| `engine_version` 을 50자 초과로 작성 | `VARCHAR(50)` 제약 초과로 500 에러 |
| `change_log.json` 에 `is_current: true`가 2개 이상 | 서버는 검증 없이 마지막 true 값을 적용 (동작은 하지만 예측 불가) |
| `paths[]` 개수 ≠ `files[]` 개수 | 400 `Number of files (...) must match number of paths (...)` |
| `files[]` 가 빈 리스트 | 400 `At least one file is required.` |
| Form 값 `title`을 비움 | 422 (필수값 누락) |
| 업로드 후 원본 `x_id`를 재사용하려 함 | 원본은 건드리지 않음. 업로드는 항상 새 X 생성. |
| 같은 파일을 동시에 두 번 업로드 | 서로 다른 새 `mongo_app_id`를 발급받아 두 개의 X가 생성됨. mutex는 mongo_app_id 기준이라 새 ID끼리는 충돌 없음. |

---

## 12. 엣지 케이스 대응

### 12.1. 에셋만 추가, 코드는 유지
- 루트 코드 파일은 hash가 parent와 같으므로 `no_changes`에 들어간다.
- 새 에셋만 `changes: type=Add`.
- `v2-1/files/`에는 새 에셋만 복사.
- 단, "모두 Change" 모드를 쓰면 무조건 단순화된다.

### 12.2. 썸네일을 교체
- `assets/thumbnail.webp` 를 새 이미지로 바꿨다면 피라미드 `thumbnail_64/128/256/512.webp`를 **모두 재생성**해서 함께 포함하라.
- 서버는 업로드 경로에서 `ensure_webp_thumbnail`을 호출하지 않으므로, 피라미드를 자동으로 만들어주지 않는다.
- 피라미드가 누락되면 아케이드 리스트의 작은 썸네일이 깨진다.
- 재생성 Python 예:
  ```python
  from PIL import Image
  src = Image.open("assets/thumbnail.webp")
  for size in (64, 128, 256, 512):
      img = src.copy()
      img.thumbnail((size, size), Image.Resampling.LANCZOS)
      img.save(f"assets/thumbnail_{size}.webp", "WEBP", lossless=True)
  ```

### 12.3. 썸네일 포맷이 PNG
- 서버는 `assets/thumbnail.webp` → `assets/thumbnail.png` 순으로 탐색해 `thumbnail_url`을 세팅한다 (`apps.py:769-773`).
- 둘 중 하나라도 있으면 동작하나, webp 사용을 권장 (원본이 webp로 내려오므로 그대로 유지).

### 12.4. chat.json을 수정·제거
- 전혀 안 올려도 무방. 올리면 chat history가 복원됨.
- 각 message의 `version_id`가 archive 내 meta.json의 구 `version_id`(예: v1-1의 `020851c2-...`)와 매칭되면 새 UUID로 재매핑된다.
- v2-1 관련 새 대화를 추가하려면 v2-1 meta.json의 `version_id`와 동일한 값을 message의 `version_id`에 넣는다.
- user_id는 무조건 업로드한 어드민으로 덮어써진다.

### 12.5. v1-1이 아닌 깊은 버전을 parent로
- 다운로드 zip의 `is_current: true`를 확인해 그 버전을 parent로 쓰면 된다.
- archive에 이미 `v3-1`이 있고 parent=`v2-1`이라면 새 이름은 `v3-2`가 된다.
- 다운로드된 archive에는 실제로 쓰이는 버전만 들어있으므로 깊은 트리도 그대로 복원된다.

### 12.6. `summary`를 AI로 생성
- 한국어 1줄. 30~60자 권장. 예: `"점수 UI를 상단 중앙으로 이동"`, `"BGM을 더 밝은 곡으로 교체"`, `"게임 속도 1.5배 상향"`.
- 스튜디오의 version tree에 그대로 표시된다.

### 12.7. 업로드가 실패하는 대표 원인 및 좀비 앱 대응

| HTTP | 상황 | 대응 |
|---|---|---|
| 400 `Number of files (...) must match number of paths (...)` | `files[]`/`paths[]` 개수 불일치 | 업로드 스크립트가 `files.append` 와 `paths.append` 를 항상 같이 하도록 작성. |
| 400 `At least one file is required.` | `files[]` 가 비었다 | 업로드 폴더에 최소 1개 파일 존재 확인. find/rglob 결과가 비어있지 않은지 체크. |
| 400 `Invalid file path: ...` / `Absolute path not allowed: ...` | `paths[i]` 에 `..` 또는 절대경로 | POSIX 상대경로로 변환 후 재시도. |
| 409 `generation_in_progress_for_app` | 같은 mongo_app_id 에서 AI 생성 중 | 새 X 업로드는 새 ID 이므로 거의 발생 안 함. 발생 시 잠시 후 재시도. |
| 422 Validation Error | `title` 누락 또는 타입 에러 | Form 값 확인. |
| 500 | 파일 저장 실패 또는 `_restore_db_from_uploaded_files` 내부 예외 (예: `engine_version` VARCHAR(50) 초과, 파싱 오류 등) | **아래 좀비 앱 대응 절차 수행**. |

**⚠ 500 시 좀비 앱 주의** (`admin/apps.py:505` vs `:828`):

업로드 엔드포인트는 `apps` row 를 먼저 commit(`:505`) 한 뒤 `_restore_db_from_uploaded_files` 를 호출한다. 이 헬퍼 내부에서 예외가 발생하면 **`apps` row 는 이미 commit 된 상태로 남고, 버전 데이터만 없는 "버전 없는 앱"이 프로덕션 DB 에 잔존**한다. 이 X 는 어드민 리스트에는 보이지만 스튜디오로 열면 활성 버전 없음 에러가 난다. 이는 업로드 엔드포인트가 atomic transaction 으로 감싸져 있지 않아 발생하는 구조적 이슈이며, 문서만으로는 예방할 수 없다. 운영자는 아래 절차로 잔존물을 정리해야 한다.

**500 에러 시 좀비 정리 절차**:

1. 500 응답을 받으면 **업로드 스크립트가 응답 바디의 `x.mongo_app_id` 를 로깅했는지 확인** (문서 §10.1). 500 의 경우 응답 바디가 없을 수 있으므로, 업로드 시작 시각을 메모해두는 것이 확실하다.
2. 어드민 리스트에서 업로드한 title 또는 시각(생성 시각 역순) 으로 좀비 앱을 찾는다.
3. 어드민 페이지의 "삭제" 버튼으로 soft-delete (`POST /admin/xs/{x_id}/delete`).
4. **⚠ EFS 파일은 남는다**: soft-delete 는 DB 만 표시하고 EFS `{mongo_app_id}/` 폴더는 삭제하지 않는다 (§13.5 참조). 스토리지 누적이 신경 쓰이면 어드민 파일 브라우저 또는 운영팀에 요청해 EFS 폴더를 직접 제거한다. 로컬 docker-compose 환경이면 `${BASE_PUBLIC_DIR}/{mongo_app_id}/` 를 수동 삭제.
5. 로컬 패키징 오류(대부분 `engine_version` 50자 초과, 잘못된 JSON 포맷, `file_index` 해시 불일치, parent 누락)를 수정한 뒤 **새로 업로드**한다.
6. 업로드가 성공했다면 §10 검증 체크리스트로 정상 여부 확인.

**⚠ 캐시·CDN 반영 시차 주의**:
- 업로드·승인 후 아케이드 리스트에 보이지 않으면 Redis 캐시 무효화가 부분 실패했을 수 있다 (`admin/apps.py:522-531` 는 `try/except pass` 로 무시). 30초~1분 후 재시도.
- 정적 파일(`/static/{mongo_app_id}/...`) 은 ALB/CloudFront 에 따라 추가 캐시가 붙을 수 있다. 수정본이 브라우저에 반영 안 되면 강제 새로고침(Shift+F5) 또는 쿼리스트링으로 캐시 무효화.

---

## 13. 환경별 주의사항

| 환경 | `API_BASE` | 토큰 획득 | 검증 경로 |
|---|---|---|---|
| 로컬 (docker-compose) | `http://localhost:8000` | 로컬 어드민 계정으로 로그인 후 브라우저 localStorage의 access_token | `http://localhost:3000/studio/{x_id}` |
| 스테이징 | 사용자가 제공 | 스테이징 어드민 계정 | 스테이징 프런트 URL |
| 프로덕션 | `https://api.typx.ai` | 프로덕션 어드민 계정 (`game@vibeedu.ai` 등) | `https://www.typx.ai/studio/{x_id}` |

**작업 순서**: 항상 **로컬에서 end-to-end 검증**을 완료한 뒤에만 프로덕션 업로드를 시도한다. 프로덕션에 잘못 올라간 X는 어드민 페이지에서 soft-delete 가능하지만, 복구는 번거롭다.

업로드 후 불필요한 X가 생겼으면: 어드민 UI의 해당 X에서 "삭제" 버튼을 누르거나, `POST /admin/xs/{x_id}/delete`를 호출한다.

### 13.5. 업로드 후 공개/되돌림/삭제 절차

§2에서 설명했듯 업로드된 X 는 **비공개 상태**이다. 수정본이 §10 검증을 통과한 뒤 상태 전환이 필요하면 아래 엔드포인트 중 하나를 호출한다.

#### 방법 A — 어드민 승인 (`POST /admin/xs/{x_id}/approve`)

- 구현: `admin/apps.py:1146-1179` → `admin_service.approve_app` (`admin_service.py:61-98`)
- **DB 변경**: `approval_status=APPROVED`, `is_published=True`, `approved_by=<admin_id>`, `approved_at=utcnow()`, `rejection_reason=NULL`
- **부수 효과**:
  - approval_history 레코드 추가, audit_log(`APP_APPROVED`) 기록
  - 정적 파일을 `_live/` 로 복사 (`_copy_to_live`, best-effort)
  - **캐시 무효화 범위**: `arcade:*` **하나만** (`admin_service.py:84`)
  - **팔로워 알림 없음** (`notification_service` 미호출)
- **⚠ `_copy_to_live` 실패 시 주의**: best-effort 로 예외를 삼키고 경고 로그만 남기므로 (`admin_service.py:87-96`), HTTP 응답은 200 이지만 `_live/` 에 파일이 없는 상태가 된다. 이 경우 **리믹스 시도 시 `remix_source_not_ready` 에러** 가 발생한다 (`app_service.py:305`). 승인 후 `_live/` 존재 여부를 수동으로 한 번 확인하거나, 로그를 확인하는 것이 안전하다.
- **멱등성 없음**: 이미 APPROVED 상태에서 다시 호출하면 approval_history 에 중복 레코드가 쌓이고 `approved_at/by` 가 갱신된다.
- **테넌트 앱 차단**: `_reject_if_tenant_app` 이 걸려 403 반환.
- **AI 생성 중 차단**: 같은 `mongo_app_id` 에서 AI 생성 중이면 409.
- **사용 시점**: 단순히 공개만 필요하고 리믹스/메타 변경이 필요 없을 때. (권장)

#### 방법 B — 업로더 본인이 스튜디오 공개 플로우 (`POST /publish-x`)

- 구현: `apps.py:1012-1148` → `apply_publish_state` (`app_service.py:80-108`)
- **인증**: 일반 `require_auth`. 어드민이 업로드한 X 는 `author_id = 업로더 어드민`이므로 해당 어드민 계정으로 호출하면 소유권 검사(`apps.py:1042-1043`)를 통과한다.
- **요청 바디 (PublishRequest, `apps.py:136-142`)**: `app_name`(`x_name`), `category?`, `description?`, `allow_remix?`, `remix_credit_cost?`
- **DB 변경** (`apply_publish_state` 기준, `app_service.py:97-108`):
  - `is_published = True`
  - `published_version_id = active_version_id`
  - `approval_status = APPROVED` (코드 내 "임시 즉시 승인" 주석, `apps.py:1080`)
  - `approved_at = utcnow()`
  - `category` / `description` / `allow_remix` / `remix_credit_cost` 동시 갱신 가능
- **부수 효과**:
  - 정적 파일 `_live/` 로 복사 (`apps.py:1091-1102`, `approval_status=APPROVED` 일 때만)
  - **캐시 무효화 범위**: `arcade:*`, `trending:*`, `popular:*`, `recommended:*` 네 종류 (`apps.py:1104-1107`)
  - **팔로워 알림 발송**: `notification_service.create_new_app_notification` 호출 (`apps.py:1110-1124`). → **어드민의 팔로워에게 알림이 간다**. 어드민이 대량 업로드 시 팔로워에게 스팸으로 보일 수 있음에 유의.
- **리믹스 제목 검증**: 원본 X 가 아니므로(`remix_source_id=None`) 이 검증은 건너뜀 (`apps.py:1046-1058`).
- **사용 시점**:
  - 리믹스 허용(`allow_remix=True`)·리믹스 비용을 동시에 설정해야 할 때
  - 카테고리/설명을 공개와 함께 수정할 때
- **요청 예시**:

```bash
curl -X POST "${API_BASE}/publish-x" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "x_name": "<업로드 응답의 mongo_app_id>",
    "allow_remix": true,
    "remix_credit_cost": 10,
    "category": "game"
  }'
```

#### 공개 회수 (`POST /admin/xs/{x_id}/unpublish`)

- 구현: `admin/apps.py:1214-1238` → `admin_service.unpublish_app`
- **DB 변경**: `is_published=False`, `approval_status=ApprovalStatus.NONE`
- **부수 효과**: 캐시 무효화 (approve 대비 넓은 범위), audit_log 기록
- **사용 시점**: 이미 공개된 X 에서 부적절한 콘텐츠가 발견되어 긴급하게 아케이드 노출을 끊어야 할 때. 파일·DB row 는 보존되므로 언제든 다시 approve 로 복구 가능.

#### 비공개로 유지

- 아무것도 하지 않으면 된다. 스튜디오 URL (`/studio/{x_id}`) 로 직접 접근하는 author 본인(어드민)만 사용할 수 있으며, 아케이드·검색·홈 어디에도 노출되지 않는다.
- 비공개 상태의 X 에 대한 리믹스 시도는 차단된다 (`allow_remix=False` 하드코딩 + 원본 비공개).

#### 삭제 (`POST /admin/xs/{x_id}/delete`)

- 구현: `admin/apps.py:1241-1271` → `admin_service.delete_app_admin` (`admin_service.py:149-174`)
- **DB 변경**: `is_deleted=True`, `is_published=False` (soft-delete)
- **⚠ EFS 파일은 남는다**: 어드민 삭제 경로는 스토리지(EFS)의 `{mongo_app_id}/` 폴더를 **삭제하지 않는다**. 일반 유저의 `POST /delete-x` 와 달라서 주의. 좀비/실수로 올라간 파일을 완전히 정리하려면 §12.7 참조.
- **리믹스 카운트 감소**: 삭제 대상이 다른 앱의 리믹스 원본이면 해당 원본의 `remix_count` 가 감소한다.

#### 어떤 걸 선택할까

| 상황 | 권장 경로 |
|---|---|
| 단순 공개 (검수 끝, 리믹스 허용 불필요) | **방법 A** |
| 리믹스 허용/비용을 함께 설정 | **방법 B** |
| 카테고리·설명을 공개와 함께 수정 | **방법 B** |
| 팔로워 알림을 피하고 싶다 | **방법 A** |
| 이미 공개한 X 를 임시로 회수 | **unpublish** |
| 검수 결과 재업로드 해야 함 | **삭제 후 §5 절차로 재패키징·업로드** |

---

## 14. 참조 코드 (추가 탐색이 필요할 때)

모든 경로는 `alparka-back/` 기준. 라인번호는 2026-04-17 기준.

| 주제 | 파일 | 라인 |
|---|---|---|
| 업로드 엔드포인트 | `app/api/admin/apps.py` | 449-549 |
| 파일 저장 / `_validate_path` / prefix strip | `app/api/admin/apps.py` | 427-446, 497-505 |
| DB 복원 헬퍼 `_restore_db_from_uploaded_files` | `app/api/admin/apps.py` | 616-834 |
| 버전 정렬 (v10-1 이슈 해결) | `app/api/admin/apps.py` | 642-652 |
| parent 이름 우선 매핑 | `app/api/admin/apps.py` | 697-701 |
| no_changes 재매핑 | `app/api/admin/apps.py` | 703-714 |
| active/published 세팅 | `app/api/admin/apps.py` | 733-762 |
| thumbnail_url 자동 세팅 | `app/api/admin/apps.py` | 768-776 |
| chat.json 복원 | `app/api/admin/apps.py` | 786-826 |
| 다운로드 zip 메타 재생성 | `app/api/admin/apps.py` | 837-902 (`_inject_db_metadata`) |
| 해시 계산 | `snapshot_manager.py` | 32-41 (`sha256_of_file`) |
| 무시 패턴 `DEFAULT_IGNORE` | `snapshot_manager.py` | 18-27 |
| 트리 스캔 `scan_tree` | `snapshot_manager.py` | 53-70 |
| 버전 이름 규칙 `make_new_version_name` | `snapshot_manager.py` | 73-100 |
| 서버 측 `create_version` | `app/services/version_service.py` | 137-350 |
| 리스토어 로직 (3계층 탐색) | `app/services/version_service.py` | 353-518 |
| meta.json / change_log.json 빌더 | `app/services/version_debug_io.py` | 191-243 |

---

## 15. 빠른 체크리스트 (업로드 직전에 한 번 더 확인)

### 15.1. 패키징 검증

- [ ] 다운로드 폴더 전체를 복사해 작업본을 따로 만들었다 (원본 보존).
- [ ] 수정한 각 루트 파일에 대해 **실제 sha256 을 계산해 `v2-1/meta.json` 의 `file_index` 해시와 바이트 단위로 동일**한지 확인했다 (주관적 확신이 아니라 계산 결과 비교).
- [ ] `archive/v1-1/` 은 **전혀 건드리지 않았다**.
- [ ] `archive/v2-1/` 폴더를 만들고 `meta.json`, `files/` 를 채웠다.
- [ ] `v2-1/meta.json` 의 모든 `file_index` 해시 = 루트 실제 파일의 해시 = `v2-1/files/` 안 파일의 해시.
- [ ] `changes.type` 이 `"Add" | "Change" | "Delete"` 중 하나이고 오타 없다 (대소문자 정확히).
- [ ] `meta.json` 의 `parent` 이름이 같은 업로드의 archive 에 존재한다 (예: `parent: "v1-1"` 이면 `archive/v1-1/` 포함).
- [ ] `no_changes` 엔트리의 `last_version` 이 가리키는 버전 폴더도 archive 에 포함되어 있다. (모호하면 **"모두 Change" 간이모드(§5.3)** 로 단순화)
- [ ] `engine_version` 이 **50자 이하** 이다.
- [ ] `change_log.json` 에 v2-1 엔트리를 추가하고, `is_current: true` 가 v2-1 **하나뿐**이다. (`is_latest` 는 DB 에 저장되지 않고 다운로드 시 재계산되므로 기입은 관례일 뿐 실제 동작에 영향 없음)
- [ ] 썸네일을 교체했다면 피라미드 4종(`thumbnail_64/128/256/512.webp`)을 모두 만들었다.
- [ ] 루트에 macOS `.DS_Store`, 에디터 swap 파일 등 불필요한 숨김 파일이 없다.
- [ ] 경로에 null byte(`\x00`), 백슬래시(`\`) 등 금지 문자가 없다.

### 15.2. 업로드 실행

- [ ] 어드민 JWT 토큰을 준비했다.
- [ ] `title` 값을 의미있게 세팅했다 (자동값은 mongo_app_id 라서 이상해 보임).
- [ ] 업로드 스크립트가 `files[]`/`paths[]` 의 길이를 동일하게 보낸다.
- [ ] 로컬에서 먼저 end-to-end 로 한 번 성공시킨 뒤 프로덕션에 올린다.

### 15.3. 업로드 후 (아케이드 공개까지)

- [ ] 업로드 응답이 200 성공이다. (500이면 §12.7 좀비 앱 대응 절차로 정리 후 재업로드)
- [ ] `/studio/{새_x_id}` 에서 §10 검증 체크리스트를 모두 통과.
- [ ] 아케이드에 노출하려면 §13.5 공개 절차(어드민 승인 또는 스튜디오 공개 플로우) 수행.
- [ ] 리믹스 허용이 필요하면 **스튜디오 공개 플로우**(§13.5 방법 B)를 사용해 `allow_remix=True` 함께 설정.

---

*작성일: 2026-04-17 · 기준 코드: `alparka-back@main` (at the time of writing).*

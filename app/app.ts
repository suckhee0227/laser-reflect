/* =========================================================
   레이저 리플렉트 (Laser Reflect)
   기획안 기반 전자칠판용 팀 대결 퍼즐 게임.

   진행:  TITLE → (INTRO → PREDICT → MANIPULATE → FIRE → RESULT) × 6 → FINAL
   팀:    파란팀 / 빨간팀 번갈아, 3 라운드 × 2 스테이지 = 6 스테이지
   거울:  EASY/NORMAL 90° 회전(2종), HARD 45° 회전(4종)
   부가:  HARD에서 이동 장애물(고정 패턴, 발사 시 정지) 등장
   ========================================================= */

import { AppHelper } from "./appHelper";
import * as confetti from "canvas-confetti";

// ===========================================================
// 타입 정의
// ===========================================================

type Dir = "R" | "L" | "U" | "D";
// 양면 거울. /,\=대각(EASY/NORMAL/HARD). |,-=가로/세로(HARD 45° 순환에 추가).
type Ori = "/" | "\\" | "|" | "-";
type Screen = "title" | "intro" | "predict" | "manipulate" | "fire" | "result" | "final";
type FailReason = "out" | "block" | "forbidden" | "loop" | "miss";
type Result = "perfect" | "partial" | "fail";

interface DiffParam {
  label: string; sub: string; rotateStep: number;
  cols: number; rows: number; mirrors: number;
  walls: number; forbidden: number; movers: number;
  time: number; predict: number;
  diagonal?: boolean;   // true면 대각선 발사 + 축거울 (HARD)
}
interface IAppData {
  totalRounds: number;
  stagesPerRound: number;
  teams: { name: string; color: string }[];
  scoring: { perfect: number; partial: number; fail: number };
  difficulties: { [k: string]: DiffParam };
}
interface ITextData {
  title: string; tagline: string;
  startBtn: string; doneBtn: string; nextBtn: string; finalNextBtn: string; restartBtn: string;
  stageStart: string;
  predictHint: string; manipulateHint: string; fireHint: string;
  perfectTitle: string; partialTitle: string; failTitle: string;
  perfectDesc: string; partialDesc: string;
  failOut: string; failBlock: string; failForbidden: string; failMiss: string; failBackface?: string;
  gameOver: string; winSuffix: string; draw: string; turnSuffix: string; roundLabel: string;
}
interface ISoundAsset { id: string; file_path: string; volume?: number; isBackgroundMusic?: boolean; }
interface IAssetList { images: any[]; sounds: ISoundAsset[]; }

interface Cell { c: number; r: number; }
interface Mirror { id: number; c: number; r: number; sol: Ori; ori: Ori; }
interface Mover { track: Cell[]; t: number; dir: number; }

interface ComboPopup {
  x: number; y: number;     // 화면 좌표
  count: number;            // 콤보 단계
  bornMs: number;           // 생성 시각
  life: number;             // 총 수명 (ms)
}
interface ComboParticle {
  x: number; y: number;
  vx: number; vy: number;
  bornMs: number;
  life: number;
  color: string;
  size: number;
}
interface ComboRing {
  x: number; y: number;
  bornMs: number;
  life: number;
  color: string;
  maxR: number;
}

interface Stage {
  cols: number; rows: number;
  emitter: { c: number; r: number; dir: Dir };
  target: Cell;
  mirrors: Mirror[];
  walls: Cell[];
  forbidden: Cell[];
  movers: Mover[];
  rotateStep: number;
  time: number;
  predict: number;
}

interface StageParams {
  diff: string;
  round: number;
  stageInRound: number;
  team: number;
  cols: number; rows: number; mirrors: number;
  walls: number; forbidden: number; movers: number;
  time: number; predict: number; rotateStep: number;
  diagonal?: boolean;
}

interface TraceResult {
  result: Result;
  reason: FailReason;
  points: Cell[];
  hitMirrors: Set<number>;
  inDir: { [id: number]: Dir };   // 거울별 들어오는 빔 방향 (앞/뒷면 결정용)
}

interface Btn {
  x: number; y: number; w: number; h: number;
  label: string; sub?: string;
  kind: "diff" | "primary" | "danger" | "ghost" | "small";
  meta?: string;             // 예: 난이도 키
  enabled: boolean;
  selected?: boolean;
  onClick: () => void;
}

// ===========================================================
// 상수
// ===========================================================

const LOGICAL_W = 1280;
const LOGICAL_H = 800;

const COLOR = {
  bgTop:    "#5a86d6",
  bgBot:    "#3a5fae",
  panel:    "#eef3fb",
  ink:      "#1f2d4a",
  inkSub:   "#4a5876",
  gridTop:  "#dce8fb",
  gridBot:  "#c2d6f4",
  gridLine: "rgba(90,130,200,.30)",
  gridEdge: "rgba(60,100,170,.55)",
  team0:    "#3b6fd4",
  team1:    "#d8453b",
  yellow:   "#f5c042",
  green:    "#42b549",
  orange:   "#f0a92b",
  red:      "#e0473d",
  beamCore: "#fff7e8",
  beamMain: "#ff5a36",
  beamGlow: "rgba(255,160,90,.55)",
  hudBg:    "rgba(15,28,51,.55)",
  hudInk:   "#ffffff",
} as const;

const DELTA: { [k in Dir]: [number, number] } = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
// 양면 반사표. /,\ 는 90° 꺾기. |,- 는 가로/세로 거울(HARD 45° 순환용): 한 축은 되돌리고 다른 축은 통과.
const REFLECT: { [o in Ori]: { [d in Dir]: Dir } } = {
  "/":  { R: "U", U: "R", L: "D", D: "L" },
  "\\": { R: "D", D: "R", L: "U", U: "L" },
  "|":  { L: "R", R: "L", U: "U", D: "D" },  // 세로 거울: 가로빔 되돌림, 세로빔 통과
  "-":  { U: "D", D: "U", L: "L", R: "R" },  // 가로 거울: 세로빔 되돌림, 가로빔 통과
};
const PERP: { [d in Dir]: Dir[] } = { R: ["U", "D"], L: ["U", "D"], U: ["L", "R"], D: ["L", "R"] };

// EASY/NORMAL: /,\ 90° 토글. HARD(rotateStep 45): / | \ - 45° 순환.
function orientationCycle(step: number): Ori[] {
  return step === 45 ? ["/", "|", "\\", "-"] : ["/", "\\"];
}
function mirrorTypeFor(inDir: Dir, outDir: Dir): Ori {
  return REFLECT["/"][inDir] === outDir ? "/" : "\\";
}
// 앞/뒷면(겉모습): 유리가 빔을 향하면 앞면, 등지면 뒷면. |,- 는 항상 앞면(유리)으로.
function faceForBeam(o: Ori, inDir: Dir): { back: boolean; flip: boolean } {
  const flip = (o === "\\");
  let back = false;
  if (o === "/")       back = (inDir === "R" || inDir === "D");
  else if (o === "\\") back = (inDir === "L" || inDir === "D");
  return { back, flip };
}
// 가로/세로 거울(|,-) 삼각형 회전각. |=세로(기본), -=가로(90° 회전). 어색하면 여기만 조정.
function oriToAngle45(o: Ori): number {
  return o === "-" ? Math.PI / 2 : 0;
}
// 거울별 들어오는 빔 방향 (fire/result에서 앞/뒷면 표시용).
let mirrorFaceTrace: { [id: number]: Dir } = {};
// 정답 배치에서 빔이 각 거울에 도달하는 방향 — 면(앞/뒷) 표시를 '정답 기준'으로 고정해
// 조작 중에도 발사 때와 동일하게 보이고, 옆 거울 돌려도 안 바뀌게 한다. loadStage에서 계산.
let solInDir: { [id: number]: Dir } = {};

// ===========================================================
// 전역 상태
// ===========================================================

let appData: IAppData;
let textData: ITextData;
let assetList: IAssetList;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// 타이틀 자산 (다중 이미지)
type TitleAssetKey =
  | "bg" | "logo"
  | "char_blue" | "char_red"
  | "btn_settings" | "btn_scoreboard"
  | "btn_easy" | "btn_normal" | "btn_hard" | "btn_start"
  | "mirror" | "mirror_arrow"
  | "toolbox" | "tool_wrench" | "tool_driver"
  | "cloud1" | "cloud2" | "cloud3" | "cloud4"
  | "star" | "24" | "stone" | "board"
  | "laser_beam" | "mirror_with_beam"
  // 인게임 자산도 같은 폴더에 둠
  | "emitter" | "target" | "target_hit" | "target_back" | "mirror_arrow_right" | "stone_small"
  | "mirror_back"
  // 게임 전용 레이저기계/거울 (타이틀·썸네일은 원본 emitter/mirror 사용, 게임만 이쪽)
  | "emitter_game" | "mirror_game" | "mirror_front" | "mirror_front45" | "mirror_back45"
  // 난이도별 보드 (원본 사진 그대로 사용)
  | "board_square" | "board_wide" | "board_hard"
  // 이동 방해물 (양)
  | "mover";
// 자산 캐시 무력화 버전 — 이미지 파일을 교체했을 때 숫자를 올리면 브라우저가 새로 받아온다.
const ASSET_VER = "8";
const titleImgs: { [k in TitleAssetKey]?: HTMLImageElement } = {};
let titleAssetsLoaded: number = 0;
let titleAssetsTotal: number = 0;

// 타이틀 hover (마우스가 어떤 인터랙티브 요소 위에 있는지)
type TitleBtnKey = "EASY" | "NORMAL" | "HARD" | "START" | "SETTINGS" | "SCOREBOARD";
let titleHover: TitleBtnKey | null = null;

// 모달 (설정·점수판)
type ModalKind = null | "settings" | "scoreboard";
let modal: ModalKind = null;
let soundOn: boolean = true;  // 설정 토글용 (현재 사운드 자체는 비활성이지만 UI는 표시)

// 타이틀 레이아웃 (데이터로 관리 — 에디터로 수정/저장 가능)
interface TitleLayoutItem {
  id: string;                // 고유 ID
  key: TitleAssetKey;        // 어떤 자산을 그릴지
  x: number; y: number;      // (비회전 기준) 좌상단
  w: number; h: number;      // 표시 크기
  rot?: number;              // 중심 기준 회전(라디안), 기본 0
  interactive?: TitleBtnKey; // 인터랙티브(클릭/호버 대상)면 키
  cover?: boolean;           // bg처럼 전체 채우기
  clickRotates?: number;     // 클릭 시 이 각도(도)만큼 회전 — 데코 거울 같은 거
}
let rotatableHoverId: string | null = null;  // 호버 중인 회전형 아이템 id
let titleLayout: TitleLayoutItem[] = [];

// 에디터 상태
type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
let editMode: boolean = false;
let editSelected: number | null = null;     // titleLayout의 index
let editDragging: boolean = false;
let editDragOffX: number = 0;
let editDragOffY: number = 0;
let editResizing: HandleKind | null = null;
let editResizeStart: { x: number; y: number; w: number; h: number; rot: number; mx: number; my: number; shift: boolean } | null = null;
let editRotating: boolean = false;
let editRotateStart: { rot: number; mouseAngle: number } | null = null;
let editToast: { msg: string; until: number } | null = null;

// 사운드 — 비활성 (사용자 요청으로 전부 제거)

// 개발자 모드 — 시간/예측 단계 없이 자유롭게 발사·다음·홈 (기획서 흐름 대신 테스트 편의)
let devMode = false;   // 기본 실전 모드(기획서 흐름: 예측·타이머·자동발사). 타이틀 토글로 개발자 모드 전환.

// 게임 진행 상태
let screen: Screen = "title";
let diff: string = "EASY";
let stageIndex: number = 0;
let stage: Stage | null = null;
let stageP: StageParams | null = null;
let teamScores: number[] = [0, 0];

// phase 타이밍
let phaseStartMs: number = 0;
let lastFrameMs: number = 0;
let lastTickSec: number = -1;

// 빔 애니메이션
let beam: TraceResult | null = null;
let beamProgress: number = 0;
// 거울 클릭 피드백 상태 (id → 클릭 시각). 회전(스핀) 없이 면을 즉시 전환하고
// 짧은 "팝" 스케일 피드백만 준다.
const mirrorAnim = new Map<number, { startMs: number }>();
const MIRROR_POP_MS = 150;

// (단면 거울: 앞/뒷면은 거울 상태로 결정 — mirrorRender. faceForBeam/mirrorFaceTrace 불필요.)
// 빔이 타깃에 닿을 때 들어오는 방향 (타깃 앞/뒷면 결정용). 안 닿으면 null.
let targetInDir: Dir | null = null;
function endDirToTarget(tr: TraceResult, target: Cell): Dir | null {
  const p = tr.points;
  if (p.length < 2) return null;
  const last = p[p.length - 1];
  if (last.c !== target.c || last.r !== target.r) return null;
  const prev = p[p.length - 2];
  const dc = Math.sign(last.c - prev.c), dr = Math.sign(last.r - prev.r);
  if (dc === 1) return "R"; if (dc === -1) return "L";
  if (dr === 1) return "D"; if (dr === -1) return "U";
  return null;
}

// 격자 보정 모드 — 난이도별로 플레이 칸을 보드의 새겨진 격자에 미세 정렬 (localStorage 저장)
let gridCalibMode = false;
// dx/dy: 격자 원점 이동, dc: 칸 크기(정사각) 보정, dcols/drows: 열/행 수 보정(기본 cols/rows에 더함)
// dl/dr/dt/db: 네 모서리(좌/우/상/하)를 각각 자유롭게 늘리는 픽셀 오프셋 → 비정사각 칸 가능
type Calib = { dx: number; dy: number; dc: number; dcols?: number; drows?: number; dl?: number; dr?: number; dt?: number; db?: number };
const gridCalib: { [k: string]: Calib } = {};
function getCalib(): Calib {
  const c = gridCalib[diff] || (gridCalib[diff] = { dx: 0, dy: 0, dc: 0, dcols: 0, drows: 0, dl: 0, dr: 0, dt: 0, db: 0 });
  if (c.dcols == null) c.dcols = 0;
  if (c.drows == null) c.drows = 0;
  if (c.dl == null) c.dl = 0;
  if (c.dr == null) c.dr = 0;
  if (c.dt == null) c.dt = 0;
  if (c.db == null) c.db = 0;
  return c;
}
function loadGridCalib() {
  // 1) 저장소에 커밋된 기본값(gridcalib.json) — 배포/다른 브라우저에서도 보정 적용. localStorage가 있으면 그쪽 우선.
  fetch("gridcalib.json").then(r => (r.ok ? r.json() : null)).then(j => {
    if (j && typeof j === "object") {
      for (const k in j) if (!gridCalib[k]) gridCalib[k] = j[k];
      if (stage) computeBoardLayout();
    }
  }).catch(() => { /* 파일 없으면 무시 */ });
  // 2) localStorage(현재 튜닝 중인 값) — 동기 적용이라 위 fetch보다 먼저 들어가 우선권을 가진다.
  try { const s = localStorage.getItem("laserGridCalib"); if (s) Object.assign(gridCalib, JSON.parse(s)); } catch (_) { /* ignore */ }
}
function saveGridCalib() { try { localStorage.setItem("laserGridCalib", JSON.stringify(gridCalib)); } catch (_) { /* ignore */ } }
// Shift+S 로 호출 — 현재 보정값 전체를 gridcalib.json 파일로 내려받는다(저장소에 덮어쓰면 영구 적용).
function downloadGridCalibJSON() {
  const blob = new Blob([JSON.stringify(gridCalib, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "gridcalib.json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let beamStartMs: number = 0;
let beamDuration: number = 1200;
let bounceScheduled: number[] = [];
// 발사 중 이동 장애물(양) 충돌 처리: 빔은 무버 무시하고 경로를 그리되, 펄스가 칸에 도달한
// 순간 그 칸에 양이 있으면 충돌 → 그 지점에서 잘리고 실패. 칸별 도달 progress 캐시.
let beamCells: Cell[] = [];          // 빔이 지나는 '모든 칸'(코너만 있는 points를 칸 단위로 전개)
let beamCellArrival: number[] = [];  // beamCells[i] 에 펄스가 도달하는 progress(0~1)
let beamMoverCheckedIdx: number = 0; // 충돌 검사 완료한 마지막 칸 인덱스
let beamCutIndex: number = -1;       // >=0 이면 그 칸에서 양에 막힘(실패)

// 콤보 시스템
let comboCount: number = 0;          // 현재 빔이 진행하면서 누적된 콤보
let comboMax: number = 0;            // 이번 스테이지에서 도달한 최대 콤보
let comboBonus: number = 0;          // 이번 스테이지의 보너스 점수 합계
let comboScheduled: number[] = [];   // setTimeout 핸들 (정리용)
let comboPopups: ComboPopup[] = [];
let comboParticles: ComboParticle[] = [];
let comboRings: ComboRing[] = [];

// 입력 상태
let buttons: Btn[] = [];
let pressedBtn: Btn | null = null;
let selectedMirror: number | null = null;

// 결과
let resultShown: boolean = false;
let resultPoints: number = 0;
let confettiPlayed: boolean = false;

// ===========================================================
// 사운드 — 전부 비활성 (no-op)
// ===========================================================

const Sfx = {
  click() {}, rotate() {}, fire() {},
  perfect() {}, partial() {}, fail() {},
  bounce(_pitch?: number) {}, tick() {}, stageStart() {},
};

// ===========================================================
// 콤보 — 단계별 색상/보너스
// ===========================================================

// ===========================================================
// 타이틀 레이아웃 — 기본값
// ===========================================================
const DEFAULT_TITLE_LAYOUT: TitleLayoutItem[] = [
  // 배경
  { id: "bg",     key: "bg",     x: 0, y: 0, w: 1280, h: 800, cover: true },
  // 구름
  { id: "cloud1", key: "cloud1", x: 170, y: 60,  w: 120, h: 70 },
  { id: "cloud2", key: "cloud2", x: 990, y: 50,  w: 130, h: 75 },
  { id: "cloud3", key: "cloud3", x: 880, y: 200, w: 90,  h: 55 },
  { id: "cloud4", key: "cloud4", x: 260, y: 280, w: 75,  h: 45 },
  // 별
  { id: "star1", key: "star", x: 320, y: 90,  w: 34, h: 34 },
  { id: "star2", key: "star", x: 920, y: 80,  w: 30, h: 30 },
  { id: "star3", key: "star", x: 720, y: 60,  w: 26, h: 26 },
  { id: "star4", key: "star", x: 460, y: 280, w: 22, h: 22 },
  { id: "star5", key: "star", x: 800, y: 290, w: 24, h: 24 },
  { id: "star6", key: "star", x: 200, y: 380, w: 20, h: 20 },
  // 좌·우 상단 거울 데코
  { id: "deco_mirror_L", key: "mirror",       x: 170,  y: 130, w: 110, h: 110 },
  { id: "deco_mirror_R", key: "mirror_arrow", x: 1000, y: 140, w: 110, h: 110 },
  // 로고
  { id: "logo", key: "logo", x: 340, y: 50, w: 600, h: 320 },
  // 레이저 빔 장식 (로고 위에 떠서 잘 보이게)
  { id: "deco_laser",       key: "laser_beam",       x: 150,  y: 100, w: 320, h: 140 },
  { id: "deco_mirror_beam", key: "mirror_with_beam", x: 820,  y: 20,  w: 300, h: 250 },
  // 캐릭터
  { id: "char_blue", key: "char_blue", x: 20,   y: 360, w: 260, h: 430 },
  { id: "char_red",  key: "char_red",  x: 1000, y: 360, w: 260, h: 430 },
  // 하단 도구 장식
  { id: "toolbox",     key: "toolbox",     x: 20,   y: 650, w: 120, h: 120 },
  { id: "tool_wrench", key: "tool_wrench", x: 140,  y: 720, w: 110, h: 65 },
  { id: "stone_deco",  key: "stone",       x: 1120, y: 690, w: 80,  h: 80 },
  { id: "tool_driver", key: "tool_driver", x: 1060, y: 740, w: 200, h: 60 },
  // 인터랙티브
  { id: "btn_settings",   key: "btn_settings",   x: 40,   y: 30,  w: 100, h: 130, interactive: "SETTINGS" },
  { id: "btn_scoreboard", key: "btn_scoreboard", x: 1140, y: 30,  w: 100, h: 130, interactive: "SCOREBOARD" },
  { id: "btn_easy",       key: "btn_easy",       x: 330,  y: 420, w: 200, h: 130, interactive: "EASY" },
  { id: "btn_normal",     key: "btn_normal",     x: 540,  y: 420, w: 210, h: 130, interactive: "NORMAL" },
  { id: "btn_hard",       key: "btn_hard",       x: 760,  y: 420, w: 200, h: 130, interactive: "HARD" },
  { id: "btn_start",      key: "btn_start",      x: 480,  y: 600, w: 320, h: 100, interactive: "START" },
];

async function loadTitleLayout() {
  try {
    const r = await fetch("assets/title/layout.json", { cache: "no-cache" });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j.items) && j.items.length > 0) {
        titleLayout = j.items;
        return;
      }
    }
  } catch (e) { /* 무시 */ }
  titleLayout = DEFAULT_TITLE_LAYOUT.map(x => ({ ...x }));
}

function downloadLayoutJSON() {
  const data = JSON.stringify({ items: titleLayout }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "layout.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showEditToast("layout.json 다운로드 — app/assets/title/ 폴더에 덮어쓰기");
}

function showEditToast(msg: string) {
  editToast = { msg, until: performance.now() + 3000 };
}

// ===========================================================
// 타이틀 자산 로딩
// ===========================================================
function loadTitleAssets() {
  const keys: TitleAssetKey[] = [
    "bg", "logo",
    "char_blue", "char_red",
    "btn_settings", "btn_scoreboard",
    "btn_easy", "btn_normal", "btn_hard", "btn_start",
    "mirror", "mirror_arrow",
    "toolbox", "tool_wrench", "tool_driver",
    "cloud1", "cloud2", "cloud3", "cloud4",
    "star", "24", "stone", "board",
    "laser_beam", "mirror_with_beam",
    "emitter", "target", "target_hit", "mirror_arrow_right", "stone_small",
    "mirror_back",
    "emitter_game", "mirror_game", "mirror_front", "mirror_front45", "mirror_back45",
    "board_square", "board_wide", "board_hard",
    "mover",
  ];
  titleAssetsTotal = keys.length;
  keys.forEach(k => {
    const img = new Image();
    img.onload = () => { titleAssetsLoaded++; };
    img.onerror = () => { /* 무시 */ };
    img.src = `assets/title/${k}.png?v=${ASSET_VER}`;
    titleImgs[k] = img;
  });
}

function comboColor(n: number): string {
  if (n <= 1) return "#ffffff";
  if (n === 2) return "#f5c042";   // 노랑
  if (n === 3) return "#f0892b";   // 주황
  if (n === 4) return "#e0473d";   // 붉은
  return "#ffd24a";                 // 5+ 금색
}
function comboBonusFor(n: number): number {
  return n >= 2 ? n - 1 : 0;
}

// ===========================================================
// 레이저 추적
// ===========================================================

function traceLaser(s: Stage, moverCells: Set<string>): TraceResult {
  let dir: Dir = s.emitter.dir;
  let c = s.emitter.c, r = s.emitter.r;
  const points: Cell[] = [{ c, r }];
  const hit = new Set<number>();
  const inDir: { [id: number]: Dir } = {};
  const maxSteps = s.cols * s.rows * 4 + 20;

  const key = (cc: number, rr: number) => cc + "," + rr;
  const wallSet = new Set<string>(s.walls.map(w => key(w.c, w.r)));
  const forbSet = new Set<string>(s.forbidden.map(f => key(f.c, f.r)));
  const targetK = key(s.target.c, s.target.r);
  const mirrorMap = new Map<string, Mirror>();
  s.mirrors.forEach(m => mirrorMap.set(key(m.c, m.r), m));

  for (let step = 0; step < maxSteps; step++) {
    const [dc, dr] = DELTA[dir];
    c += dc; r += dr;

    if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) {
      points.push({ c, r });
      return { result: "fail", reason: "out", points, hitMirrors: hit, inDir };
    }
    const k = key(c, r);
    if (wallSet.has(k) || moverCells.has(k)) {
      points.push({ c, r });
      return { result: "fail", reason: "block", points, hitMirrors: hit, inDir };
    }
    if (forbSet.has(k)) {
      points.push({ c, r });
      return { result: "fail", reason: "forbidden", points, hitMirrors: hit, inDir };
    }
    if (k === targetK) {
      points.push({ c, r });
      const result: Result = hit.size === s.mirrors.length ? "perfect" : "partial";
      return { result, reason: "miss", points, hitMirrors: hit, inDir };
    }
    const m = mirrorMap.get(k);
    if (m) {
      inDir[m.id] = dir;   // 들어오는 방향 기록 (반사 전)
      const nd = REFLECT[m.ori][dir];
      points.push({ c, r });
      if (nd !== dir) hit.add(m.id);
      dir = nd;
    }
  }
  return { result: "fail", reason: "loop", points, hitMirrors: hit, inDir };
}

// ===========================================================
// 레벨 생성기 — 항상 풀 수 있는 퍼즐을 보장
// ===========================================================

function randInt(a: number, b: number): number { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function generateStage(p: StageParams): Stage {
  for (let attempt = 0; attempt < 700; attempt++) {
    const s = tryBuild(p);
    if (s) return s;
  }
  // 극히 드문 실패: 거울 수를 줄여 재시도
  return generateStage({ ...p, mirrors: Math.max(1, p.mirrors - 1) });
}

function tryBuild(p: StageParams): Stage | null {
  const cols = p.cols, rows = p.rows;
  const used = new Set<string>();
  const key = (c: number, r: number) => c + "," + r;
  const inBounds = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;

  // 발사 장치 위치 (가장자리, 안쪽 향함)
  let emitter: { c: number; r: number; dir: Dir };
  const edge = randInt(0, 3);
  if (edge === 0)      emitter = { c: 0,        r: randInt(1, rows - 2), dir: "R" };
  else if (edge === 1) emitter = { c: cols - 1, r: randInt(1, rows - 2), dir: "L" };
  else if (edge === 2) emitter = { c: randInt(1, cols - 2), r: 0,        dir: "D" };
  else                 emitter = { c: randInt(1, cols - 2), r: rows - 1, dir: "U" };
  used.add(key(emitter.c, emitter.r));

  // 경로를 만들면서 거울 배치
  let c = emitter.c, r = emitter.r;
  let cdir: Dir = emitter.dir;
  const mirrors: Mirror[] = [];

  // 거울 사이 직진 거리. 최소 3칸 이상 띄워 따닥따닥 안 붙게 + 보드 클수록 멀리.
  const maxRun = Math.max(3, Math.min(cols, rows) - 2);
  const minRun = Math.min(3, maxRun);
  for (let i = 0; i < p.mirrors; i++) {
    const run = randInt(minRun, maxRun);
    let nc = c, nr = r, ok = true;
    for (let k = 0; k < run; k++) {
      nc += DELTA[cdir][0]; nr += DELTA[cdir][1];
      if (!inBounds(nc, nr) || used.has(key(nc, nr))) { ok = false; break; }
      used.add(key(nc, nr));
    }
    if (!ok) return null;

    const candidates: Dir[] = PERP[cdir].filter(nd => {
      const tc = nc + DELTA[nd][0], tr = nr + DELTA[nd][1];
      return inBounds(tc, tr) && !used.has(key(tc, tr));
    });
    if (candidates.length === 0) return null;
    const ndir: Dir = pick(candidates);

    mirrors.push({ id: i, c: nc, r: nr, sol: mirrorTypeFor(cdir, ndir), ori: "/" });
    c = nc; r = nr; cdir = ndir;
  }

  // 마지막 거울 이후 직진 → 목표 (타깃도 거울과 충분히 떨어지게)
  const tail = randInt(2, maxRun);
  let tc = c, tr = r;
  for (let k = 0; k < tail; k++) {
    tc += DELTA[cdir][0]; tr += DELTA[cdir][1];
    if (!inBounds(tc, tr) || used.has(key(tc, tr))) return null;
    used.add(key(tc, tr));
  }
  const target: Cell = { c: tc, r: tr };

  // 빈 칸 셔플 → 장애물/금지/이동 배치
  const free: Cell[] = [];
  for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
    if (!used.has(key(cc, rr))) free.push({ c: cc, r: rr });
  }
  shuffle(free);

  // 벽돌/금지 칸을 '경로 바로 옆'에 우선 배치한다. 이 시점의 used = 빔 경로·거울·타깃 전부.
  // 경로에 직교로 인접한 빈 칸을 앞으로 보내면, 거울을 잘못 돌려 빔이 경로를 이탈하는 순간
  // 옆 벽돌에 막혀 실패 → "경로를 정확히 따라가야 하는" 긴장/재미가 생긴다.
  const isPathAdjacent = (cell: Cell): boolean => {
    const nb: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dc, dr] of nb) {
      if (used.has(key(cell.c + dc, cell.r + dr))) return true;
    }
    return false;
  };
  free.sort((a, b) => (isPathAdjacent(b) ? 1 : 0) - (isPathAdjacent(a) ? 1 : 0));

  const taken = new Set<string>();
  const takeNext = (): Cell | null => {
    while (free.length > 0) {
      const f = free.shift()!;
      const k = key(f.c, f.r);
      if (!taken.has(k)) { taken.add(k); return f; }
    }
    return null;
  };

  // 이동 장애물(양): 빔 경로의 직진 칸 P를 가로질러 왔다갔다 하도록 만든다 → 양이 경로 위에
  // 올라온 순간 발사하면 막힘. 플레이어는 양이 비켰을 때 쏴야 함(타이밍 방해물).
  // 양끝(track[0], track[last])은 경로 밖이라 정답 검증(track[0]에서 멈춤)은 통과한다.
  const movers: Mover[] = [];
  const mirrorKeys = new Set<string>(mirrors.map(m => key(m.c, m.r)));
  // 경로 중 발사기/거울/타깃을 뺀 '빔 직진 칸' 후보
  const segCells: Cell[] = [];
  used.forEach(s => {
    const [sc, sr] = s.split(",").map(Number);
    if (sc === emitter.c && sr === emitter.r) return;
    if (sc === target.c && sr === target.r) return;
    if (mirrorKeys.has(s)) return;
    segCells.push({ c: sc, r: sr });
  });
  shuffle(segCells);
  const usedP = new Set<string>();
  for (let i = 0; i < p.movers; i++) {
    let placed = false;
    for (const P of segCells) {
      const pk = key(P.c, P.r);
      if (usedP.has(pk)) continue;
      // P를 지나는 가로/세로 양방향 트랙 (양끝은 경로·장애물 밖이어야 함)
      const axes = shuffle([[1, 0], [0, 1]] as [number, number][]);
      const MAX_SIDE = 3;   // P 양옆으로 최대 몇 칸까지 확장할지 (이동 범위)
      for (const [dc, dr] of axes) {
        // P를 기준으로 양방향으로 비어있는(경로·장애물 밖) 칸을 모은다.
        const side = (sgn: number): Cell[] => {
          const cells: Cell[] = [];
          let cc = P.c, rr = P.r;
          for (let k = 0; k < MAX_SIDE; k++) {
            cc += dc * sgn; rr += dr * sgn;
            const kk = key(cc, rr);
            if (!inBounds(cc, rr) || used.has(kk) || taken.has(kk)) break;
            cells.push({ c: cc, r: rr });
          }
          return cells;
        };
        const neg = side(-1), pos = side(1);
        // track[0]은 경로 밖이어야 정답 검증 통과 → neg(또는 pos) 끝에서 시작. 최소 양끝 합 2칸.
        if (neg.length < 1 || (neg.length + pos.length) < 2) continue;
        const track: Cell[] = [...neg.slice().reverse(), P, ...pos];
        track.forEach(c => { if (!(c.c === P.c && c.r === P.r)) taken.add(key(c.c, c.r)); });
        usedP.add(pk);
        movers.push({ track, t: 0, dir: 1 });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) break;
  }

  // 벽돌/금지 칸은 무버가 경로 칸을 먼저 차지한 뒤, 남은 경로-인접 칸에 배치.
  const walls: Cell[] = [];
  for (let i = 0; i < p.walls; i++) {
    const f = takeNext(); if (!f) break; walls.push(f);
  }
  const forbidden: Cell[] = [];
  for (let i = 0; i < p.forbidden; i++) {
    const f = takeNext(); if (!f) break; forbidden.push(f);
  }

  // 거울 방향 흐트러뜨리기 (정답과 다르게)
  const cycle = orientationCycle(p.rotateStep);
  mirrors.forEach(m => {
    const wrong = cycle.filter(o => o !== m.sol);
    m.ori = pick(wrong);
  });

  const stage: Stage = {
    cols, rows, emitter, target, mirrors, walls, forbidden, movers,
    rotateStep: p.rotateStep, time: p.time, predict: p.predict,
  };

  // 정답 검증: 풀이 방향으로 추적하면 perfect 여야 함
  mirrors.forEach(m => { m.ori = m.sol; });
  const moverFreeze = new Set<string>(movers.map(mv => key(mv.track[0].c, mv.track[0].r)));
  if (traceLaser(stage, moverFreeze).result !== "perfect") return null;

  // 흐트러뜨리고 우연히 풀려있으면 폐기
  mirrors.forEach(m => {
    const wrong = cycle.filter(o => o !== m.sol);
    m.ori = pick(wrong);
  });
  if (traceLaser(stage, moverFreeze).result === "perfect") return null;

  return stage;
}

// ===========================================================
// 스테이지 파라미터 (라운드별 스케일링)
// ===========================================================

function stageParams(d: string, idx: number): StageParams {
  const b = appData.difficulties[d];
  const round = Math.floor(idx / appData.stagesPerRound);
  // 격자 보정 모드에서 맞춘 열/행 수 보정 적용 (보드 이미지의 새겨진 격자에 칸 수를 맞추기 위함)
  const cal = gridCalib[d];
  const dcols = (cal && cal.dcols) || 0;
  const drows = (cal && cal.drows) || 0;
  // 칸 수는 난이도당 고정 — 보드 이미지의 새겨진 격자가 고정이라 라운드별 증가를 빼서 한 보정값으로 모든 판 정렬.
  // 난이도 상승은 거울/벽/이동장애물/제한시간으로 표현(아래 항목들이 round로 증가).
  return {
    diff: d,
    round: round + 1,
    stageInRound: (idx % appData.stagesPerRound) + 1,
    team: idx % 2,
    cols: Math.max(3, Math.min(16, b.cols + dcols)),
    rows: Math.max(3, Math.min(16, b.rows + drows)),
    mirrors: b.mirrors + round,
    walls: b.walls + round,
    forbidden: b.forbidden + (round > 0 ? 1 : 0),
    movers: b.movers + (b.movers > 0 && round > 1 ? 1 : 0),
    time: Math.max(24, b.time - round * 10),
    predict: b.predict,
    rotateStep: b.rotateStep,
    diagonal: !!b.diagonal,
  };
}

// ===========================================================
// 보드 레이아웃
// ===========================================================

const HUD_H = 76;
const FOOT_H = 96;

let boardCell: number = 56;   // 스프라이트/선 두께용 대표 칸 크기 = min(cellW, cellH)
let cellW: number = 56;       // 칸 가로 크기 (boardW / cols)
let cellH: number = 56;       // 칸 세로 크기 (boardH / rows)
let boardX: number = 0;
let boardY: number = HUD_H;
let boardW: number = 0;
let boardH: number = 0;

// 보드 이미지 (프레임 포함) 화면 좌표
let boardImgX: number = 0;
let boardImgY: number = 0;
let boardImgW: number = 0;
let boardImgH: number = 0;

// 보드 이미지(1564x1534)에 새겨진 9x9 격자의 안쪽 경계 (측정값) — 플레이 칸을 여기에 맞춘다
const BOARD_IMG_W = 1564;
const BOARD_IMG_H = 1534;
const BOARD_INNER_L = 49;
const BOARD_INNER_T = 52;
const BOARD_INNER_R = 1498;
const BOARD_INNER_B = 1456;
const BOARD_GRID_COLS = 9;
const BOARD_GRID_ROWS = 9;

// 난이도별 보드 이미지 — 원본 사진을 그대로 사용
function boardKeyFor(d: string): TitleAssetKey {
  if (d === "NORMAL") return "board_wide";
  if (d === "HARD") return "board_hard";
  return "board_square";
}

function computeBoardLayout() {
  if (!stage) return;
  // 난이도별 보드 이미지의 원본 크기 (자르거나 늘리지 않음)
  const img = titleImgs[boardKeyFor(diff)];
  const imgW = (img && img.naturalWidth) || 1254;
  const imgH = (img && img.naturalHeight) || 1254;

  const maxW = LOGICAL_W - 40;
  const availH = LOGICAL_H - HUD_H - FOOT_H;
  const maxH = availH - 8;

  // 보드를 화면 가득 — 원본 비율 그대로 균일 스케일만.
  const s = Math.min(maxW / imgW, maxH / imgH);
  boardImgW = Math.round(imgW * s);
  boardImgH = Math.round(imgH * s);
  boardImgX = Math.floor((LOGICAL_W - boardImgW) / 2);
  boardImgY = HUD_H + Math.floor((availH - boardImgH) / 2);

  // 기본 정사각 격자를 보드 중앙에 얹은 뒤(dx/dy/dc), 네 모서리 오프셋(dl/dr/dt/db)으로 자유 변형.
  const cal = gridCalib[diff];
  let cell = Math.floor(Math.min(boardImgW, boardImgH) * 0.72 / Math.max(stage.cols, stage.rows));
  if (cal && cal.dc) cell += cal.dc;
  const w0 = cell * stage.cols;
  const h0 = cell * stage.rows;
  let x0 = Math.round(boardImgX + (boardImgW - w0) / 2);
  let y0 = Math.round(boardImgY + (boardImgH - h0) / 2);
  if (cal) { x0 += cal.dx; y0 += cal.dy; }

  // 모서리별 오프셋: 좌/우는 x, 상/하는 y를 늘린다 (양수=바깥쪽으로 확장)
  const dl = (cal && cal.dl) || 0, dr = (cal && cal.dr) || 0;
  const dt = (cal && cal.dt) || 0, db = (cal && cal.db) || 0;
  const left = x0 - dl, right = x0 + w0 + dr;
  const top  = y0 - dt, bottom = y0 + h0 + db;
  boardX = left;
  boardY = top;
  boardW = Math.max(stage.cols, right - left);   // 최소 1px/칸 보장
  boardH = Math.max(stage.rows, bottom - top);
  cellW = boardW / stage.cols;
  cellH = boardH / stage.rows;
  boardCell = Math.min(cellW, cellH);             // 스프라이트/선 두께용 대표 크기
}
function cellX(c: number): number { return boardX + c * cellW; }
function cellY(r: number): number { return boardY + r * cellH; }
function cellCenter(c: number, r: number): { x: number; y: number } {
  return { x: boardX + (c + 0.5) * cellW, y: boardY + (r + 0.5) * cellH };
}
function pointToCell(px: number, py: number): Cell | null {
  if (px < boardX || py < boardY || px >= boardX + boardW || py >= boardY + boardH) return null;
  return { c: Math.floor((px - boardX) / cellW), r: Math.floor((py - boardY) / cellH) };
}

// ===========================================================
// 버튼 시스템 (캔버스에 그리는 가상 버튼)
// ===========================================================

function addBtn(b: Partial<Btn> & { x: number; y: number; w: number; h: number; label: string; onClick: () => void }): Btn {
  const btn: Btn = {
    x: b.x, y: b.y, w: b.w, h: b.h,
    label: b.label, sub: b.sub,
    kind: b.kind || "primary",
    meta: b.meta, enabled: b.enabled !== false,
    selected: !!b.selected,
    onClick: b.onClick,
  };
  buttons.push(btn);
  return btn;
}
function hitButton(px: number, py: number): Btn | null {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (!b.enabled) continue;
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
  }
  return null;
}

// ===========================================================
// 그리기 유틸
// ===========================================================

function roundRect(x: number, y: number, w: number, h: number, rr: number) {
  const r = Math.min(rr, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawText(text: string, x: number, y: number, opts: {
  font?: string; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline;
  shadow?: string; shadowBlur?: number;
} = {}) {
  ctx.save();
  ctx.font = opts.font || 'bold 24px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.fillStyle = opts.color || "#fff";
  ctx.textAlign = opts.align || "left";
  ctx.textBaseline = opts.baseline || "alphabetic";
  if (opts.shadow) { ctx.shadowColor = opts.shadow; ctx.shadowBlur = opts.shadowBlur || 8; }
  ctx.fillText(text, x, y);
  ctx.restore();
}
function fillVerticalGradient(x: number, y: number, w: number, h: number, top: string, bot: string) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top); g.addColorStop(1, bot);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}

// ===========================================================
// 화면별 그리기
// ===========================================================

function drawBackground() {
  fillVerticalGradient(0, 0, LOGICAL_W, LOGICAL_H, COLOR.bgTop, COLOR.bgBot);
  // 별빛 점들
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 28; i++) {
    const x = (i * 79 + 13) % LOGICAL_W;
    const y = (i * 173 + 47) % LOGICAL_H;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTitleScreen(now: number) {
  if (titleAssetsLoaded > 0) {
    drawTitleScreenImage(now);
  } else {
    drawTitleScreenFallback(now);
  }
  if (!modal && !editMode) drawModeToggle();
}

// 개발자 ↔ 실전 모드 토글 (타이틀 상단 중앙)
function drawModeToggle() {
  const w = 250, h = 48, x = LOGICAL_W / 2 - w / 2, y = 12;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.3)"; roundRect(x, y + 3, w, h, h / 2); ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  if (devMode) { g.addColorStop(0, "#8a5cf0"); g.addColorStop(1, "#6a3fc8"); }
  else { g.addColorStop(0, "#34c266"); g.addColorStop(1, "#1f8f47"); }
  ctx.fillStyle = g; roundRect(x, y, w, h, h / 2); ctx.fill();
  ctx.restore();
  drawText(devMode ? "🛠 개발자 모드" : "🎯 실전 모드", x + w / 2, y + h / 2 + 9, {
    font: `900 24px ${FF}`, color: "#fff", align: "center",
  });
  addBtn({ x, y, w, h, label: "MODE", kind: "small", enabled: true,
    onClick: () => { Sfx.click(); devMode = !devMode; } });
}

// ---------- 이미지 기반 타이틀 ----------
// 각 인터랙티브 영역(클릭 hit-box, 1280×800 논리 좌표)
const TITLE_BTN = {
  EASY:       { x: 330, y: 420, w: 200, h: 130 },
  NORMAL:     { x: 540, y: 420, w: 210, h: 130 },
  HARD:       { x: 760, y: 420, w: 200, h: 130 },
  START:      { x: 480, y: 600, w: 320, h: 100 },
  SETTINGS:   { x: 40,  y: 30,  w: 100, h: 130 },
  SCOREBOARD: { x: 1140, y: 30, w: 100, h: 130 },
};

function drawEditChipButton(label: string, x: number, y: number, w: number, h: number, bgColor: string, onClick: () => void) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(x, y + 3, w, h, h / 2); ctx.fill();
  ctx.fillStyle = bgColor;
  roundRect(x, y, w, h, h / 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, h / 2); ctx.stroke();
  ctx.font = 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
  addBtn({ x, y, w, h, label, kind: "small", onClick });
}

function drawTitleScreenImage(now: number) {
  // 1) 레이아웃 순서대로 그리기
  for (const it of titleLayout) {
    if (it.cover) {
      drawAssetCover(it.key);
      continue;
    }
    // 그림자 (이미지 그리기 직전) — 버튼/배경/로고는 제외
    if (it.key === "char_blue" || it.key === "char_red") {
      drawCharacterShadow(it);
    } else if (!editMode) {
      const sk = shadowKindFor(it);
      if (sk === "ground") drawGroundShadow(it);
    }
    // 거울/레이저 기계는 이미지 자체에 드롭 그림자
    const useDrop = !editMode && shadowKindFor(it) === "drop";
    if (it.interactive && !editMode) {
      const selected = (it.interactive === "EASY"   && diff === "EASY")   ||
                       (it.interactive === "NORMAL" && diff === "NORMAL") ||
                       (it.interactive === "HARD"   && diff === "HARD");
      drawInteractiveItem(it, now, selected);
    } else if (it.clickRotates && !editMode) {
      if (useDrop) withDropShadow(() => drawRotatableDeco(it, now));
      else drawRotatableDeco(it, now);
    } else {
      if (useDrop) withDropShadow(() => drawAsset(it.key, it.x, it.y, it.w, it.h, it.rot || 0));
      else drawAsset(it.key, it.x, it.y, it.w, it.h, it.rot || 0);
    }
  }

  // 2) 클릭존 등록 — 모달/에디터 떠 있으면 등록 안 함
  if (!modal && !editMode) {
    for (const it of titleLayout) {
      if (!it.interactive) continue;
      const ik = it.interactive;
      addBtn({
        x: it.x, y: it.y, w: it.w, h: it.h,
        label: ik, kind: "small", meta: ik, selected: ik === diff,
        onClick: () => {
          Sfx.click();
          if (ik === "EASY" || ik === "NORMAL" || ik === "HARD") diff = ik;
          else if (ik === "START")      startGame();
          else if (ik === "SETTINGS")   modal = "settings";
          else if (ik === "SCOREBOARD") modal = "scoreboard";
        },
      });
    }
  }

  // 3) 모달
  if (modal && !editMode) drawTitleModal(now);

  // 4) 에디터 오버레이
  if (editMode) drawEditorOverlay(now);

  // 5) 화면 우상단 에디터 컨트롤 버튼 (모달 미오픈 시 항상 표시)
  if (!modal) drawEditorControls();
}

function drawEditorControls() {
  // 1줄: 좌하단 — 저장/리셋/종료 + z-order
  const y1 = LOGICAL_H - 36;
  let x = 14;
  const w = 92, h = 26, gap = 6;
  if (!editMode) {
    drawEditChipButton("에디터", x, y1, w, h, "#3b6fd4", () => toggleEditMode());
    return;
  }

  drawEditChipButton("저장", x, y1, w, h, "#1f8f3f", () => downloadLayoutJSON());
  x += w + gap;
  drawEditChipButton("리셋", x, y1, w, h, "#9c6f1f", () => {
    titleLayout = DEFAULT_TITLE_LAYOUT.map(c => ({ ...c }));
    editSelected = null;
    showEditToast("기본 레이아웃으로 리셋");
  });
  x += w + gap;
  drawEditChipButton("종료", x, y1, w, h, "#9c2a23", () => toggleEditMode());

  if (editSelected !== null) {
    x += w + gap + 16;
    const zw = 70;
    drawEditChipButton("맨뒤", x, y1, zw, h, "#3a4055", zSendToBack);
    x += zw + gap;
    drawEditChipButton("뒤로", x, y1, zw, h, "#3a4055", zSendBackward);
    x += zw + gap;
    drawEditChipButton("앞으로", x, y1, zw, h, "#3a4055", zBringForward);
    x += zw + gap;
    drawEditChipButton("맨앞", x, y1, zw, h, "#3a4055", zBringToFront);

    // 2줄: 위쪽 — 회전/리셋/복제/삭제 (선택 항목이 있을 때만)
    const y2 = y1 - 36;
    let x2 = 14;
    const rw = 70;
    drawEditChipButton("-15도", x2, y2, rw, h, "#5a3a8a", () => rotateSelected(-15));
    x2 += rw + gap;
    drawEditChipButton("+15도", x2, y2, rw, h, "#5a3a8a", () => rotateSelected(15));
    x2 += rw + gap;
    drawEditChipButton("-5도", x2, y2, rw, h, "#3a2a6a", () => rotateSelected(-5));
    x2 += rw + gap;
    drawEditChipButton("+5도", x2, y2, rw, h, "#3a2a6a", () => rotateSelected(5));
    x2 += rw + gap;
    drawEditChipButton("회전0", x2, y2, rw, h, "#3a2a6a", () => {
      if (editSelected !== null) { titleLayout[editSelected].rot = 0; showEditToast("회전 0도"); }
    });
    x2 += rw + gap + 16;
    drawEditChipButton("복제", x2, y2, rw, h, "#1f6f8f", duplicateSelected);
    x2 += rw + gap;
    drawEditChipButton("삭제", x2, y2, rw, h, "#9c2a23", deleteSelected);
  }
}

function rotateSelected(deg: number) {
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  it.rot = (it.rot || 0) + deg * Math.PI / 180;
  showEditToast(`${deg > 0 ? "+" : ""}${deg}° 회전`);
}
function duplicateSelected() {
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  const copy: TitleLayoutItem = { ...it, id: it.id + "_copy_" + Date.now().toString().slice(-4),
                                   x: it.x + 20, y: it.y + 20 };
  titleLayout.splice(editSelected + 1, 0, copy);
  editSelected += 1;
  showEditToast("복제: " + copy.id);
}
function deleteSelected() {
  if (editSelected === null) return;
  const removed = titleLayout.splice(editSelected, 1)[0];
  editSelected = null;
  showEditToast("삭제: " + removed.id);
}

// 캐릭터 발 아래 그림자
function drawCharacterShadow(_it: TitleLayoutItem) {
  // 그림자 비활성화 (사용자 요청: 품질 저하로 전부 제거)
}

// 바닥 위에 놓인 도구류 — 아주 옅은 단일 타원 바닥 그림자
function drawGroundShadow(it: TitleLayoutItem, opts: { widthRatio?: number; heightRatio?: number; yRatio?: number; alpha?: number } = {}) {
  const wr = opts.widthRatio ?? 0.34;
  const hr = opts.heightRatio ?? 0.05;
  const yr = opts.yRatio ?? 0.97;
  const a  = opts.alpha ?? 0.18;
  const cx = it.x + it.w / 2;
  const by = it.y + it.h * yr;
  const rx = it.w * wr;
  const ry = Math.max(4, it.w * hr);
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${a * 0.9})`;
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(cx, by, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 어떤 키에 그림자를 어떻게 입힐지 — 버튼은 제외
type ShadowKind = "none" | "ground" | "drop";
function shadowKindFor(_it: TitleLayoutItem): ShadowKind {
  // 그림자 전부 비활성화 (사용자 요청: 품질 저하로 전부 제거)
  return "none";
}

// 드롭 그림자: 이미지를 그릴 때 캔버스의 shadowColor가 자동으로 실루엣 그림자를 만든다.
// 이미지 그리기 함수가 ctx.save/restore를 안에서 쓰더라도, 외부에서 set한 shadow 상태는
// 그 save 시점에 스냅샷되므로 drawImage 동안 유지된다. (그 후 외부 restore로 깨끗이 복원)
function withDropShadow(draw: () => void) {
  ctx.save();
  ctx.shadowColor = "rgba(10,20,40,.22)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 3;
  draw();
  ctx.restore();
}

// 데코 거울 같은 회전형 — 클릭하면 그 각도만큼 돈다, 호버 시 강조
function drawRotatableDeco(it: TitleLayoutItem, now: number) {
  const img = titleImgs[it.key];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const hover = rotatableHoverId === it.id;
  const s = hover ? 1.06 : 1.0;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const dw = it.w * s, dh = it.h * s;
  const rot = it.rot || 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);

  // 호버 글로우
  if (hover) {
    ctx.save();
    const pulse = 0.7 + 0.3 * Math.sin(now / 220);
    ctx.shadowColor = `rgba(120,210,255,${pulse})`;  // 시안빛 (회전 가능 시그널)
    ctx.shadowBlur = 22;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.shadowBlur = 14;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // 본체
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // 호버 시 회전 화살표 미니 아이콘 (캔버스 좌표계)
  if (hover) {
    const ax = cx + it.w * 0.5;
    const ay = cy - it.h * 0.45;
    const R = 14;
    const spin = (now / 500) % (Math.PI * 2);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(spin);
    // 배경 원
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    // 화살표 호
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, R - 5, 0.3, Math.PI * 1.6); ctx.stroke();
    // 화살표 머리
    const ex = Math.cos(Math.PI * 1.6) * (R - 5);
    const ey = Math.sin(Math.PI * 1.6) * (R - 5);
    ctx.fillStyle = "#ffe14a";
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 6, ey - 2);
    ctx.lineTo(ex - 2, ey + 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

function drawInteractiveItem(it: TitleLayoutItem, now: number, selected: boolean) {
  const img = titleImgs[it.key];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const ik = it.interactive!;
  const hover = titleHover === ik;
  // 부드러운 스케일 — 너무 튀지 않게, 클릭 영역과 비슷하게
  let s = 1;
  if (hover) s = 1.06;
  else if (selected) s = 1.03;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const dw = it.w * s, dh = it.h * s;
  const rot = it.rot || 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);

  // 글로우 — 이미지 알파를 따라가는 두꺼운 외곽 후광 + 본체 위 살짝 밝게
  if (hover || selected) {
    const pulse = 0.7 + 0.3 * Math.sin(now / 240);
    ctx.save();

    // 1) 외곽 두꺼운 후광: shadowBlur로 여러 번 겹쳐 그려 진하게
    const glowLayers = (color: string, blurs: number[]) => {
      ctx.shadowColor = color;
      for (const b of blurs) {
        ctx.shadowBlur = b;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
    };

    if (hover && selected) {
      // 둘 다 — 노란(선택) 안쪽, 흰(호버) 바깥쪽
      glowLayers(`rgba(255,210,60,${pulse})`,  [18, 14, 10]);
      glowLayers(`rgba(255,255,255,1)`,        [24, 16, 10]);
    } else if (hover) {
      // 흰 후광 두껍게
      glowLayers(`rgba(255,255,255,1)`,        [22, 16, 12, 8]);
    } else {
      // 선택 — 노란 펄스 후광
      glowLayers(`rgba(255,210,60,${pulse})`,  [22, 16, 12, 8]);
    }
    ctx.restore();
  }

  // 본체
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);

  ctx.restore();
}

// ---------- 에디터 오버레이 ----------
function drawEditorOverlay(now: number) {
  // 어두운 반투명 + 격자
  ctx.save();
  ctx.fillStyle = "rgba(20,30,50,.18)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < LOGICAL_W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, LOGICAL_H); ctx.stroke();
  }
  for (let y = 0; y < LOGICAL_H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(LOGICAL_W, y); ctx.stroke();
  }
  ctx.restore();

  // 각 레이어 외곽 (회전 반영)
  titleLayout.forEach((it, i) => {
    if (it.cover) return;
    const isSel = editSelected === i;
    const rot = it.rot || 0;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;

    // 외곽 사각형 — 회전된 좌표계에서 그림
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.lineWidth = isSel ? 3 : 1.5;
    ctx.strokeStyle = isSel ? "#ffd24a" : "rgba(255,255,255,.55)";
    ctx.setLineDash(isSel ? [] : [4, 4]);
    ctx.strokeRect(-it.w / 2, -it.h / 2, it.w, it.h);

    // 라벨 — 회전된 사각형의 윗변 바로 위
    ctx.setLineDash([]);
    const label = it.id + (it.interactive ? ` (${it.interactive})` : "") + (rot ? `  ${Math.round((rot * 180) / Math.PI)}°` : "");
    ctx.font = 'bold 12px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isSel ? "#ffd24a" : "rgba(0,0,0,.55)";
    ctx.fillRect(-it.w / 2, -it.h / 2 - 18, tw, 18);
    ctx.fillStyle = isSel ? "#000" : "#fff";
    ctx.fillText(label, -it.w / 2 + 5, -it.h / 2 - 5);
    ctx.restore();

    // 선택된 항목 핸들 (회전 위치) — 캔버스 좌표계에서 그림
    if (isSel) {
      // 회전 핸들 연결선 + 원
      ctx.save();
      const rh = rotationHandlePos(it);
      const topCenter = localToCanvas(it, 0, -it.h / 2);
      ctx.strokeStyle = "#5ddc8c"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(topCenter.x, topCenter.y);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      // 그림자 + 외곽 + 본체
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath(); ctx.arc(rh.x, rh.y + 2, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.arc(rh.x, rh.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#5ddc8c";
      ctx.beginPath(); ctx.arc(rh.x, rh.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(rh.x, rh.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // 8개 리사이즈 핸들
      ctx.save();
      const positions = handlePositions(it);
      const s = 10;
      positions.forEach(([k, hx, hy]) => {
        const isCorner = k.length === 2;
        ctx.fillStyle = "rgba(0,0,0,.45)";
        ctx.fillRect(hx - s, hy - s + 2, s * 2, s * 2);
        ctx.fillStyle = "#000";
        ctx.fillRect(hx - s - 1, hy - s - 1, s * 2 + 2, s * 2 + 2);
        ctx.fillStyle = isCorner ? "#ffd24a" : "#7ecbff";
        ctx.fillRect(hx - s, hy - s, s * 2, s * 2);
        ctx.fillStyle = "rgba(255,255,255,.85)";
        ctx.fillRect(hx - 2, hy - 2, 4, 4);
      });
      ctx.restore();
    }
  });

  // 상단 단축키 HUD
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.75)";
  ctx.fillRect(0, 0, LOGICAL_W, 36);
  ctx.font = 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  ctx.fillStyle = "#ffd24a";
  ctx.fillText("EDIT MODE", 14, 23);
  ctx.fillStyle = "#fff";
  const help = "click=select · drag=move · 핸들=리사이즈 · 녹색원=회전(Shift=15°스냅) · O/P=회전±5°(Shift=±15°) · T=회전0° · 화살표±1px · [/]=리사이즈 · Z/Q/A/X=z · D=복제 · Del=삭제 · S=저장 · R=리셋 · E=종료";
  ctx.fillText(help, 110, 23);
  if (editSelected !== null && titleLayout[editSelected]) {
    const it = titleLayout[editSelected];
    const info = `${it.id}  x=${it.x}  y=${it.y}  w=${it.w}  h=${it.h}`;
    ctx.fillStyle = "#ffd24a";
    ctx.fillText(info, LOGICAL_W - ctx.measureText(info).width - 14, 23);
  }
  ctx.restore();

  // 토스트
  if (editToast && now < editToast.until) {
    ctx.save();
    ctx.fillStyle = "rgba(20,40,80,.92)";
    const tw = ctx.measureText(editToast.msg).width + 28;
    const x = (LOGICAL_W - tw) / 2;
    roundRect(x, LOGICAL_H - 60, tw, 38, 19);
    ctx.fill();
    ctx.font = 'bold 14px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
    ctx.fillStyle = "#fff";
    ctx.fillText(editToast.msg, x + 14, LOGICAL_H - 36);
    ctx.restore();
  }
}

// ---------- 자산 그리기 헬퍼 ----------
function drawAssetCover(k: TitleAssetKey) {
  const img = titleImgs[k];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const scale = Math.max(LOGICAL_W / img.naturalWidth, LOGICAL_H / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const dx = (LOGICAL_W - dw) / 2, dy = (LOGICAL_H - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}
function drawAsset(k: TitleAssetKey, x: number, y: number, w: number, h: number, rot: number = 0) {
  const img = titleImgs[k];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  if (rot) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
}

// 인터랙티브 자산: hover/selected 시 확대 + 글로우 오버레이
function drawInteractive(
  k: TitleAssetKey,
  b: { x: number; y: number; w: number; h: number },
  key: TitleBtnKey,
  now: number,
  selected: boolean
) {
  const img = titleImgs[k];
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const hover = titleHover === key;
  // 확대 비율 — hover 12%, selected 8%, 둘 다면 hover 우선
  let s = 1;
  if (hover) s = 1.12;
  else if (selected) s = 1.06;

  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dw = b.w * s;
  const dh = b.h * s;
  const dx = cx - dw / 2;
  const dy = cy - dh / 2;

  // 외곽 글로우 (hover: 흰색, selected only: 노란색)
  if (hover || selected) {
    ctx.save();
    const pulse = 0.7 + 0.3 * Math.sin(now / 240);
    if (hover) {
      ctx.shadowColor = `rgba(255,255,255,${0.95 * pulse})`;
      ctx.shadowBlur = 30;
    } else {
      ctx.shadowColor = `rgba(255,210,60,${0.95 * pulse})`;
      ctx.shadowBlur = 28;
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  // 본체 — 항상 그림 (글로우 위에 또렷하게)
  ctx.drawImage(img, dx, dy, dw, dh);

  // 선택된 난이도엔 노란 외곽 펄스 링도 추가
  if (selected && !hover) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 220);
    ctx.save();
    ctx.shadowColor = `rgba(255,210,60,${0.9 * pulse})`;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 5;
    ctx.strokeStyle = `rgba(255,210,60,${0.95})`;
    const r = Math.min(dh / 2, 28);
    roundRect(dx - 4, dy - 4, dw + 8, dh + 8, r);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- 모달 ----------
function drawTitleModal(now: number) {
  // 배경 어둡게 (살짝 더 어둡게 + 비네트 느낌)
  ctx.save();
  ctx.fillStyle = "rgba(6,12,28,.62)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.restore();

  const w = 540, h = 380;
  const x = (LOGICAL_W - w) / 2, y = (LOGICAL_H - h) / 2;
  const headH = 72;
  const r = 24;
  const pulse = 0.55 + 0.45 * Math.sin(now / 280);

  // 1) 노란 외곽 글로우 (게임 톤)
  ctx.save();
  ctx.shadowColor = `rgba(255,210,60,${0.55 * pulse})`;
  ctx.shadowBlur = 36;
  ctx.lineWidth = 5;
  ctx.strokeStyle = `rgba(255,210,60,${0.95})`;
  roundRect(x - 3, y - 3, w + 6, h + 6, r + 3);
  ctx.stroke();
  ctx.restore();

  // 2) 패널 본체 (그림자 + 흰 카드)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#f6faff";
  roundRect(x, y, w, h, r); ctx.fill();
  ctx.restore();

  // 3) 컬러 헤더 바 (파란 그라데이션)
  ctx.save();
  roundRect(x, y, w, h, r); ctx.clip();
  const hg = ctx.createLinearGradient(x, y, x, y + headH);
  hg.addColorStop(0, "#3b6fd4"); hg.addColorStop(1, "#2a55ad");
  ctx.fillStyle = hg;
  ctx.fillRect(x, y, w, headH);
  // 헤더 하단 노란 라인
  ctx.fillStyle = "#f5c042";
  ctx.fillRect(x, y + headH, w, 4);
  ctx.restore();

  // 4) 헤더 아이콘 (설정: 톱니, 점수판: 트로피 — 캔버스로 직접 그림)
  const iconCX = x + 38, iconCY = y + headH / 2;
  if (modal === "settings") {
    drawGearIcon(iconCX, iconCY, 18, "#ffe9a8");
  } else {
    drawTrophyIcon(iconCX, iconCY, 20, "#ffe082");
  }

  // 5) 타이틀
  const title = modal === "settings" ? "설정" : "점수판";
  drawText(title, x + 70, y + headH / 2 + 11, {
    font: '900 30px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff", align: "left", shadow: "rgba(0,0,0,.35)", shadowBlur: 6,
  });

  // 6) 헤더 우측 X 버튼 (원형)
  const xBtnR = 18;
  const xBtnX = x + w - 28 - xBtnR;
  const xBtnY = y + headH / 2 - xBtnR;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.beginPath(); ctx.arc(xBtnX + xBtnR, xBtnY + xBtnR, xBtnR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  const cx = xBtnX + xBtnR, cy = xBtnY + xBtnR, d = 7;
  ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d); ctx.stroke();
  ctx.restore();
  addBtn({
    x: xBtnX, y: xBtnY, w: xBtnR * 2, h: xBtnR * 2, label: "X", kind: "small",
    onClick: () => { modal = null; },
  });

  // 7) 본문
  const bodyTop = y + headH + 18;

  if (modal === "settings") {
    // 카드형 설정 행
    drawSettingRow(x + 24, bodyTop, w - 48, 60, "sound", "효과음", () => {
      const tgW = 76, tgH = 36;
      const tgX = x + w - 24 - tgW - 8;
      const tgY = bodyTop + (60 - tgH) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.fillStyle = soundOn ? "#2fbf55" : "#b8c0cf";
      roundRect(tgX, tgY, tgW, tgH, 18); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#fff";
      const knobX = tgX + (soundOn ? tgW - 18 : 18);
      ctx.beginPath(); ctx.arc(knobX, tgY + tgH / 2, 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      addBtn({
        x: tgX, y: tgY, w: tgW, h: tgH, label: "soundToggle", kind: "small",
        onClick: () => { soundOn = !soundOn; },
      });
    });

    drawSettingRow(x + 24, bodyTop + 72, w - 48, 60, "rotate", "회전 단위", () => {
      const rotInfo = diff === "HARD" ? "45°" : "90°";
      const subInfo = diff === "HARD" ? "HARD" : "EASY · NORMAL";
      // 우측에 둥근 칩
      const chipW = 110, chipH = 40;
      const chipX = x + w - 24 - chipW;
      const chipY = bodyTop + 72 + (60 - chipH) / 2;
      ctx.save();
      ctx.fillStyle = "#eaf1ff";
      roundRect(chipX, chipY, chipW, chipH, 14); ctx.fill();
      ctx.strokeStyle = "#c5d4ee"; ctx.lineWidth = 1.5;
      roundRect(chipX, chipY, chipW, chipH, 14); ctx.stroke();
      ctx.restore();
      drawText(rotInfo, chipX + chipW / 2, chipY + chipH / 2 + 8, {
        font: '900 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: "#1f2d4a", align: "center",
      });
      drawText(subInfo, x + w - 24 - chipW - 12, bodyTop + 72 + 60 / 2 + 5, {
        font: '600 12px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub, align: "right",
      });
    });
  } else {
    // 점수판 — 팀별 카드
    const [a, b] = teamScores;
    appData.teams.forEach((tm, i) => {
      const ty = bodyTop + i * 78;
      const rx = x + 24, rw = w - 48, rh = 64;
      // 카드 배경
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(20,40,80,.10)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      roundRect(rx, ty, rw, rh, 16); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#e3ebf7"; ctx.lineWidth = 1.5;
      roundRect(rx, ty, rw, rh, 16); ctx.stroke();
      ctx.restore();

      // 팀 컬러 원형 배지
      const badgeR = 22;
      const badgeCX = rx + 24 + badgeR;
      const badgeCY = ty + rh / 2;
      ctx.save();
      ctx.fillStyle = tm.color;
      ctx.shadowColor = "rgba(0,0,0,.18)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      ctx.beginPath(); ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 배지 하이라이트
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.32)";
      ctx.beginPath(); ctx.arc(badgeCX - 6, badgeCY - 7, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // 팀 이름
      drawText(tm.name, rx + 76, ty + rh / 2 + 8, {
        font: '900 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.ink, align: "left",
      });

      // 점수 — 큰 숫자 + 작은 "점"
      const score = i === 0 ? a : b;
      drawText("점", rx + rw - 22, ty + rh / 2 + 8, {
        font: 'bold 16px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub, align: "right",
      });
      drawText(String(score), rx + rw - 22 - 22, ty + rh / 2 + 10, {
        font: '900 30px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: tm.color, align: "right",
      });
    });
    if (a === 0 && b === 0) {
      drawText("아직 진행한 스테이지가 없습니다.", x + w / 2, bodyTop + appData.teams.length * 78 + 20, {
        font: 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub, align: "center",
      });
    }
  }

  // 8) 하단 닫기 버튼 — 카툰 풍 (오렌지/노랑 톤으로 게임 액션 느낌)
  const bW = 180, bH = 56, bX = x + w / 2 - bW / 2, bY = y + h - bH - 22;
  // 그림자
  ctx.save();
  ctx.fillStyle = "#a85a10";
  roundRect(bX, bY + 5, bW, bH, 999); ctx.fill();
  ctx.restore();
  // 본체
  ctx.save();
  const bg = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  bg.addColorStop(0, "#ffb84a"); bg.addColorStop(1, "#f08a1c");
  ctx.fillStyle = bg;
  roundRect(bX, bY, bW, bH, 999); ctx.fill();
  // 상단 광택
  const gloss = ctx.createLinearGradient(bX, bY + 4, bX, bY + bH * 0.55);
  gloss.addColorStop(0, "rgba(255,255,255,.55)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  roundRect(bX + 6, bY + 4, bW - 12, bH * 0.55, 999); ctx.fill();
  // 외곽선
  ctx.strokeStyle = "rgba(120,55,0,.65)"; ctx.lineWidth = 2.5;
  roundRect(bX, bY, bW, bH, 999); ctx.stroke();
  ctx.restore();
  drawText("닫기", bX + bW / 2, bY + bH / 2 + 10, {
    font: '900 24px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff", align: "center", shadow: "rgba(120,55,0,.6)", shadowBlur: 4,
  });
  addBtn({
    x: bX, y: bY, w: bW, h: bH, label: "닫기", kind: "primary",
    onClick: () => { modal = null; },
  });
}

// 설정 행 카드 + 아이콘 + 라벨 — content는 우측 컨트롤을 그리는 콜백
function drawSettingRow(
  x: number, y: number, w: number, h: number,
  icon: "sound" | "rotate", label: string, drawRight: () => void,
) {
  // 카드
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(20,40,80,.08)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  roundRect(x, y, w, h, 16); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "#e3ebf7"; ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 16); ctx.stroke();
  ctx.restore();
  // 아이콘
  const iconCX = x + 28, iconCY = y + h / 2;
  if (icon === "sound") drawSoundIcon(iconCX, iconCY, 14, "#3b6fd4");
  else drawRotateArrowIcon(iconCX, iconCY, 14, "#3b6fd4");
  // 라벨
  drawText(label, x + 56, y + h / 2 + 7, {
    font: 'bold 19px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: COLOR.ink, align: "left",
  });
  // 우측 컨트롤
  drawRight();
}

// 톱니바퀴 아이콘
function drawGearIcon(cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  const teeth = 8;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  // 중앙 구멍
  ctx.fillStyle = "rgba(40,80,170,.85)";
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 트로피 아이콘
function drawTrophyIcon(cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  // 컵 본체
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy - r * 0.8);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.8);
  ctx.lineTo(cx + r * 0.55, cy + r * 0.3);
  ctx.quadraticCurveTo(cx, cy + r * 0.6, cx - r * 0.55, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  // 양쪽 손잡이
  ctx.lineWidth = r * 0.18;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx - r * 0.7, cy - r * 0.3, r * 0.35, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.7, cy - r * 0.3, r * 0.35, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  // 받침
  ctx.fillRect(cx - r * 0.4, cy + r * 0.55, r * 0.8, r * 0.18);
  ctx.fillRect(cx - r * 0.6, cy + r * 0.72, r * 1.2, r * 0.22);
  ctx.restore();
}

// 스피커/사운드 아이콘
function drawSoundIcon(cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  // 스피커 박스
  ctx.fillRect(cx - r * 0.9, cy - r * 0.35, r * 0.5, r * 0.7);
  // 콘
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy - r * 0.35);
  ctx.lineTo(cx + r * 0.1, cy - r * 0.85);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.85);
  ctx.lineTo(cx - r * 0.4, cy + r * 0.35);
  ctx.closePath();
  ctx.fill();
  // 음파
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.18;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx + r * 0.25, cy, r * 0.45, -Math.PI / 4, Math.PI / 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.25, cy, r * 0.8, -Math.PI / 4, Math.PI / 4);
  ctx.stroke();
  ctx.restore();
}

// 회전 화살표 아이콘
function drawRotateArrowIcon(cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "round";
  // 거의 원형 호
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, -Math.PI * 0.85, Math.PI * 0.45);
  ctx.stroke();
  // 화살촉
  const ang = Math.PI * 0.45;
  const tipX = cx + Math.cos(ang) * r * 0.85;
  const tipY = cy + Math.sin(ang) * r * 0.85;
  const ah = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ah * Math.cos(ang - Math.PI / 6), tipY - ah * Math.sin(ang - Math.PI / 6));
  ctx.lineTo(tipX - ah * Math.cos(ang + Math.PI / 6), tipY - ah * Math.sin(ang + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTitleHighlight(
  b: { x: number; y: number; w: number; h: number },
  now: number,
  state: { selected: boolean; hover: boolean }
) {
  const pulse = 0.55 + 0.45 * Math.sin(now / 220);
  const r = Math.min(b.h / 2, 48);
  ctx.save();

  // 1) 선택된 상태 — 노란 두 겹 외곽 + 펄스 글로우
  if (state.selected) {
    // 바깥 후광
    ctx.shadowColor = `rgba(255,210,60,${0.9})`;
    ctx.shadowBlur = 36 + 18 * pulse;
    ctx.lineWidth = 8;
    ctx.strokeStyle = `rgba(255,210,60,${0.95})`;
    roundRect(b.x - 9, b.y - 9, b.w + 18, b.h + 18, r + 4);
    ctx.stroke();
    // 안쪽 가는 흰 외곽 — 명료성 ↑
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    roundRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8, r);
    ctx.stroke();
  }

  // 2) hover 상태 — 사이언/흰 강한 외곽 + 살짝 밝아짐
  if (state.hover) {
    // 안쪽 페인트 — 마우스가 올라간 게 한눈에 보이도록
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = state.selected ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.22)";
    roundRect(b.x, b.y, b.w, b.h, r);
    ctx.fill();

    // 외곽 두꺼운 흰색 글로우 링
    ctx.shadowColor = "rgba(255,255,255,.95)";
    ctx.shadowBlur = 30;
    ctx.lineWidth = state.selected ? 4 : 6;
    ctx.strokeStyle = state.selected ? "rgba(255,255,255,.95)" : "#ffffff";
    roundRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12, r + 2);
    ctx.stroke();

    // 가는 사이언 강조선(미세) — 윗부분에 빛 줄
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(180,230,255,.7)";
    ctx.lineWidth = 1.5;
    roundRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4, r);
    ctx.stroke();
  }

  ctx.restore();
}

// ---------- Fallback (이미지 로드 전/실패) ----------
function drawTitleScreenFallback(now: number) {
  drawBackground();

  const cx = LOGICAL_W / 2;
  ctx.save();
  ctx.fillStyle = "#1d3f86";
  ctx.font = '900 110px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(textData.title, cx + 4, 204);
  ctx.fillStyle = "#fff";
  ctx.fillText(textData.title, cx, 200);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.32)";
  roundRect(cx - 320, 232, 640, 50, 25); ctx.fill();
  drawText(textData.tagline, cx, 266, {
    font: 'bold 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
  });
  ctx.restore();

  drawDecoMirror(160, 470, now, "#fff");
  drawDecoMirror(LOGICAL_W - 160, 470, now, "#fff", true);

  const diffs = ["EASY", "NORMAL", "HARD"];
  const dColors: { [k: string]: string } = { EASY: COLOR.green, NORMAL: COLOR.orange, HARD: COLOR.red };
  const bW = 200, bH = 110, gap = 36, totalW = bW * 3 + gap * 2;
  const startX = (LOGICAL_W - totalW) / 2;
  diffs.forEach((d, i) => {
    const x = startX + i * (bW + gap);
    const y = 360;
    drawDiffButton(x, y, bW, bH, d, dColors[d], diff === d);
  });

  const sW = 320, sH = 78;
  drawStartButton((LOGICAL_W - sW) / 2, 510, sW, sH, textData.startBtn);
}

function drawDecoMirror(cx: number, cy: number, now: number, _color: string, flip: boolean = false) {
  const s = 80 + Math.sin(now / 600) * 4;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  // 타일
  roundRect(-s/2, -s/2, s, s, 14);
  const g = ctx.createLinearGradient(0, -s/2, 0, s/2);
  g.addColorStop(0, "#f4f8ff"); g.addColorStop(1, "#c9d7ee");
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "#7d92b8"; ctx.stroke();
  // 거울선
  ctx.lineCap = "round"; ctx.lineWidth = 14;
  const mg = ctx.createLinearGradient(-s/2, -s/2, s/2, s/2);
  mg.addColorStop(0, "#bfe6ff"); mg.addColorStop(0.5, "#5fa8e8"); mg.addColorStop(1, "#2f6fc0");
  ctx.strokeStyle = mg;
  ctx.beginPath();
  ctx.moveTo(-s/2 + 14, s/2 - 14); ctx.lineTo(s/2 - 14, -s/2 + 14);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
}

function drawDiffButton(x: number, y: number, w: number, h: number, key: string, color: string, isSel: boolean) {
  const d = appData.difficulties[key];
  ctx.save();
  // 그림자
  ctx.fillStyle = "rgba(0,0,0,.28)";
  roundRect(x, y + 8, w, h, 18); ctx.fill();
  // 본체
  ctx.fillStyle = color;
  roundRect(x, y - (isSel ? 4 : 0), w, h, 18); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 3;
  ctx.stroke();
  // 메인 라벨
  drawText(d.label, x + w / 2, y + (isSel ? -4 : 0) + 50, {
    font: '900 34px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
  });
  // 서브 라벨
  ctx.fillStyle = "rgba(0,0,0,.22)";
  roundRect(x + w / 2 - 38, y + (isSel ? -4 : 0) + 64, 76, 26, 13); ctx.fill();
  drawText(d.sub, x + w / 2, y + (isSel ? -4 : 0) + 83, {
    font: 'bold 16px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
  });
  // 선택 표시
  if (isSel) {
    ctx.lineWidth = 5; ctx.strokeStyle = "#fff";
    roundRect(x - 5, y - 9, w + 10, h + 10, 22); ctx.stroke();
  }
  ctx.restore();

  addBtn({
    x, y: y - 4, w, h: h + 4,
    label: key, kind: "diff", meta: key, selected: isSel,
    onClick: () => { diff = key; Sfx.click(); },
  });
}

function drawStartButton(x: number, y: number, w: number, h: number, label: string) {
  ctx.save();
  ctx.fillStyle = "#16336e";
  roundRect(x, y + 9, w, h, 999); ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#2f64c8"); g.addColorStop(1, "#214a99");
  ctx.fillStyle = g;
  roundRect(x, y, w, h, 999); ctx.fill();
  drawText(label, x + w / 2, y + h / 2 + 13, {
    font: '900 38px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
  });
  ctx.restore();

  addBtn({
    x, y, w, h, label, kind: "primary",
    onClick: () => { Sfx.click(); startGame(); },
  });
}

// ---------- 게임 화면 ----------

function drawGameScreen(now: number) {
  drawBackground();
  drawHud();
  drawBoard(now);
  drawCombo(now);
  drawFooter();

  if (screen === "intro") drawBanner(textData.stageStart);
  if (screen === "result") drawResultCard();
}

function drawCombo(now: number) {
  if (comboRings.length === 0 && comboParticles.length === 0 && comboPopups.length === 0) return;

  // 1) 링 (가장 뒤)
  for (const r of comboRings) {
    const t = Math.min(1, (now - r.bornMs) / r.life);
    const radius = r.maxR * (0.25 + 0.75 * t);
    const alpha = 1 - t;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(2, 6 * (1 - t));
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // 내부 후광
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2) 파티클
  for (const p of comboParticles) {
    const t = Math.min(1, (now - p.bornMs) / p.life);
    const alpha = 1 - t;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 3) 콤보 텍스트 (위로 떠오르며 페이드)
  for (const pp of comboPopups) {
    const t = Math.min(1, (now - pp.bornMs) / pp.life);
    const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    const yOff = -boardCell * 0.15 - boardCell * 0.55 * t;
    const scale = 0.8 + Math.min(0.4, t * 2);
    const col = comboColor(pp.count);
    const text = "COMBO x" + pp.count;
    const fontSize = Math.round(boardCell * 0.36 * scale);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `900 ${fontSize}px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 외곽
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeText(text, pp.x, pp.y + yOff);
    // 본체
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.fillText(text, pp.x, pp.y + yOff);
    ctx.restore();
  }
}

const FF = '"GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
function drawHud() {
  if (!stageP) return;
  // 배경 — 위아래 그라데이션 + 하단 강조선
  const bg = ctx.createLinearGradient(0, 0, 0, HUD_H);
  bg.addColorStop(0, "rgba(18,30,56,.92)");
  bg.addColorStop(1, "rgba(12,22,44,.78)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);
  ctx.fillStyle = "rgba(120,170,255,.45)";
  ctx.fillRect(0, HUD_H - 3, LOGICAL_W, 3);

  // 좌측: 라운드 배지 (둥근 알약) — 76px 바 안에 (넓은 보드가 바 아래를 덮으므로 절대 안 넘김)
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 2;
  const rg = ctx.createLinearGradient(0, 6, 0, 70);
  rg.addColorStop(0, "#ffd24a"); rg.addColorStop(1, "#f0a92b");
  ctx.fillStyle = rg;
  roundRect(18, 7, 108, 62, 18); ctx.fill();
  ctx.restore();
  drawText(`${stageP.round}R`, 72, 55, { font: `900 50px ${FF}`, color: "#3a2400", align: "center" });
  drawText(`STAGE ${stageP.round}-${stageP.stageInRound}`, 140, 46, {
    font: `bold 24px ${FF}`, color: "#fff",
  });

  // 중앙: 턴 / 타이머
  const team = appData.teams[stageP.team];
  const t = currentTimerSec();
  const tagW = 340, tagH = 56;
  const tagX = LOGICAL_W / 2 - tagW / 2;
  ctx.save();
  ctx.shadowColor = team.color; ctx.shadowBlur = 18;
  ctx.fillStyle = team.color;
  roundRect(tagX, 9, tagW, tagH, 28); ctx.fill();
  ctx.restore();
  // 팀 색 점
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(tagX + 34, 37, 11, 0, Math.PI * 2); ctx.fill();
  drawText(team.name + textData.turnSuffix, LOGICAL_W / 2 + 18, 50, {
    font: `900 38px ${FF}`, color: "#fff", align: "center",
  });
  if (t >= 0) {
    let color = "#fff";
    if (screen === "manipulate") {
      if (t <= 5) color = "#ff5b4d";
      else if (t <= 10) color = COLOR.yellow;
    }
    drawText(String(t).padStart(2, "0"), tagX + tagW + 22, 50, {
      font: `900 32px ${FF}`, color, align: "left",
    });
  }

  // 우측: 팀 점수 배지 (현재 팀 강조)
  const sW = 104, sH = 56, sGap = 10;
  const x0 = LOGICAL_W - (sW * 2 + sGap) - 20;
  for (let i = 0; i < 2; i++) {
    const sx = x0 + i * (sW + sGap);
    const sy = 8;
    const active = stageP.team === i;
    ctx.save();
    if (active) { ctx.shadowColor = appData.teams[i].color; ctx.shadowBlur = 16; }
    const g = ctx.createLinearGradient(sx, sy, sx, sy + sH);
    g.addColorStop(0, appData.teams[i].color);
    g.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.fillStyle = g;
    roundRect(sx, sy, sW, sH, 16); ctx.fill();
    ctx.restore();
    if (active) { ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff"; roundRect(sx, sy, sW, sH, 16); ctx.stroke(); }
    drawText(appData.teams[i].name, sx + sW / 2, sy + 22, {
      font: `bold 18px ${FF}`, color: "rgba(255,255,255,.95)", align: "center",
    });
    drawText(String(teamScores[i]), sx + sW / 2, sy + 50, {
      font: `900 32px ${FF}`, color: "#fff", align: "center",
    });
  }
}

function currentTimerSec(): number {
  if (devMode) return -1;   // devMode: 시간 표시 제거
  if (!stage || !stageP) return -1;
  const el = (lastFrameMs - phaseStartMs) / 1000;
  if (screen === "predict") return Math.max(0, Math.ceil(stage.predict - el));
  if (screen === "manipulate") return Math.max(0, Math.ceil(stage.time - el));
  return -1;
}

function drawBoard(now: number) {
  if (!stage) return;
  // 보드 배경 — 난이도별 보드 이미지를 원본 그대로 그리기 (없으면 그라데이션 + 격자 fallback)
  const boardImg = titleImgs[boardKeyFor(diff)];
  const useImg = !!(boardImg && boardImg.complete && boardImg.naturalWidth > 0);
  if (useImg) {
    ctx.save();
    ctx.drawImage(boardImg!, boardImgX, boardImgY, boardImgW, boardImgH);
    ctx.restore();
    // 보드에 격자가 새겨져 있으므로 코드 격자선은 그리지 않는다 (선 겹침/어긋남 방지).
    // 플레이 칸은 보드의 새겨진 격자 위에 정렬되어 말이 그 칸에 놓인다.
  } else {
    ctx.save();
    fillVerticalGradient(boardX, boardY, boardW, boardH, COLOR.gridTop, COLOR.gridBot);
    ctx.restore();
    ctx.strokeStyle = COLOR.gridLine; ctx.lineWidth = 1;
    for (let c = 1; c < stage.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(cellX(c), boardY);
      ctx.lineTo(cellX(c), boardY + boardH);
      ctx.stroke();
    }
    for (let r = 1; r < stage.rows; r++) {
      ctx.beginPath();
      ctx.moveTo(boardX, cellY(r));
      ctx.lineTo(boardX + boardW, cellY(r));
      ctx.stroke();
    }
    ctx.lineWidth = 3; ctx.strokeStyle = COLOR.gridEdge;
    roundRect(boardX + 1.5, boardY + 1.5, boardW - 3, boardH - 3, 12);
    ctx.stroke();
  }

  // (거울 면은 solInDir 기준으로 drawMirror가 고정 결정 — 매 프레임 추적 불필요.)

  // 셀별 요소
  stage.forbidden.forEach(f => drawForbidden(f, now));
  stage.walls.forEach(w => drawWall(w));
  stage.movers.forEach(mv => drawMover(mv));
  drawTarget(stage.target, now);
  drawEmitter(stage.emitter, now);
  stage.mirrors.forEach(m => drawMirror(m, now));

  if (beam && (screen === "fire" || screen === "result")) drawBeam(now);

  if (gridCalibMode) drawGridCalibOverlay();
}

// 격자 보정 오버레이 — 밝은 청록 격자선 + 키 안내/현재값 표시
function drawGridCalibOverlay() {
  if (!stage) return;
  ctx.save();
  ctx.strokeStyle = "rgba(0,230,255,.95)";
  ctx.lineWidth = 1.5;
  for (let c = 0; c <= stage.cols; c++) {
    ctx.beginPath();
    ctx.moveTo(cellX(c), boardY);
    ctx.lineTo(cellX(c), boardY + boardH);
    ctx.stroke();
  }
  for (let r = 0; r <= stage.rows; r++) {
    ctx.beginPath();
    ctx.moveTo(boardX, cellY(r));
    ctx.lineTo(boardX + boardW, cellY(r));
    ctx.stroke();
  }
  const cal = gridCalib[diff] || { dx: 0, dy: 0, dc: 0, dcols: 0, drows: 0, dl: 0, dr: 0, dt: 0, db: 0 };
  const line1 = `격자보정 [${diff}]  ←↑↓→ 이동(Shift×5)  [ ] 칸크기  , . 열  ; ' 행  ·  모서리늘리기  A/D 좌  J/L 우  W/X 상  I/K 하  ·  S 저장  Shift+S 파일내보내기  R 리셋  G 끄기`;
  const line2 = `${stage.cols}×${stage.rows}칸  cellW=${cellW.toFixed(1)} cellH=${cellH.toFixed(1)}  dx=${cal.dx} dy=${cal.dy} dc=${cal.dc}  L=${cal.dl||0} R=${cal.dr||0} T=${cal.dt||0} B=${cal.db||0}`;
  ctx.font = 'bold 16px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 28;
  ctx.fillStyle = "rgba(8,18,38,.85)";
  roundRect((LOGICAL_W - w) / 2, HUD_H + 6, w, 54, 8);
  ctx.fill();
  ctx.fillStyle = "#bff7ff";
  ctx.textAlign = "center";
  ctx.fillText(line1, LOGICAL_W / 2, HUD_H + 26);
  ctx.fillStyle = "#e8fbff";
  ctx.fillText(line2, LOGICAL_W / 2, HUD_H + 48);
  ctx.restore();
}

function drawForbidden(f: Cell, now: number) {
  const x = cellX(f.c), y = cellY(f.r);
  const pulse = 0.5 + 0.5 * Math.sin(now / 240);
  ctx.save();
  roundRect(x + 3, y + 3, cellW - 6, cellH - 6, 8);
  ctx.clip();
  ctx.fillStyle = `rgba(224,71,61,${0.32 + pulse * 0.22})`;
  ctx.fillRect(x, y, cellW, cellH);
  ctx.strokeStyle = "rgba(150,20,15,.55)"; ctx.lineWidth = 6;
  for (let i = -cellH; i < cellW; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + cellH);
    ctx.lineTo(x + i + cellH, y);
    ctx.stroke();
  }
  ctx.restore();
  drawText("✕", x + cellW / 2, y + cellH / 2 + boardCell * 0.13, {
    font: `bold ${Math.round(boardCell * 0.42)}px sans-serif`, color: "#fff", align: "center",
  });
}

function drawWall(w: Cell) {
  // 벽돌 이미지 두 종류(stone / stone_small)를 칸 위치로 번갈아 써서 단조롭지 않게.
  const img = ((w.c + w.r) % 2 === 0 ? titleImgs.stone : titleImgs.stone_small) || titleImgs.stone;
  // 벽돌을 칸보다 살짝 크게(칸 밖으로 넘치게) 그려 더 큼직하게.
  const over = 1.16;
  const w2 = cellW * over, h2 = cellH * over;
  const ccx = cellX(w.c) + cellW / 2, ccy = cellY(w.r) + cellH / 2;
  const x = cellX(w.c), y = cellY(w.r);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, ccx - w2 / 2, ccy - h2 / 2, w2, h2);
  } else {
    const p = boardCell * 0.1;
    const g = ctx.createLinearGradient(x, y, x, y + cellH);
    g.addColorStop(0, "#8a93a6"); g.addColorStop(1, "#5d6678");
    ctx.fillStyle = g;
    roundRect(x + p, y + p, cellW - p * 2, cellH - p * 2, 9);
    ctx.fill();
    ctx.strokeStyle = "#454c5c"; ctx.lineWidth = 3; ctx.stroke();
  }
}

function drawMover(mv: Mover) {
  // 보간 위치
  const tf = mv.t;
  const i0 = Math.floor(tf);
  const i1 = Math.min(mv.track.length - 1, i0 + 1);
  const f = tf - i0;
  const a = mv.track[i0]; const b = mv.track[i1];
  const x = boardX + ((a.c * (1 - f) + b.c * f) + 0.5) * cellW;
  const y = boardY + ((a.r * (1 - f) + b.r * f) + 0.5) * cellH;

  // 트랙(점선 안내)
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(120,60,60,.45)"; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < mv.track.length; i++) {
    const cc = boardX + (mv.track[i].c + 0.5) * cellW;
    const rr = boardY + (mv.track[i].r + 0.5) * cellH;
    if (i === 0) ctx.moveTo(cc, rr); else ctx.lineTo(cc, rr);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 몸체 (양 이미지). 진행 방향대로 회전 (이미지 기본은 위쪽을 향함).
  const img = titleImgs.mover;
  const size = boardCell * 0.82;
  // 현재 이동 속도 벡터 = (트랙 세그먼트 방향) × 왕복 방향
  const vx = (b.c - a.c) * mv.dir;
  const vy = (b.r - a.r) * mv.dir;
  const ang = (vx !== 0 || vy !== 0) ? Math.atan2(vy, vx) + Math.PI / 2 : 0;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 10;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    const R = boardCell * 0.34;
    const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.2, x, y, R);
    g.addColorStop(0, "#f6837a"); g.addColorStop(1, "#9c2a23");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// 명중 전환을 부드럽게: 0=평소 → 1=명중 으로 매 프레임 lerp (즉시 교체 X, 크로스페이드)
let targetHitMix = 0;
let targetHitLastNow = 0;
// 타깃 두 이미지(target/target_hit)는 캔버스 안 장치 위치·크기가 달라, 같은 사각형에 그리면
// 코어(원형 눈)가 다르게 보여 크기가 변하는 듯함. 그래서 각 이미지의 '원형 코어'를 화면상
// 같은 중심·반지름에 앵커링해서 그린다. cx/cy=코어중심(이미지 폭/높이 비율), r=코어반지름(폭 비율).
// 눈대중 값 → 안 맞으면 여기 숫자만 미세조정.
const TARGET_CORE = {
  normal: { cx: 0.47, cy: 0.37, r: 0.205 },
  hit:    { cx: 0.50, cy: 0.43, r: 0.185 },
};
// 코어를 셀 중앙에 두면 받침대(스탠드)가 아래로 늘어져 전체가 아래로 치우쳐 보임 → 칸 높이의
// 이만큼 위로 올려 그리드 중앙에 맞춘다. (안 맞으면 이 값만 미세조정)
const TARGET_LIFT = 0.16;
function drawTargetSprite(img: HTMLImageElement, core: { cx: number; cy: number; r: number },
                          cx: number, cy: number, screenR: number, flip: boolean) {
  const scale = screenR / (core.r * img.naturalWidth);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const ox = core.cx * w, oy = core.cy * h;   // 좌상단→코어중심 거리(스케일 적용 후)
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);   // 빔 오는 방향으로 좌우반전
  ctx.drawImage(img, -ox, -oy, w, h);
  ctx.restore();
}
function drawTarget(t: Cell, now: number) {
  const { x, y: cellMidY } = cellCenter(t.c, t.r);
  const y = cellMidY - boardCell * TARGET_LIFT;   // 그리드 중앙에 맞게 위로 보정
  const blink = 0.55 + 0.45 * Math.sin(now / 260);
  // (타깃 뒷면 미사용 — 항상 앞면 이미지)
  // 명중 상태 — 결과 화면이고 perfect/partial일 때 + fire 화면에서 빔이 타겟에 도달했을 때
  const isHit = !!(beam && (
    (screen === "result" && (beam.result === "perfect" || beam.result === "partial")) ||
    (screen === "fire" && beamProgress >= 0.95 && (beam.result === "perfect" || beam.result === "partial"))
  ));
  // 평소↔명중 사이를 ~220ms에 걸쳐 선형 보간 → 이미지가 자연스럽게 섞인다.
  const dt = targetHitLastNow ? Math.min(100, now - targetHitLastNow) : 16;
  targetHitLastNow = now;
  const step = dt / 220;
  const aim = isHit ? 1 : 0;
  if (targetHitMix < aim) targetHitMix = Math.min(aim, targetHitMix + step);
  else if (targetHitMix > aim) targetHitMix = Math.max(aim, targetHitMix - step);
  const mix = targetHitMix;

  const imgNormal = titleImgs.target;
  const imgHit = titleImgs.target_hit;
  // 항상 '마지막 거울'을 바라보게 좌우반전. 마지막 거울이 타깃보다 왼쪽이면 왼쪽을 보도록 flip.
  const lastMirror = stage && stage.mirrors.length ? stage.mirrors[stage.mirrors.length - 1] : null;
  const flip = !!(lastMirror && lastMirror.c < t.c);
  const screenR = boardCell * 0.30;   // 화면상 코어 반지름(전체 타깃 크기 ≈ 1.4칸)
  const ready = (im?: HTMLImageElement) => !!(im && im.complete && im.naturalWidth > 0);
  if (ready(imgNormal) || ready(imgHit)) {
    // 글로우: 노랑(평소) → 빨강(명중) 색·세기를 mix로 보간
    const pulseFast = 0.6 + 0.4 * Math.sin(now / 90);
    const gR = Math.round(255);
    const gG = Math.round(200 + (60 - 200) * mix);
    const gB = Math.round(80 + (40 - 80) * mix);
    const glowA = blink * (1 - mix) + pulseFast * mix;
    const glowBlur = 22 * blink * (1 - mix) + 40 * pulseFast * mix;
    ctx.save();
    ctx.shadowColor = `rgba(${gR},${gG},${gB},${glowA})`;
    ctx.shadowBlur = glowBlur;
    // 두 이미지를 코어 앵커링 + 알파 크로스페이드 → 크기·위치가 안 변하고 자연스럽게 섞인다.
    if (ready(imgNormal) && mix < 1) {
      ctx.globalAlpha = 1 - mix;
      drawTargetSprite(imgNormal, TARGET_CORE.normal, x, y, screenR, flip);
    }
    if (ready(imgHit) && mix > 0) {
      ctx.globalAlpha = mix;
      drawTargetSprite(imgHit, TARGET_CORE.hit, x, y, screenR, flip);
    }
    ctx.restore();

    // 명중 이펙트(스파클·플래시)는 mix에 비례해 서서히 등장
    if (mix > 0.01) {
      ctx.save();
      ctx.globalAlpha = mix;
      // 광선 스파클 — 8방향으로 짧은 흰/노란 선
      const rayLen = boardCell * (0.6 + 0.3 * Math.sin(now / 70));
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + now / 800;
        const rx = Math.cos(ang) * (boardCell * 0.5);
        const ry = Math.sin(ang) * (boardCell * 0.5);
        const ex = Math.cos(ang) * (boardCell * 0.5 + rayLen);
        const ey = Math.sin(ang) * (boardCell * 0.5 + rayLen);
        const grd = ctx.createLinearGradient(x + rx, y + ry, x + ex, y + ey);
        grd.addColorStop(0, "rgba(255,230,120,.95)");
        grd.addColorStop(1, "rgba(255,80,30,0)");
        ctx.strokeStyle = grd;
        ctx.beginPath();
        ctx.moveTo(x + rx, y + ry);
        ctx.lineTo(x + ex, y + ey);
        ctx.stroke();
      }
      // 흰 코어 플래시
      const flash = 0.4 + 0.6 * Math.abs(Math.sin(now / 60));
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, boardCell * 0.18 * flash, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    const R = boardCell * 0.4;
    ctx.save();
    ctx.shadowColor = `rgba(80,200,120,${blink})`; ctx.shadowBlur = 22 * blink;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(x, y, R * (1 - i * 0.3), 0, Math.PI * 2);
      ctx.lineWidth = boardCell * 0.1;
      ctx.strokeStyle = i % 2 === 0
        ? `rgba(40,170,80,${0.6 + blink * 0.4})`
        : "rgba(255,255,255,.9)";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, R * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(50,200,90,${blink})`; ctx.fill();
    ctx.restore();
  }
}

// emitter_game.png의 렌즈가 기본적으로 향하는 화면각도(정하단 ↓ = 90°). 이미지 교체 시 여기만 맞추면 됨.
const EMITTER_IMG_ANGLE = Math.PI / 2;
// 발사 직선을 따라가 첫 거울 셀의 방향을 반환 (없으면 발사 방향). 화면 좌표 기준 라디안.
function emitterAimAngle(e: Stage["emitter"]): number {
  const card: { [k in Dir]: number } = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };
  if (stage) {
    const d = DELTA[e.dir];
    let c = e.c + d[0], r = e.r + d[1];
    while (c >= 0 && r >= 0 && c < stage.cols && r < stage.rows) {
      if (stage.mirrors.some(m => m.c === c && m.r === r)) {
        const src = cellCenter(e.c, e.r), dst = cellCenter(c, r);
        return Math.atan2(dst.y - src.y, dst.x - src.x);
      }
      c += d[0]; r += d[1];
    }
  }
  return card[e.dir];
}

function drawEmitter(e: Stage["emitter"], now: number) {
  const cc = cellCenter(e.c, e.r);
  const glow = 0.6 + 0.4 * Math.sin(now / 200);
  const img = titleImgs.emitter_game || titleImgs.emitter;
  const size = boardCell * 1.08;

  // 발사 직선상의 첫 거울을 향하도록 회전. emitter_game.png 렌즈가 기본적으로 좌하(≈135°)를 향하므로 그만큼 보정.
  const aim = emitterAimAngle(e);

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(cc.x, cc.y);
    ctx.rotate(aim - EMITTER_IMG_ANGLE);
    // 점등 효과 (배경 후광)
    ctx.shadowColor = `rgba(255,90,60,${glow})`;
    ctx.shadowBlur = 24 * glow;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    // fallback
    const x = cellX(e.c), y = cellY(e.r), p = boardCell * 0.12;
    const g = ctx.createLinearGradient(x, y, x, y + cellH);
    g.addColorStop(0, "#4b5670"); g.addColorStop(1, "#2b3247");
    ctx.fillStyle = g;
    roundRect(x + p, y + p, cellW - p * 2, cellH - p * 2, 9);
    ctx.fill();
    ctx.strokeStyle = "#1c2233"; ctx.lineWidth = 3; ctx.stroke();
    const d = DELTA[e.dir];
    const lx = cc.x + d[0] * boardCell * 0.34;
    const ly = cc.y + d[1] * boardCell * 0.34;
    ctx.save();
    ctx.shadowColor = `rgba(255,80,60,${glow})`; ctx.shadowBlur = 20 * glow;
    ctx.beginPath();
    ctx.arc(lx, ly, boardCell * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,${Math.round(90 + glow * 80)},70,1)`;
    ctx.fill();
    ctx.restore();
  }
}

function drawMirror(m: Mirror, now: number) {
  const { x: cx, y: cy } = cellCenter(m.c, m.r);
  const selectable = screen === "manipulate";
  const isSel = selectedMirror === m.id;

  // 대각선(/,\)은 기존대로 앞면(유리)/뒷면(회로)을 빔 방향(solInDir)으로 표시 + 좌우플립.
  // |,- (HARD 45° 추가 상태)는 삼각형 안 쓰고 그냥 기본 거울을 회전해서 표시(앞면만).
  const isAxis = (m.ori === "|" || m.ori === "-");
  const inDir = solInDir[m.id];
  const r = inDir != null ? faceForBeam(m.ori, inDir) : { back: false, flip: (m.ori === "\\") };
  const front = titleImgs.mirror_front || titleImgs.mirror_game || titleImgs.mirror;
  const img: HTMLImageElement | undefined = isAxis
    ? front
    : ((r.back ? (titleImgs.mirror_back || front) : front) || titleImgs.mirror);
  const flip = r.flip;

  // 선택 가능 표시 (펄스 글로우 배경)
  if (selectable) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.save();
    ctx.shadowColor = `rgba(245,192,66,${0.55 + pulse * 0.45})`;
    ctx.shadowBlur = 22 + pulse * 14;
    ctx.fillStyle = "rgba(245,192,66,.14)";
    ctx.beginPath();
    ctx.arc(cx, cy, boardCell * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 거울 이미지 — 대각선만 좌우플립(상하반전/회전 없음). 그리드 안에 들어오게 칸보다 약간 작게.
  const size = boardCell * 0.98;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(cx, cy);
    if (isAxis) ctx.rotate(oriToAngle45(m.ori));   // |,- 회전
    else if (flip) ctx.scale(-1, 1);               // \ 는 좌우플립
    if (isSel) { ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 18; }
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    // fallback (이미지 로드 실패 시 단순 거울선) — 칸 중앙 기준 정사각으로 그린다
    const x = cx - boardCell / 2, y = cy - boardCell / 2, pad = boardCell * 0.14;
    const m1 = boardCell * 0.22, m2 = boardCell - m1;
    const g = ctx.createLinearGradient(x, y, x, y + boardCell);
    g.addColorStop(0, "#f4f8ff"); g.addColorStop(1, "#c9d7ee");
    ctx.fillStyle = g;
    roundRect(x + pad, y + pad, boardCell - pad * 2, boardCell - pad * 2, 9);
    ctx.fill();
    ctx.lineCap = "round"; ctx.lineWidth = boardCell * 0.16;
    const mg = ctx.createLinearGradient(x, y, x + boardCell, y + boardCell);
    mg.addColorStop(0, "#bfe6ff"); mg.addColorStop(0.5, "#5fa8e8"); mg.addColorStop(1, "#2f6fc0");
    ctx.strokeStyle = mg;
    ctx.beginPath();
    if (m.ori.charAt(0) === "/") { ctx.moveTo(x + m1, y + m2); ctx.lineTo(x + m2, y + m1); }
    else                         { ctx.moveTo(x + m1, y + m1); ctx.lineTo(x + m2, y + m2); }
    ctx.stroke();
  }

  // (선택 외곽 흰색 원 제거)

  // 회전 아이콘
  if (selectable) {
    const p = boardCell * 0.14;
    const x = cellX(m.c);
    const y = cellY(m.r);
    drawRotateIcon(x + cellW - p, y + p, boardCell * 0.16, now);
  }
}

function drawRotateIcon(cx: number, cy: number, R: number, now: number) {
  const spin = (now / 600) % (Math.PI * 2);
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(spin);
  ctx.strokeStyle = COLOR.yellow; ctx.lineWidth = R * 0.36; ctx.lineCap = "round";
  ctx.beginPath(); ctx.arc(0, 0, R, 0.4, Math.PI * 1.6); ctx.stroke();
  const ex = Math.cos(Math.PI * 1.6) * R, ey = Math.sin(Math.PI * 1.6) * R;
  ctx.fillStyle = COLOR.yellow;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - R * 0.5, ey - R * 0.1);
  ctx.lineTo(ex - R * 0.1, ey + R * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawBeam(_now: number) {
  if (!beam) return;
  // 모든 칸 경로(beamCells)로 그린다. 양에 막혔으면(beamCutIndex) 그 칸까지만.
  const src = beamCells.length ? beamCells : beam.points;
  const srcPts = beamCutIndex >= 0 ? src.slice(0, beamCutIndex + 1) : src;
  const pts = srcPts.map(p => cellCenter(p.c, p.r));
  if (pts.length < 2) return;
  // 빔 시작점을 발사기 총구 앞쪽으로 밀어낸다 (몸통에서 나오지 않게). 로직은 그대로, 렌더만 보정.
  if (stage) {
    const d = DELTA[stage.emitter.dir];
    const len = Math.hypot(d[0], d[1]) || 1;
    pts[0] = { x: pts[0].x + (d[0] / len) * boardCell * 0.5, y: pts[0].y + (d[1] / len) * boardCell * 0.5 };
  }

  const segLen: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLen.push(d); total += d;
  }
  const reveal = total * beamProgress;
  const line: { x: number; y: number }[] = [pts[0]];
  let acc = 0; let head = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (acc + segLen[i - 1] <= reveal) {
      line.push(pts[i]); acc += segLen[i - 1]; head = pts[i];
    } else {
      const t = (reveal - acc) / segLen[i - 1];
      head = {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      };
      line.push(head); break;
    }
  }
  const col = beam.result === "fail" && beamProgress >= 1 ? "#ff3b30" : COLOR.beamMain;

  ctx.save();
  ctx.lineJoin = "round"; ctx.lineCap = "round";

  // 1) 가장 바깥쪽 큰 후광
  ctx.shadowColor = col; ctx.shadowBlur = 30;
  ctx.strokeStyle = "rgba(255,140,60,.32)";
  ctx.lineWidth = boardCell * 0.35;
  drawPoly(line);

  // 2) 중간 발광
  ctx.shadowBlur = 22;
  ctx.strokeStyle = COLOR.beamGlow; ctx.lineWidth = boardCell * 0.22;
  drawPoly(line);

  // 3) 본체
  ctx.shadowBlur = 14;
  ctx.strokeStyle = col; ctx.lineWidth = boardCell * 0.11;
  drawPoly(line);

  // 4) 코어 (밝은 흰빛)
  ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 8;
  ctx.strokeStyle = COLOR.beamCore; ctx.lineWidth = boardCell * 0.045;
  drawPoly(line);

  // 5) 빔 끝점 — 진행 중이면 큰 화이트 글로우 볼
  if (beamProgress < 1) {
    ctx.shadowColor = col; ctx.shadowBlur = 34;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(head.x, head.y, boardCell * 0.14, 0, Math.PI * 2); ctx.fill();

    // 부드러운 외부 후광
    ctx.shadowBlur = 0;
    const rg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, boardCell * 0.45);
    rg.addColorStop(0, "rgba(255,230,170,.55)");
    rg.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(head.x, head.y, boardCell * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawPoly(line: { x: number; y: number }[]) {
  if (line.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(line[0].x, line[0].y);
  for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
  ctx.stroke();
}

function drawFooter() {
  // 힌트 + 완료 버튼
  const y0 = LOGICAL_H - FOOT_H + 18;
  let hint = "";
  if (screen === "predict") hint = textData.predictHint;
  else if (screen === "manipulate") hint = textData.manipulateHint;
  else if (screen === "fire") hint = textData.fireHint;

  if (hint && !devMode) {
    ctx.save();
    ctx.fillStyle = "rgba(15,28,51,.5)";
    const tw = ctx.measureText(hint).width;
    ctx.font = 'bold 18px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
    const padX = 22;
    const w = Math.min(LOGICAL_W - 360, ctx.measureText(hint).width + padX * 2);
    const h = 40;
    const x = (LOGICAL_W - 320 - w) / 2;
    roundRect(x, y0 + 10, w, h, 999); ctx.fill();
    drawText(hint, x + w / 2, y0 + 38, {
      font: 'bold 18px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
    });
    ctx.restore();
  }

  // 완료 버튼 (manipulate 단계에서만 활성)
  const bW = 300, bH = 76, bX = LOGICAL_W - bW - 36, bY = y0 + 2;
  const enabled = screen === "manipulate";
  ctx.save();
  ctx.fillStyle = enabled ? "#135f29" : "#3a4055";
  roundRect(bX, bY + 6, bW, bH, 999); ctx.fill();
  if (enabled) {
    const g = ctx.createLinearGradient(bX, bY, bX, bY + bH);
    g.addColorStop(0, "#2fbf55"); g.addColorStop(1, "#1f8f3f");
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = "#5b6378";
  }
  roundRect(bX, bY, bW, bH, 999); ctx.fill();
  drawText(textData.doneBtn, bX + bW / 2, bY + bH / 2 + 13, {
    font: `900 38px ${FF}`, color: enabled ? "#fff" : "rgba(255,255,255,.55)", align: "center",
  });
  ctx.restore();
  addBtn({ x: bX, y: bY, w: bW, h: bH, label: textData.doneBtn, kind: enabled ? "primary" : "ghost",
    enabled, onClick: () => { Sfx.click(); fireLaser(lastFrameMs); } });

  // 개발용 버튼 — 홈 / 다음 / 발사 (시간·예측 없이 테스트)
  if (devMode) {
    const dy = y0 + 14;
    drawEditChipButton("🏠 홈", 28, dy, 92, 48, "#444b63",
      () => { Sfx.click(); screen = "title"; });
    drawEditChipButton("다음 ▶", 128, dy, 104, 48, "#2a5b9c",
      () => { Sfx.click(); nextStage(); });
    if (screen === "predict" || screen === "manipulate")
      drawEditChipButton("🔴 발사", 240, dy, 104, 48, "#b3402f",
        () => { Sfx.click(); fireLaser(lastFrameMs); });
  }
}

function drawBanner(text: string) {
  const el = (lastFrameMs - phaseStartMs) / 1000;
  const a = Math.min(1, Math.max(0, 1 - Math.abs(el - 0.7) / 1.0));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(8,16,32,.45)";
  ctx.fillRect(0, LOGICAL_H / 2 - 90, LOGICAL_W, 180);
  drawText(text, LOGICAL_W / 2, LOGICAL_H / 2 + 24, {
    font: '900 88px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
    shadow: "rgba(0,0,0,.5)", shadowBlur: 24,
  });
  if (stageP) {
    const team = appData.teams[stageP.team];
    drawText(`${stageP.round}${textData.roundLabel} · ${team.name}`, LOGICAL_W / 2, LOGICAL_H / 2 + 70, {
      font: 'bold 28px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
    });
  }
  ctx.restore();
}

// ---------- 결과 카드 ----------

function drawResultCard() {
  if (!beam) return;
  // 어둡게
  ctx.save();
  ctx.fillStyle = "rgba(8,16,32,.62)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.restore();

  const cardW = 660, cardH = 540;
  const cx = LOGICAL_W / 2, cy = LOGICAL_H / 2;
  const x = cx - cardW / 2, y = cy - cardH / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 24;
  ctx.fillStyle = COLOR.panel;
  roundRect(x, y, cardW, cardH, 26); ctx.fill();
  ctx.restore();

  const res = beam.result;
  const r = beam.reason;
  let icon = "🎯", title = textData.failTitle, desc = textData.failMiss;
  if (res === "perfect") { icon = "🎯"; title = textData.perfectTitle; desc = textData.perfectDesc; }
  else if (res === "partial") { icon = "✨"; title = textData.partialTitle; desc = textData.partialDesc; }
  else {
    icon = "💥"; title = textData.failTitle;
    desc = r === "out" ? textData.failOut
         : r === "block" ? textData.failBlock
         : r === "forbidden" ? textData.failForbidden
         : textData.failMiss;
  }
  drawText(icon, cx, y + 122, {
    font: '108px "Apple Color Emoji","Segoe UI Emoji",sans-serif', color: "#000", align: "center",
  });
  drawText(title, cx, y + 212, {
    font: `900 58px ${FF}`, color: COLOR.ink, align: "center",
  });
  drawText(desc, cx, y + 262, {
    font: `bold 25px ${FF}`, color: COLOR.inkSub, align: "center",
  });

  const ptsColor = resultPoints > 0 ? COLOR.team0 : "#98a2b8";
  drawText("+" + resultPoints, cx, y + 360, {
    font: `900 90px ${FF}`, color: ptsColor, align: "center",
  });

  // 콤보 보너스 상세 (성공 + 보너스가 있을 때만)
  const showBonus = (beam.result !== "fail") && comboBonus > 0;
  if (showBonus) {
    const base = resultPoints - comboBonus;
    const detail = `기본 ${base}  +  콤보 보너스 ${comboBonus}  (최대 x${comboMax})`;
    drawText(detail, cx, y + 410, {
      font: `bold 22px ${FF}`, color: COLOR.inkSub, align: "center",
    });
  } else if (comboMax >= 2) {
    drawText(`최대 콤보 x${comboMax}`, cx, y + 410, {
      font: `bold 22px ${FF}`, color: COLOR.inkSub, align: "center",
    });
  }

  // 다음 버튼
  const bW = 320, bH = 78, bX = cx - bW / 2, bY = y + cardH - bH - 30;
  const isLast = (stageIndex + 1) >= appData.totalRounds * appData.stagesPerRound;
  const label = isLast ? textData.finalNextBtn : textData.nextBtn;
  ctx.save();
  ctx.fillStyle = "#16336e";
  roundRect(bX, bY + 5, bW, bH, 999); ctx.fill();
  const g = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  g.addColorStop(0, "#2f64c8"); g.addColorStop(1, "#214a99");
  ctx.fillStyle = g;
  roundRect(bX, bY, bW, bH, 999); ctx.fill();
  drawText(label, bX + bW / 2, bY + bH / 2 + 13, {
    font: `900 36px ${FF}`, color: "#fff", align: "center",
  });
  ctx.restore();
  addBtn({ x: bX, y: bY, w: bW, h: bH, label, kind: "primary",
    onClick: () => { Sfx.click(); nextStage(); } });
}

// ---------- 최종 결과 ----------

function drawFinalScreen() {
  drawBackground();
  drawText(textData.gameOver, LOGICAL_W / 2, 158, {
    font: `900 84px ${FF}`, color: "#fff", align: "center",
    shadow: "rgba(0,0,0,.45)", shadowBlur: 16,
  });

  const [a, b] = teamScores;
  let winText = textData.draw;
  if (a > b) winText = appData.teams[0].name + textData.winSuffix;
  else if (b > a) winText = appData.teams[1].name + textData.winSuffix;
  drawText(winText, LOGICAL_W / 2, 238, {
    font: `900 60px ${FF}`, color: COLOR.yellow, align: "center",
    shadow: "rgba(0,0,0,.4)", shadowBlur: 12,
  });

  // 팀 박스
  const bW = 240, bH = 220, gap = 60, totalW = bW * 2 + gap + 80;
  const startX = (LOGICAL_W - totalW) / 2;
  drawFinalTeamBox(startX, 320, bW, bH, 0, a >= b);
  drawText("VS", startX + bW + gap / 2 + 28, 320 + bH / 2 + 18, {
    font: `900 64px ${FF}`, color: "rgba(255,255,255,.85)", align: "center",
  });
  drawFinalTeamBox(startX + bW + gap + 56, 320, bW, bH, 1, b >= a);

  // 다시하기
  const sW = 280, sH = 70, sX = (LOGICAL_W - sW) / 2;
  drawStartButton(sX, 600, sW, sH, textData.restartBtn);

  if (!confettiPlayed) {
    confettiPlayed = true;
    try {
      confetti.default({ particleCount: 180, spread: 110, origin: { y: 0.5 } });
    } catch (e) { /* ignore */ }
  }
}
function drawFinalTeamBox(x: number, y: number, w: number, h: number, teamId: number, win: boolean) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.28)";
  roundRect(x, y + 10, w, h, 22); ctx.fill();
  ctx.fillStyle = appData.teams[teamId].color;
  roundRect(x, y, w, h, 22); ctx.fill();
  if (win) {
    ctx.strokeStyle = COLOR.yellow; ctx.lineWidth = 6;
    roundRect(x - 4, y - 4, w + 8, h + 8, 26); ctx.stroke();
  }
  drawText(appData.teams[teamId].name, x + w / 2, y + 60, {
    font: `900 40px ${FF}`, color: "#fff", align: "center",
  });
  drawText(String(teamScores[teamId]), x + w / 2, y + 150, {
    font: '900 72px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif', color: "#fff", align: "center",
  });
  ctx.restore();
}

// ===========================================================
// 게임 흐름
// ===========================================================

function setScreen(s: Screen, now: number) {
  screen = s;
  phaseStartMs = now;
  lastTickSec = -1;
  selectedMirror = null;
  if (s === "intro") { Sfx.stageStart(); }
}

function startGame() {
  teamScores = [0, 0];
  stageIndex = 0;
  confettiPlayed = false;
  loadStage(0, performance.now());
}

function loadStage(idx: number, now: number) {
  stageIndex = idx;
  stageP = stageParams(diff, idx);
  stage = generateStage(stageP);
  // 정답 배치에서 거울별 빔 도달 방향 계산 (면 표시 고정용). 잠시 정답으로 돌려 추적 후 복원.
  {
    const saved = stage.mirrors.map(m => m.ori);
    stage.mirrors.forEach(m => m.ori = m.sol);
    solInDir = traceLaser(stage, new Set<string>()).inDir;
    stage.mirrors.forEach((m, i) => m.ori = saved[i]);
  }
  computeBoardLayout();
  mirrorAnim.clear();
  beam = null; beamProgress = 0; resultShown = false; resultPoints = 0;
  beamCutIndex = -1; beamMoverCheckedIdx = 0; beamCellArrival = []; beamCells = [];
  targetHitMix = 0; targetHitLastNow = 0;   // 새 스테이지는 평소(앞면) 상태에서 시작
  bounceScheduled.forEach(t => clearTimeout(t)); bounceScheduled = [];
  comboScheduled.forEach(t => clearTimeout(t)); comboScheduled = [];
  comboCount = 0; comboMax = 0; comboBonus = 0;
  comboPopups = []; comboParticles = []; comboRings = [];
  setScreen("intro", now);
}

// 격자 보정 모드 전용: 화면 전환 없이 현재 스테이지를 새 열/행 수로 다시 생성한다.
function regenStageForCalib() {
  if (!stage) return;
  stageP = stageParams(diff, stageIndex);
  stage = generateStage(stageP);
  mirrorAnim.clear();
  beam = null; beamProgress = 0; resultShown = false;
  beamCutIndex = -1; beamMoverCheckedIdx = 0; beamCellArrival = []; beamCells = [];
  bounceScheduled.forEach(t => clearTimeout(t)); bounceScheduled = [];
  comboScheduled.forEach(t => clearTimeout(t)); comboScheduled = [];
  comboCount = 0; comboMax = 0; comboBonus = 0;
  comboPopups = []; comboParticles = []; comboRings = [];
}

function nextStage() {
  const next = stageIndex + 1;
  if (next >= appData.totalRounds * appData.stagesPerRound) {
    screen = "final";
    return;
  }
  loadStage(next, performance.now());
}

function fireLaser(now: number) {
  if (!stage) return;
  setScreen("fire", now);
  const key = (c: number, r: number) => c + "," + r;
  // 빔은 이동 장애물(양)을 무시하고 거울/벽 기준 경로를 계산한다. 양과의 충돌은 발사 중
  // 펄스가 칸에 도달하는 '순간' 동적으로 판정(update). 양은 발사 중에도 계속 움직인다.
  beam = traceLaser(stage, new Set<string>());
  beamProgress = 0;
  beamStartMs = now;
  // 코너만 있는 beam.points를 '모든 칸'으로 전개 (양 충돌 판정·정확한 빔 그리기용)
  beamCells = [];
  {
    const pts = beam.points;
    if (pts.length) beamCells.push(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1], to = pts[i];
      const sc = Math.sign(to.c - from.c), sr = Math.sign(to.r - from.r);
      let cc = from.c, rr = from.r, guard = 0;
      while ((cc !== to.c || rr !== to.r) && guard++ < 300) { cc += sc; rr += sr; beamCells.push({ c: cc, r: rr }); }
    }
  }
  const n = Math.max(1, beamCells.length - 1);
  beamCellArrival = beamCells.map((_, i) => i / n);
  beamDuration = Math.min(2400, Math.max(520, beamCells.length * 62));
  beamMoverCheckedIdx = 0;
  beamCutIndex = -1;
  Sfx.fire();

  // 콤보 상태 초기화
  comboCount = 0; comboMax = 0; comboBonus = 0;
  comboPopups = []; comboParticles = []; comboRings = [];
  comboScheduled.forEach(t => clearTimeout(t)); comboScheduled = [];

  // 거울 위치 빠른 조회용 — 실제 반사가 일어난 거울만 콤보로 인정
  const mirrorByCell = new Map<string, Mirror>();
  stage.mirrors.forEach(m => mirrorByCell.set(key(m.c, m.r), m));
  const reflectedSet = beam.hitMirrors;

  if (beam.points.length >= 3) {
    const pts = beam.points;
    const len: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].c - pts[i - 1].c, pts[i].r - pts[i - 1].r);
      len.push(d); total += d;
    }
    let acc = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      acc += len[i - 1];
      const t = (acc / total) * beamDuration;
      const p = pts[i];
      const m = mirrorByCell.get(key(p.c, p.r));
      const isReflect = !!m && reflectedSet.has(m.id);

      comboScheduled.push(window.setTimeout(() => {
        if (isReflect) triggerCombo(p, performance.now());
        else Sfx.bounce();
      }, t));
    }
  }
}

function triggerCombo(cell: Cell, now: number) {
  comboCount++;
  if (comboCount > comboMax) comboMax = comboCount;
  comboBonus += comboBonusFor(comboCount);

  const { x, y } = cellCenter(cell.c, cell.r);
  const col = comboColor(comboCount);

  // 텍스트 팝업 — 2콤보부터 표시 (1회차는 링·파티클만)
  if (comboCount >= 2) {
    comboPopups.push({ x, y, count: comboCount, bornMs: now, life: 900 });
  }

  // 링 (반사 임팩트)
  comboRings.push({ x, y, bornMs: now, life: 520, color: col, maxR: boardCell * 0.7 });

  // 파티클 폭발
  const n = 10 + Math.min(comboCount * 2, 14);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const sp = 80 + Math.random() * 140 + comboCount * 12;
    comboParticles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      bornMs: now,
      life: 520 + Math.random() * 280,
      color: col,
      size: 2 + Math.random() * 2.5,
    });
  }

  // 사운드 — 콤보가 올라갈수록 피치 상승 (현재 비활성)
  Sfx.bounce(1 + (comboCount - 1) * 0.12);
}

function showResult() {
  if (!beam || !stageP) return;
  resultShown = true;
  screen = "result";

  let pts = appData.scoring.fail;
  if (beam.result === "perfect") { pts = appData.scoring.perfect; Sfx.perfect(); }
  else if (beam.result === "partial") { pts = appData.scoring.partial; Sfx.partial(); }
  else Sfx.fail();

  // 콤보 보너스는 성공(perfect/partial) 시에만 가산
  const bonus = (beam.result === "fail") ? 0 : comboBonus;
  resultPoints = pts + bonus;
  teamScores[stageP.team] += resultPoints;
}

// 프레임마다 호출
function update(now: number) {
  lastFrameMs = now;
  const dt = (now - (update as any)._last || 0) / 1000;
  (update as any)._last = now;

  if ((screen === "manipulate" || screen === "fire" || screen === "result") && stage) {
    // 이동 장애물(양)은 조작·발사·결과 내내 계속 움직인다.
    stage.movers.forEach(mv => {
      const speed = 1.2; // 칸/초
      mv.t += mv.dir * speed * dt;
      if (mv.t >= mv.track.length - 1) { mv.t = mv.track.length - 1; mv.dir = -1; }
      else if (mv.t <= 0) { mv.t = 0; mv.dir = 1; }
    });
  }

  if (screen === "intro" && stage) {
    // devMode: 예측 단계 건너뛰고 바로 조작(자유 발사)으로
    if (now - phaseStartMs > 1900) setScreen(devMode ? "manipulate" : "predict", now);
  } else if (screen === "predict" && stage) {
    const rem = Math.ceil(stage.predict - (now - phaseStartMs) / 1000);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) { lastTickSec = rem; Sfx.tick(); }
    if ((now - phaseStartMs) / 1000 >= stage.predict) setScreen("manipulate", now);
  } else if (screen === "manipulate" && stage) {
    const elapsed = (now - phaseStartMs) / 1000;
    const rem = Math.ceil(stage.time - elapsed);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) { lastTickSec = rem; Sfx.tick(); }
    // devMode: 시간초과 자동발사 없음 (시간 제한 제거)
    if (!devMode && rem <= 0) fireLaser(now);
  } else if (screen === "fire") {
    beamProgress = Math.min(1, (now - beamStartMs) / beamDuration);
    // 양 충돌: 펄스가 도달(켜진) 빔 칸 중 양이 올라와 있는 칸이 있으면 충돌 → 그 칸에서 잘리고 실패.
    // 매 프레임 켜진 칸 전체를 검사하므로, 양이 나중에 빔 위로 들어와도 잡힌다.
    if (beam && beamCutIndex < 0 && stage && stage.movers.length) {
      const moverNow = new Set<string>();
      stage.movers.forEach(mv => { const c = mv.track[Math.round(mv.t)]; moverNow.add(c.c + "," + c.r); });
      let front = 0;
      while (front + 1 < beamCells.length && beamCellArrival[front + 1] <= beamProgress) front++;
      for (let i = 1; i <= front; i++) {
        const p = beamCells[i];
        if (moverNow.has(p.c + "," + p.r)) {
          beamCutIndex = i;
          beam.result = "fail";       // 양에 부딪힘 → 실패
          beam.reason = "block";
          comboScheduled.forEach(t => clearTimeout(t)); comboScheduled = [];
          bounceScheduled.forEach(t => clearTimeout(t)); bounceScheduled = [];
          Sfx.fail();
          break;
        }
      }
    }
    if (!resultShown && now - beamStartMs >= beamDuration + 600) showResult();
  }

  // 콤보 파티클 운동 (fire/result 단계에서 자연스럽게 페이드)
  if (comboParticles.length > 0) {
    for (const p of comboParticles) {
      // dt(초)에 비례한 단순 이동 + 약한 감속
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    comboParticles = comboParticles.filter(p => now - p.bornMs < p.life);
  }
  if (comboPopups.length > 0) {
    comboPopups = comboPopups.filter(p => now - p.bornMs < p.life);
  }
  if (comboRings.length > 0) {
    comboRings = comboRings.filter(r => now - r.bornMs < r.life);
  }
}

function render(now: number) {
  // 버튼 리스트는 매 프레임 다시 빌드 (캔버스 그릴 때 등록)
  buttons = [];

  if (screen === "title") drawTitleScreen(now);
  else if (screen === "final") drawFinalScreen();
  else drawGameScreen(now);
}

// ===========================================================
// 입력 처리
// ===========================================================

function onPointerDown(e: PointerEvent) {
  const pos = AppHelper.getRelativeCoordinates(e.clientX, e.clientY, canvas);

  // 에디터 모드 — 화면 chip 버튼(저장/리셋/종료) 먼저, 그 다음 핸들/레이어
  if (editMode && screen === "title") {
    // 0) 화면 컨트롤 버튼
    const ctrl = hitButton(pos.x, pos.y);
    if (ctrl) { pressedBtn = ctrl; ctrl.onClick(); return; }

    // 1) 이미 선택된 레이어의 회전 핸들 → 리사이즈 핸들 순으로 검사
    if (editSelected !== null) {
      const sel = titleLayout[editSelected];
      if (hitRotationHandle(sel, pos.x, pos.y)) {
        const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
        editRotating = true;
        editRotateStart = { rot: sel.rot || 0, mouseAngle: Math.atan2(pos.y - cy, pos.x - cx) };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        return;
      }
      const k = hitHandle(sel, pos.x, pos.y);
      if (k) {
        editResizing = k;
        editResizeStart = { x: sel.x, y: sel.y, w: sel.w, h: sel.h, rot: sel.rot || 0,
                            mx: pos.x, my: pos.y, shift: e.shiftKey };
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        return;
      }
    }
    // 2) 레이어 선택/이동 (회전 반영 hit-test)
    const hits = titleLayout
      .map((it, i) => ({ i, area: it.w * it.h, hit: pointInItem(pos.x, pos.y, it) && !it.cover }))
      .filter(a => a.hit)
      .sort((a, b) => a.area - b.area);
    const hit = hits.length > 0 ? hits[0].i : null;
    editSelected = hit;
    if (hit !== null) {
      editDragging = true;
      editDragOffX = pos.x - titleLayout[hit].x;
      editDragOffY = pos.y - titleLayout[hit].y;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    return;
  }

  // 1) 버튼 우선
  const b = hitButton(pos.x, pos.y);
  if (b) { pressedBtn = b; b.onClick(); return; }
  // 1.5) 타이틀 화면의 회전형 데코 (clickRotates) 클릭
  if (screen === "title" && !modal) {
    for (const it of titleLayout) {
      if (!it.clickRotates) continue;
      if (pointInItem(pos.x, pos.y, it)) {
        it.rot = (it.rot || 0) + it.clickRotates * Math.PI / 180;
        Sfx.rotate();
        return;
      }
    }
  }
  // 2) 보드 위 거울 회전 (조작 단계에서만)
  if (screen === "manipulate" && stage) {
    const cell = pointToCell(pos.x, pos.y);
    if (!cell) return;
    const m = stage.mirrors.find(mm => mm.c === cell.c && mm.r === cell.r);
    if (m) {
      const cycle = orientationCycle(stage.rotateStep);
      const idx = cycle.indexOf(m.ori);
      m.ori = cycle[(idx + 1) % cycle.length];
      selectedMirror = m.id;
      // 조작 중 앞/뒷면은 drawMirror가 거울 방향만으로 즉시 결정 (별도 추적 불필요).
      Sfx.rotate();
    } else {
      selectedMirror = null;
    }
  }
}

function onPointerUp(e?: PointerEvent) {
  editDragging = false;
  editResizing = null;
  editResizeStart = null;
  editRotating = false;
  editRotateStart = null;
  if (e) { try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
}

function pointInBtn(px: number, py: number, b: { x: number; y: number; w: number; h: number }): boolean {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

// 회전을 고려한 점-내포 검사
function pointInItem(px: number, py: number, it: TitleLayoutItem): boolean {
  const rot = it.rot || 0;
  if (rot === 0) return pointInBtn(px, py, it);
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = px - cx, dy = py - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.h / 2;
}

// 회전 적용된 로컬 좌표 → 캔버스 좌표
function localToCanvas(it: TitleLayoutItem, lx: number, ly: number): { x: number; y: number } {
  const rot = it.rot || 0;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

// 핸들 위치 (선택 레이어 외곽 8개) — 회전 반영
function handlePositions(it: TitleLayoutItem): [HandleKind, number, number][] {
  const halfW = it.w / 2, halfH = it.h / 2;
  const locals: [HandleKind, number, number][] = [
    ["nw", -halfW, -halfH],
    ["n",  0,     -halfH],
    ["ne",  halfW, -halfH],
    ["e",   halfW,  0    ],
    ["se",  halfW,  halfH],
    ["s",   0,      halfH],
    ["sw", -halfW,  halfH],
    ["w",  -halfW,  0    ],
  ];
  return locals.map(([k, lx, ly]) => {
    const p = localToCanvas(it, lx, ly);
    return [k, p.x, p.y] as [HandleKind, number, number];
  });
}

// 회전 핸들 캔버스 위치 — 상단 위로 36px 떠 있는 점
function rotationHandlePos(it: TitleLayoutItem): { x: number; y: number } {
  return localToCanvas(it, 0, -it.h / 2 - 36);
}

function hitHandle(it: TitleLayoutItem, px: number, py: number): HandleKind | null {
  const r = 16;
  for (const [kind, hx, hy] of handlePositions(it)) {
    if (Math.abs(px - hx) <= r && Math.abs(py - hy) <= r) return kind;
  }
  return null;
}

function hitRotationHandle(it: TitleLayoutItem, px: number, py: number): boolean {
  const p = rotationHandlePos(it);
  return Math.hypot(px - p.x, py - p.y) <= 16;
}

function cursorForHandle(k: HandleKind | null): string {
  switch (k) {
    case "nw": case "se": return "nwse-resize";
    case "ne": case "sw": return "nesw-resize";
    case "n":  case "s":  return "ns-resize";
    case "e":  case "w":  return "ew-resize";
    default: return "";
  }
}

function onPointerMove(e: PointerEvent) {
  const pos = AppHelper.getRelativeCoordinates(e.clientX, e.clientY, canvas);

  // 에디터 모드
  if (editMode && screen === "title") {
    // 회전 중
    if (editRotating && editSelected !== null && editRotateStart) {
      const it = titleLayout[editSelected];
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const angle = Math.atan2(pos.y - cy, pos.x - cx);
      let newRot = editRotateStart.rot + (angle - editRotateStart.mouseAngle);
      if (e.shiftKey) {
        // 15°(π/12) 스냅
        const step = Math.PI / 12;
        newRot = Math.round(newRot / step) * step;
      }
      it.rot = newRot;
      canvas.style.cursor = "grabbing";
      return;
    }
    // 리사이즈 중 — 회전 반영
    if (editResizing && editSelected !== null && editResizeStart) {
      const it = titleLayout[editSelected];
      const st = editResizeStart;
      const minSz = 8;
      const k = editResizing;
      const isCorner = k.length === 2;
      const lockAspect = isCorner && !e.shiftKey;
      const rot = st.rot;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const oldCx = st.x + st.w / 2, oldCy = st.y + st.h / 2;

      // 1) 핸들/앵커의 로컬 위치 결정 (시작 시점 기준)
      const halfW = st.w / 2, halfH = st.h / 2;
      const localK = { x: 0, y: 0 };
      if (k.includes("e")) localK.x =  halfW;
      if (k.includes("w")) localK.x = -halfW;
      if (k.includes("s")) localK.y =  halfH;
      if (k.includes("n")) localK.y = -halfH;
      const anchorLocal = { x: -localK.x, y: -localK.y };
      // 앵커의 캔버스 좌표 (변하지 않음)
      const anchorCanvas = {
        x: oldCx + anchorLocal.x * cos - anchorLocal.y * sin,
        y: oldCy + anchorLocal.x * sin + anchorLocal.y * cos,
      };

      // 2) 마우스 위치를 앵커 기준 로컬로 변환 → 새 핸들 로컬 위치
      const cmx = pos.x - anchorCanvas.x;
      const cmy = pos.y - anchorCanvas.y;
      const newKx_full = cmx * cos + cmy * sin;
      const newKy_full = -cmx * sin + cmy * cos;
      // newK_local_from_anchor = newKLocal - anchorLocal = newKLocal + localK (since anchor = -localK)
      const newKLocalX = newKx_full + anchorLocal.x;  // 새 K 로컬 x (앵커 기준에서 더함)
      const newKLocalY = newKy_full + anchorLocal.y;  // 새 K 로컬 y

      // 3) 어느 축이 바뀌는지에 따라 w/h 결정
      let newW = st.w, newH = st.h;
      if (k.includes("e")) newW = Math.max(minSz, Math.round( 2 * newKLocalX));
      if (k.includes("w")) newW = Math.max(minSz, Math.round(-2 * newKLocalX));
      if (k.includes("s")) newH = Math.max(minSz, Math.round( 2 * newKLocalY));
      if (k.includes("n")) newH = Math.max(minSz, Math.round(-2 * newKLocalY));

      // 4) aspect lock — 코너에서만
      if (lockAspect) {
        const ratio = st.w / Math.max(1, st.h);
        const scale = Math.max(newW / st.w, newH / st.h);
        newW = Math.max(minSz, Math.round(st.w * scale));
        newH = Math.max(minSz, Math.round(newW / ratio));
      }

      // 5) 새 중심: anchorCanvas + R(rot) * (newK_local)
      //   (앵커 로컬은 (-newW/2 또는 0, -newH/2 또는 0), K 로컬은 부호 반대)
      const kSignX = k.includes("e") ? 1 : (k.includes("w") ? -1 : 0);
      const kSignY = k.includes("s") ? 1 : (k.includes("n") ? -1 : 0);
      const newKLocalFinal = { x: kSignX * newW / 2, y: kSignY * newH / 2 };
      const anchorLocalFinal = { x: -newKLocalFinal.x, y: -newKLocalFinal.y };
      const newCx = anchorCanvas.x - (anchorLocalFinal.x * cos - anchorLocalFinal.y * sin);
      const newCy = anchorCanvas.y - (anchorLocalFinal.x * sin + anchorLocalFinal.y * cos);
      it.w = newW; it.h = newH;
      it.x = Math.round(newCx - newW / 2);
      it.y = Math.round(newCy - newH / 2);
      canvas.style.cursor = cursorForHandle(k);
      return;
    }
    // 이동 중
    if (editDragging && editSelected !== null) {
      const it = titleLayout[editSelected];
      it.x = Math.round(pos.x - editDragOffX);
      it.y = Math.round(pos.y - editDragOffY);
      canvas.style.cursor = "grabbing";
      return;
    }
    // 호버: 선택된 레이어 위에선 핸들/이동 커서 미리 보여주기
    if (editSelected !== null) {
      const sel = titleLayout[editSelected];
      if (hitRotationHandle(sel, pos.x, pos.y)) { canvas.style.cursor = "crosshair"; return; }
      const k = hitHandle(sel, pos.x, pos.y);
      if (k) { canvas.style.cursor = cursorForHandle(k); return; }
      if (pointInItem(pos.x, pos.y, sel)) { canvas.style.cursor = "move"; return; }
    }
    canvas.style.cursor = "default";
    return;
  }

  // 타이틀에서만 hover 추적 (다른 화면은 불필요)
  if (screen !== "title" || modal !== null) {
    if (titleHover !== null) titleHover = null;
    if (rotatableHoverId !== null) rotatableHoverId = null;
    canvas.style.cursor = "";
    return;
  }
  // 레이아웃의 인터랙티브 항목으로 hover 결정 (회전 반영)
  let next: TitleBtnKey | null = null;
  let nextRot: string | null = null;
  for (const it of titleLayout) {
    if (it.interactive && pointInItem(pos.x, pos.y, it)) { next = it.interactive; break; }
  }
  if (!next) {
    for (const it of titleLayout) {
      if (it.clickRotates && pointInItem(pos.x, pos.y, it)) { nextRot = it.id; break; }
    }
  }
  if (next !== titleHover) titleHover = next;
  if (nextRot !== rotatableHoverId) rotatableHoverId = nextRot;
  canvas.style.cursor = (next || nextRot) ? "pointer" : "";
}

function onPointerLeave() {
  if (titleHover !== null) titleHover = null;
  canvas.style.cursor = "";
}

function onWheel(e: WheelEvent) {
  if (!editMode || screen !== "title" || editSelected === null) return;
  e.preventDefault();
  const it = titleLayout[editSelected];
  // 트랙패드는 deltaY가 매 프레임 작은 값이라 |dy|에 비례한 부드러운 스케일
  const ay = Math.min(50, Math.abs(e.deltaY));
  const step = 0.003 * ay;          // 약 0.001 ~ 0.15
  const factor = e.deltaY > 0 ? (1 - step) : (1 + step);
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  it.w = Math.max(8, Math.round(it.w * factor));
  it.h = Math.max(8, Math.round(it.h * factor));
  it.x = Math.round(cx - it.w / 2);
  it.y = Math.round(cy - it.h / 2);
}

// z-order 조작 — titleLayout 배열의 index 변경
// (index 0 = 가장 뒤, index 마지막 = 가장 앞)
function zSendToBack() {
  if (editSelected === null) return;
  const it = titleLayout.splice(editSelected, 1)[0];
  titleLayout.unshift(it);
  editSelected = 0;
  showEditToast("맨 뒤로 보냄");
}
function zSendBackward() {
  if (editSelected === null || editSelected === 0) return;
  const t = titleLayout[editSelected - 1];
  titleLayout[editSelected - 1] = titleLayout[editSelected];
  titleLayout[editSelected] = t;
  editSelected -= 1;
  showEditToast("한 칸 뒤로");
}
function zBringForward() {
  if (editSelected === null || editSelected >= titleLayout.length - 1) return;
  const t = titleLayout[editSelected + 1];
  titleLayout[editSelected + 1] = titleLayout[editSelected];
  titleLayout[editSelected] = t;
  editSelected += 1;
  showEditToast("한 칸 앞으로");
}
function zBringToFront() {
  if (editSelected === null) return;
  const it = titleLayout.splice(editSelected, 1)[0];
  titleLayout.push(it);
  editSelected = titleLayout.length - 1;
  showEditToast("맨 앞으로 보냄");
}

function toggleEditMode() {
  if (screen !== "title") return;
  editMode = !editMode;
  editSelected = null;
  editDragging = false;
  editResizing = null;
  canvas.style.cursor = "";
  if (editMode) { try { canvas.focus(); window.focus(); } catch (_) {} }
  showEditToast(editMode ? "에디터 ON" : "에디터 OFF");
}

function onKeyDown(e: KeyboardEvent) {
  // e.code 사용 — IME(한영) 무관하게 항상 작동
  const code = e.code;

  if (code === "KeyE") { toggleEditMode(); e.preventDefault(); return; }

  // 게임 플레이 중 격자 보정 모드 (G 토글). 화살표=이동(Shift×5), [ ]=칸크기, S=저장, R=리셋
  if (screen !== "title") {
    if (code === "KeyG") { gridCalibMode = !gridCalibMode; if (stage) computeBoardLayout(); e.preventDefault(); return; }
    if (gridCalibMode && stage) {
      const cal = getCalib();
      const step = e.shiftKey ? 5 : 1;
      let handled = true;
      let regen = false;
      if (code === "ArrowLeft") cal.dx -= step;
      else if (code === "ArrowRight") cal.dx += step;
      else if (code === "ArrowUp") cal.dy -= step;
      else if (code === "ArrowDown") cal.dy += step;
      else if (code === "BracketLeft") cal.dc -= 1;
      else if (code === "BracketRight") cal.dc += 1;
      else if (code === "Comma")  { cal.dcols = (cal.dcols || 0) - 1; regen = true; }   // 열 −
      else if (code === "Period") { cal.dcols = (cal.dcols || 0) + 1; regen = true; }   // 열 +
      else if (code === "Semicolon") { cal.drows = (cal.drows || 0) - 1; regen = true; } // 행 −
      else if (code === "Quote")     { cal.drows = (cal.drows || 0) + 1; regen = true; } // 행 +
      // 네 모서리 자유 늘리기 (양수=바깥으로 확장). 좌:A/D 우:J/L 상:W/X 하:I/K
      else if (code === "KeyA") cal.dl = (cal.dl || 0) + step;   // 왼쪽 모서리 ←(늘림)
      else if (code === "KeyD") cal.dl = (cal.dl || 0) - step;   // 왼쪽 모서리 →(줄임)
      else if (code === "KeyL") cal.dr = (cal.dr || 0) + step;   // 오른쪽 모서리 →(늘림)
      else if (code === "KeyJ") cal.dr = (cal.dr || 0) - step;   // 오른쪽 모서리 ←(줄임)
      else if (code === "KeyW") cal.dt = (cal.dt || 0) + step;   // 위쪽 모서리 ↑(늘림)
      else if (code === "KeyX") cal.dt = (cal.dt || 0) - step;   // 위쪽 모서리 ↓(줄임)
      else if (code === "KeyK") cal.db = (cal.db || 0) + step;   // 아래쪽 모서리 ↓(늘림)
      else if (code === "KeyI") cal.db = (cal.db || 0) - step;   // 아래쪽 모서리 ↑(줄임)
      else if (code === "KeyS") { saveGridCalib(); if (e.shiftKey) downloadGridCalibJSON(); }  // Shift+S = 파일로 내보내기
      else if (code === "KeyR") { cal.dx = 0; cal.dy = 0; cal.dc = 0; cal.dcols = 0; cal.drows = 0; cal.dl = 0; cal.dr = 0; cal.dt = 0; cal.db = 0; regen = true; }
      else handled = false;
      if (handled) {
        if (regen) regenStageForCalib();
        computeBoardLayout();
        e.preventDefault();
        return;
      }
    }
  }

  if (!editMode || screen !== "title") return;

  if (code === "Escape") {
    if (editSelected !== null) editSelected = null;
    else editMode = false;
    showEditToast(editSelected === null && !editMode ? "에디터 OFF" : "선택 해제");
    e.preventDefault();
    return;
  }
  if (code === "KeyS") { e.preventDefault(); downloadLayoutJSON(); return; }
  if (code === "KeyR") {
    titleLayout = DEFAULT_TITLE_LAYOUT.map(x => ({ ...x }));
    editSelected = null;
    showEditToast("기본 레이아웃으로 리셋");
    e.preventDefault();
    return;
  }
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  const step = e.shiftKey ? 10 : 1;
  if (code === "ArrowLeft")  { it.x -= step; e.preventDefault(); }
  if (code === "ArrowRight") { it.x += step; e.preventDefault(); }
  if (code === "ArrowUp")    { it.y -= step; e.preventDefault(); }
  if (code === "ArrowDown")  { it.y += step; e.preventDefault(); }
  if (code === "BracketLeft" || code === "BracketRight") {
    const f = code === "BracketLeft" ? 0.95 : 1.05;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    it.w = Math.max(8, Math.round(it.w * f));
    it.h = Math.max(8, Math.round(it.h * f));
    it.x = Math.round(cx - it.w / 2);
    it.y = Math.round(cy - it.h / 2);
    e.preventDefault();
  }
  if (code === "KeyQ") { zSendBackward(); e.preventDefault(); }
  if (code === "KeyA") { zBringForward(); e.preventDefault(); }
  if (code === "KeyZ") { zSendToBack();  e.preventDefault(); }
  if (code === "KeyX") { zBringToFront();e.preventDefault(); }
  // 회전 O/P = ±5°, Shift = ±15°. T = 회전 0으로 리셋
  if (code === "KeyO" || code === "KeyP") {
    const dir = code === "KeyO" ? -1 : 1;
    const step = (e.shiftKey ? 15 : 5) * Math.PI / 180;
    it.rot = (it.rot || 0) + dir * step;
    e.preventDefault();
  }
  if (code === "KeyT") { it.rot = 0; showEditToast("회전 0°로 리셋"); e.preventDefault(); }
  if (code === "KeyD") {
    const copy: TitleLayoutItem = { ...it, id: it.id + "_copy_" + Date.now().toString().slice(-4),
                                     x: it.x + 20, y: it.y + 20 };
    titleLayout.splice(editSelected + 1, 0, copy);
    editSelected += 1;
    showEditToast("복제: " + copy.id);
    e.preventDefault();
  }
  if (code === "Delete" || code === "Backspace") {
    const removed = titleLayout.splice(editSelected, 1)[0];
    editSelected = null;
    showEditToast("삭제: " + removed.id);
    e.preventDefault();
  }
}

// ===========================================================
// 메인 루프 / 진입점
// ===========================================================

function gameLoop(now: number) {
  update(now);
  render(now);
  requestAnimationFrame(gameLoop);
}

async function initApp() {
  appData = await AppHelper.loadAppData<IAppData>();
  textData = await AppHelper.loadTextData<ITextData>();
  assetList = await AppHelper.loadAssetList<IAssetList>();

  canvas = document.getElementById("appCanvas") as HTMLCanvasElement;
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  canvas.addEventListener("pointerdown", onPointerDown as any);
  canvas.addEventListener("pointermove", onPointerMove as any);
  canvas.addEventListener("pointerup", onPointerUp as any);
  canvas.addEventListener("pointerleave", onPointerLeave as any);
  canvas.addEventListener("wheel", onWheel as any, { passive: false });
  // 키보드 — capture phase로 등록해 부모/iframe이 가로채기 전에 받음
  window.addEventListener("keydown", onKeyDown as any, true);

  // 한글 폰트 강제 로드 — 캔버스 텍스트 깨짐 방지 (GmarketSans 우선, Pretendard 폴백)
  try {
    if ((document as any).fonts) {
      const f = (document as any).fonts;
      await Promise.all([
        f.load('700 32px "GmarketSans"').catch(() => {}),
        f.load('500 16px "GmarketSans"').catch(() => {}),
        f.load('300 14px "GmarketSans"').catch(() => {}),
        f.load('bold 14px "Pretendard"').catch(() => {}),
        f.load('900 32px "Pretendard"').catch(() => {}),
      ]);
      await f.ready;
    }
  } catch (_) { /* 무시하고 진행 */ }

  // 타이틀 누끼 자산 비동기 로드 (실패해도 게임 진행에는 영향 없음)
  loadTitleAssets();
  await loadTitleLayout();
  loadGridCalib();

  screen = "title";
  requestAnimationFrame(gameLoop);
}

export { initApp };

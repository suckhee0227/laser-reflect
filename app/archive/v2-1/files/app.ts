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
type Ori = "/" | "\\" | "|" | "-";
type Screen = "title" | "intro" | "predict" | "manipulate" | "fire" | "result" | "final";
type FailReason = "out" | "block" | "forbidden" | "loop" | "miss";
type Result = "perfect" | "partial" | "fail";

interface DiffParam {
  label: string; sub: string; rotateStep: number;
  cols: number; rows: number; mirrors: number;
  walls: number; forbidden: number; movers: number;
  time: number; predict: number;
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
  failOut: string; failBlock: string; failForbidden: string; failMiss: string;
  gameOver: string; winSuffix: string; draw: string; turnSuffix: string; roundLabel: string;
}
interface ISoundAsset { id: string; file_path: string; volume?: number; isBackgroundMusic?: boolean; }
interface IAssetList { images: any[]; sounds: ISoundAsset[]; }

interface Cell { c: number; r: number; }
interface Mirror { id: number; c: number; r: number; sol: Ori; ori: Ori; }
interface Mover { track: Cell[]; t: number; dir: number; }

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
}

interface TraceResult {
  result: Result;
  reason: FailReason;
  points: Cell[];
  hitMirrors: Set<number>;
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
const REFLECT: { [o in Ori]: { [d in Dir]: Dir } } = {
  "/":  { R: "U", U: "R", L: "D", D: "L" },
  "\\": { R: "D", D: "R", L: "U", U: "L" },
  "|":  { L: "R", R: "L", U: "U", D: "D" },  // 세로 광선 통과
  "-":  { U: "D", D: "U", L: "L", R: "R" },  // 가로 광선 통과
};
const PERP: { [d in Dir]: Dir[] } = { R: ["U", "D"], L: ["U", "D"], U: ["L", "R"], D: ["L", "R"] };

function mirrorTypeFor(inDir: Dir, outDir: Dir): Ori {
  return REFLECT["/"][inDir] === outDir ? "/" : "\\";
}
function orientationCycle(step: number): Ori[] {
  return step === 45 ? ["/", "|", "\\", "-"] : ["/", "\\"];
}

// ===========================================================
// 전역 상태
// ===========================================================

let appData: IAppData;
let textData: ITextData;
let assetList: IAssetList;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

// 사운드 — 비활성 (사용자 요청으로 전부 제거)

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
let beamStartMs: number = 0;
let beamDuration: number = 1200;
let bounceScheduled: number[] = [];

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
  bounce() {}, tick() {}, stageStart() {},
};

// ===========================================================
// 레이저 추적
// ===========================================================

function traceLaser(s: Stage, moverCells: Set<string>): TraceResult {
  let dir: Dir = s.emitter.dir;
  let c = s.emitter.c, r = s.emitter.r;
  const points: Cell[] = [{ c, r }];
  const hit = new Set<number>();
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
      return { result: "fail", reason: "out", points, hitMirrors: hit };
    }
    const k = key(c, r);
    if (wallSet.has(k) || moverCells.has(k)) {
      points.push({ c, r });
      return { result: "fail", reason: "block", points, hitMirrors: hit };
    }
    if (forbSet.has(k)) {
      points.push({ c, r });
      return { result: "fail", reason: "forbidden", points, hitMirrors: hit };
    }
    if (k === targetK) {
      points.push({ c, r });
      const result: Result = hit.size === s.mirrors.length ? "perfect" : "partial";
      return { result, reason: "miss", points, hitMirrors: hit };
    }
    const m = mirrorMap.get(k);
    if (m) {
      const nd = REFLECT[m.ori][dir];
      points.push({ c, r });
      if (nd !== dir) hit.add(m.id);
      dir = nd;
    }
  }
  return { result: "fail", reason: "loop", points, hitMirrors: hit };
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

  for (let i = 0; i < p.mirrors; i++) {
    const run = randInt(1, 3);
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

  // 마지막 거울 이후 직진 → 목표
  const tail = randInt(1, 3);
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

  const taken = new Set<string>();
  const takeNext = (): Cell | null => {
    while (free.length > 0) {
      const f = free.shift()!;
      const k = key(f.c, f.r);
      if (!taken.has(k)) { taken.add(k); return f; }
    }
    return null;
  };

  const walls: Cell[] = [];
  for (let i = 0; i < p.walls; i++) {
    const f = takeNext(); if (!f) break; walls.push(f);
  }
  const forbidden: Cell[] = [];
  for (let i = 0; i < p.forbidden; i++) {
    const f = takeNext(); if (!f) break; forbidden.push(f);
  }

  // 이동 장애물 트랙 (2~4칸의 직선, 경로/장애물과 겹치지 않음)
  const movers: Mover[] = [];
  for (let i = 0; i < p.movers; i++) {
    const seed = takeNext();
    if (!seed) break;
    // 4 방향 중 임의 한 방향으로 1~3칸 더 확장
    const dirs: Dir[] = shuffle(["R", "L", "U", "D"]);
    let track: Cell[] = [seed];
    for (const d of dirs) {
      const len = randInt(1, 3);
      let cc = seed.c, rr = seed.r, okExt = true;
      const tmp: Cell[] = [];
      for (let k = 0; k < len; k++) {
        cc += DELTA[d][0]; rr += DELTA[d][1];
        const kk = key(cc, rr);
        if (!inBounds(cc, rr) || used.has(kk) || taken.has(kk)) { okExt = false; break; }
        tmp.push({ c: cc, r: rr });
      }
      if (okExt && tmp.length >= 1) {
        tmp.forEach(t => taken.add(key(t.c, t.r)));
        track = track.concat(tmp);
        break;
      }
    }
    if (track.length >= 2) movers.push({ track, t: 0, dir: 1 });
    else taken.delete(key(seed.c, seed.r)); // 사용 못함 → 되돌림
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
  return {
    diff: d,
    round: round + 1,
    stageInRound: (idx % appData.stagesPerRound) + 1,
    team: idx % 2,
    cols: b.cols + round,
    rows: b.rows + (round > 1 ? 1 : 0),
    mirrors: b.mirrors + round,
    walls: b.walls + round,
    forbidden: b.forbidden + (round > 0 ? 1 : 0),
    movers: b.movers + (b.movers > 0 && round > 1 ? 1 : 0),
    time: Math.max(24, b.time - round * 10),
    predict: b.predict,
    rotateStep: b.rotateStep,
  };
}

// ===========================================================
// 보드 레이아웃
// ===========================================================

const HUD_H = 76;
const FOOT_H = 96;

let boardCell: number = 56;
let boardX: number = 0;
let boardY: number = HUD_H;
let boardW: number = 0;
let boardH: number = 0;

function computeBoardLayout() {
  if (!stage) return;
  const maxW = LOGICAL_W - 80;
  const maxH = LOGICAL_H - HUD_H - FOOT_H - 24;
  let cell = Math.floor(Math.min(maxW / stage.cols, maxH / stage.rows));
  cell = Math.max(40, Math.min(110, cell));
  boardCell = cell;
  boardW = cell * stage.cols;
  boardH = cell * stage.rows;
  boardX = Math.floor((LOGICAL_W - boardW) / 2);
  boardY = HUD_H + Math.floor((LOGICAL_H - HUD_H - FOOT_H - boardH) / 2);
}
function cellCenter(c: number, r: number): { x: number; y: number } {
  return { x: boardX + (c + 0.5) * boardCell, y: boardY + (r + 0.5) * boardCell };
}
function pointToCell(px: number, py: number): Cell | null {
  if (px < boardX || py < boardY || px >= boardX + boardW || py >= boardY + boardH) return null;
  return { c: Math.floor((px - boardX) / boardCell), r: Math.floor((py - boardY) / boardCell) };
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
  ctx.font = opts.font || 'bold 24px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
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
  drawBackground();

  // 큰 제목
  const cx = LOGICAL_W / 2;
  drawText(textData.title, cx, 200, {
    font: 'black 110px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
    color: "#fff", align: "center", baseline: "alphabetic",
    shadow: "rgba(0,0,0,.35)", shadowBlur: 20,
  });
  // 그림자 두께
  ctx.save();
  ctx.fillStyle = "#1d3f86";
  ctx.font = 'black 110px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(textData.title, cx + 4, 204);
  ctx.fillStyle = "#fff";
  ctx.fillText(textData.title, cx, 200);
  ctx.restore();

  // 태그라인
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.32)";
  roundRect(cx - 320, 232, 640, 50, 25); ctx.fill();
  drawText(textData.tagline, cx, 266, {
    font: 'bold 22px "Pretendard", sans-serif',
    color: "#fff", align: "center",
  });
  ctx.restore();

  // 데코 (좌우 캐릭터 자리에 거울 아이콘 — 간단한 장식)
  drawDecoMirror(160, 470, now, "#fff");
  drawDecoMirror(LOGICAL_W - 160, 470, now, "#fff", true);

  // 난이도 버튼
  const diffs = ["EASY", "NORMAL", "HARD"];
  const dColors: { [k: string]: string } = { EASY: COLOR.green, NORMAL: COLOR.orange, HARD: COLOR.red };
  const bW = 200, bH = 110, gap = 36, totalW = bW * 3 + gap * 2;
  const startX = (LOGICAL_W - totalW) / 2;
  diffs.forEach((d, i) => {
    const x = startX + i * (bW + gap);
    const y = 360;
    drawDiffButton(x, y, bW, bH, d, dColors[d], diff === d);
  });

  // 게임 시작 버튼
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
    font: 'black 34px "Pretendard", sans-serif', color: "#fff", align: "center",
  });
  // 서브 라벨
  ctx.fillStyle = "rgba(0,0,0,.22)";
  roundRect(x + w / 2 - 38, y + (isSel ? -4 : 0) + 64, 76, 26, 13); ctx.fill();
  drawText(d.sub, x + w / 2, y + (isSel ? -4 : 0) + 83, {
    font: 'bold 16px "Pretendard", sans-serif', color: "#fff", align: "center",
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
    font: 'black 38px "Pretendard", sans-serif', color: "#fff", align: "center",
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
  drawFooter();

  if (screen === "intro") drawBanner(textData.stageStart);
  if (screen === "result") drawResultCard();
}

function drawHud() {
  if (!stageP) return;
  // 배경
  ctx.fillStyle = COLOR.hudBg;
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);

  // 좌측: 라운드
  drawText(`${stageP.round}R`, 28, 50, {
    font: 'black 36px "Pretendard", sans-serif', color: "#fff",
  });
  drawText(`STAGE ${stageP.round}-${stageP.stageInRound}`, 84, 54, {
    font: 'bold 18px "Pretendard", sans-serif', color: "rgba(255,255,255,.75)",
  });

  // 중앙: 턴 / 타이머
  const team = appData.teams[stageP.team];
  const tagW = 200, tagH = 36;
  const tagX = LOGICAL_W / 2 - tagW / 2;
  ctx.fillStyle = team.color;
  roundRect(tagX, 8, tagW, tagH, 18); ctx.fill();
  drawText(team.name + textData.turnSuffix, LOGICAL_W / 2, 33, {
    font: 'black 20px "Pretendard", sans-serif', color: "#fff", align: "center",
  });
  // 타이머
  const t = currentTimerSec();
  if (t >= 0) {
    let color = "#fff";
    if (screen === "manipulate") {
      if (t <= 5) color = "#ff5b4d";
      else if (t <= 10) color = COLOR.yellow;
    }
    const ts = String(t).padStart(2, "0");
    drawText(ts, LOGICAL_W / 2, 70, {
      font: 'black 38px "Pretendard", sans-serif', color, align: "center",
    });
  }

  // 우측: 팀 점수
  const sW = 110, sH = 56, sGap = 12;
  const tot = sW * 2 + sGap;
  const x0 = LOGICAL_W - tot - 28;
  for (let i = 0; i < 2; i++) {
    const sx = x0 + i * (sW + sGap);
    const sy = 10;
    ctx.fillStyle = appData.teams[i].color;
    roundRect(sx, sy, sW, sH, 14); ctx.fill();
    if (stageP.team === i) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    drawText(appData.teams[i].name, sx + sW / 2, sy + 20, {
      font: 'bold 14px "Pretendard", sans-serif', color: "#fff", align: "center",
    });
    drawText(String(teamScores[i]), sx + sW / 2, sy + 48, {
      font: 'black 28px "Pretendard", sans-serif', color: "#fff", align: "center",
    });
  }
}

function currentTimerSec(): number {
  if (!stage || !stageP) return -1;
  const el = (lastFrameMs - phaseStartMs) / 1000;
  if (screen === "predict") return Math.max(0, Math.ceil(stage.predict - el));
  if (screen === "manipulate") return Math.max(0, Math.ceil(stage.time - el));
  return -1;
}

function drawBoard(now: number) {
  if (!stage) return;
  // 보드 외곽
  ctx.save();
  fillVerticalGradient(boardX, boardY, boardW, boardH, COLOR.gridTop, COLOR.gridBot);
  ctx.restore();

  // 격자
  ctx.strokeStyle = COLOR.gridLine; ctx.lineWidth = 1;
  for (let c = 1; c < stage.cols; c++) {
    ctx.beginPath();
    ctx.moveTo(boardX + c * boardCell, boardY);
    ctx.lineTo(boardX + c * boardCell, boardY + boardH);
    ctx.stroke();
  }
  for (let r = 1; r < stage.rows; r++) {
    ctx.beginPath();
    ctx.moveTo(boardX, boardY + r * boardCell);
    ctx.lineTo(boardX + boardW, boardY + r * boardCell);
    ctx.stroke();
  }
  // 외곽 라인
  ctx.lineWidth = 3; ctx.strokeStyle = COLOR.gridEdge;
  roundRect(boardX + 1.5, boardY + 1.5, boardW - 3, boardH - 3, 12);
  ctx.stroke();

  // 셀별 요소
  stage.forbidden.forEach(f => drawForbidden(f, now));
  stage.walls.forEach(w => drawWall(w));
  stage.movers.forEach(mv => drawMover(mv));
  drawTarget(stage.target, now);
  drawEmitter(stage.emitter, now);
  stage.mirrors.forEach(m => drawMirror(m, now));

  if (beam && (screen === "fire" || screen === "result")) drawBeam(now);
}

function drawForbidden(f: Cell, now: number) {
  const x = boardX + f.c * boardCell, y = boardY + f.r * boardCell;
  const pulse = 0.5 + 0.5 * Math.sin(now / 240);
  ctx.save();
  roundRect(x + 3, y + 3, boardCell - 6, boardCell - 6, 8);
  ctx.clip();
  ctx.fillStyle = `rgba(224,71,61,${0.32 + pulse * 0.22})`;
  ctx.fillRect(x, y, boardCell, boardCell);
  ctx.strokeStyle = "rgba(150,20,15,.55)"; ctx.lineWidth = 6;
  for (let i = -boardCell; i < boardCell; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + boardCell);
    ctx.lineTo(x + i + boardCell, y);
    ctx.stroke();
  }
  ctx.restore();
  drawText("✕", x + boardCell / 2, y + boardCell / 2 + boardCell * 0.13, {
    font: `bold ${Math.round(boardCell * 0.42)}px sans-serif`, color: "#fff", align: "center",
  });
}

function drawWall(w: Cell) {
  const x = boardX + w.c * boardCell, y = boardY + w.r * boardCell, p = boardCell * 0.1;
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#8a93a6"); g.addColorStop(1, "#5d6678");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = "#454c5c"; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + p, y + boardCell / 2);
  ctx.lineTo(x + boardCell - p, y + boardCell / 2);
  ctx.stroke();
}

function drawMover(mv: Mover) {
  // 보간 위치
  const tf = mv.t;
  const i0 = Math.floor(tf);
  const i1 = Math.min(mv.track.length - 1, i0 + 1);
  const f = tf - i0;
  const a = mv.track[i0]; const b = mv.track[i1];
  const x = boardX + ((a.c * (1 - f) + b.c * f) + 0.5) * boardCell;
  const y = boardY + ((a.r * (1 - f) + b.r * f) + 0.5) * boardCell;

  // 트랙(점선 안내)
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(120,60,60,.45)"; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < mv.track.length; i++) {
    const cc = boardX + (mv.track[i].c + 0.5) * boardCell;
    const rr = boardY + (mv.track[i].r + 0.5) * boardCell;
    if (i === 0) ctx.moveTo(cc, rr); else ctx.lineTo(cc, rr);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 몸체
  const R = boardCell * 0.34;
  ctx.save();
  ctx.shadowColor = "rgba(80,0,0,.4)"; ctx.shadowBlur = 12;
  const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.2, x, y, R);
  g.addColorStop(0, "#f6837a"); g.addColorStop(1, "#9c2a23");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3; ctx.strokeStyle = "#5a1714"; ctx.stroke();
  // 가시
  ctx.fillStyle = "#5a1714";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * R, y + Math.sin(a) * R, R * 0.13, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTarget(t: Cell, now: number) {
  const { x, y } = cellCenter(t.c, t.r);
  const blink = 0.55 + 0.45 * Math.sin(now / 260);
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

function drawEmitter(e: Stage["emitter"], now: number) {
  const x = boardX + e.c * boardCell, y = boardY + e.r * boardCell, p = boardCell * 0.12;
  const glow = 0.6 + 0.4 * Math.sin(now / 200);
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#4b5670"); g.addColorStop(1, "#2b3247");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = "#1c2233"; ctx.lineWidth = 3; ctx.stroke();

  const cc = cellCenter(e.c, e.r);
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

function drawMirror(m: Mirror, now: number) {
  const x = boardX + m.c * boardCell, y = boardY + m.r * boardCell, p = boardCell * 0.14;
  const selectable = screen === "manipulate";
  const isSel = selectedMirror === m.id;

  if (selectable) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.save();
    ctx.shadowColor = `rgba(245,192,66,${0.5 + pulse * 0.4})`; ctx.shadowBlur = 16 + pulse * 10;
    roundRect(x + p * 0.5, y + p * 0.5, boardCell - p, boardCell - p, 10);
    ctx.fillStyle = "rgba(245,192,66,.12)"; ctx.fill();
    ctx.restore();
  }
  // 타일
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#f4f8ff"); g.addColorStop(1, "#c9d7ee");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = isSel ? "#ffffff" : "#7d92b8";
  ctx.lineWidth = isSel ? 5 : 2.5;
  ctx.stroke();
  if (isSel) {
    ctx.save();
    ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; ctx.stroke();
    ctx.restore();
  }
  // 거울선
  const m1 = boardCell * 0.22, m2 = boardCell - m1;
  ctx.save();
  ctx.lineCap = "round"; ctx.lineWidth = boardCell * 0.16;
  const mg = ctx.createLinearGradient(x, y, x + boardCell, y + boardCell);
  mg.addColorStop(0, "#bfe6ff"); mg.addColorStop(0.5, "#5fa8e8"); mg.addColorStop(1, "#2f6fc0");
  ctx.strokeStyle = mg;
  ctx.beginPath();
  if (m.ori === "/")       { ctx.moveTo(x + m1, y + m2); ctx.lineTo(x + m2, y + m1); }
  else if (m.ori === "\\") { ctx.moveTo(x + m1, y + m1); ctx.lineTo(x + m2, y + m2); }
  else if (m.ori === "|")  { ctx.moveTo(x + boardCell / 2, y + m1); ctx.lineTo(x + boardCell / 2, y + m2); }
  else                     { ctx.moveTo(x + m1, y + boardCell / 2); ctx.lineTo(x + m2, y + boardCell / 2); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = boardCell * 0.04; ctx.stroke();
  ctx.restore();

  if (selectable) drawRotateIcon(x + boardCell - p, y + p, boardCell * 0.16, now);
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
  const pts = beam.points.map(p => cellCenter(p.c, p.r));
  if (pts.length < 2) return;

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
  ctx.shadowColor = col; ctx.shadowBlur = 18;
  ctx.strokeStyle = COLOR.beamGlow; ctx.lineWidth = boardCell * 0.22;
  drawPoly(line);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = col; ctx.lineWidth = boardCell * 0.1;
  drawPoly(line);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLOR.beamCore; ctx.lineWidth = boardCell * 0.035;
  drawPoly(line);
  if (beamProgress < 1) {
    ctx.shadowColor = col; ctx.shadowBlur = 24;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(head.x, head.y, boardCell * 0.12, 0, Math.PI * 2); ctx.fill();
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

  if (hint) {
    ctx.save();
    ctx.fillStyle = "rgba(15,28,51,.5)";
    const tw = ctx.measureText(hint).width;
    ctx.font = 'bold 18px "Pretendard", sans-serif';
    const padX = 22;
    const w = Math.min(LOGICAL_W - 360, ctx.measureText(hint).width + padX * 2);
    const h = 40;
    const x = (LOGICAL_W - 320 - w) / 2;
    roundRect(x, y0 + 10, w, h, 999); ctx.fill();
    drawText(hint, x + w / 2, y0 + 38, {
      font: 'bold 18px "Pretendard", sans-serif', color: "#fff", align: "center",
    });
    ctx.restore();
  }

  // 완료 버튼 (manipulate 단계에서만 활성)
  const bW = 220, bH = 64, bX = LOGICAL_W - bW - 40, bY = y0 + 6;
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
  drawText(textData.doneBtn, bX + bW / 2, bY + bH / 2 + 10, {
    font: 'black 28px "Pretendard", sans-serif', color: enabled ? "#fff" : "rgba(255,255,255,.55)", align: "center",
  });
  ctx.restore();
  addBtn({ x: bX, y: bY, w: bW, h: bH, label: textData.doneBtn, kind: enabled ? "primary" : "ghost",
    enabled, onClick: () => { Sfx.click(); fireLaser(lastFrameMs); } });

}

function drawBanner(text: string) {
  const el = (lastFrameMs - phaseStartMs) / 1000;
  const a = Math.min(1, Math.max(0, 1 - Math.abs(el - 0.7) / 1.0));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(8,16,32,.45)";
  ctx.fillRect(0, LOGICAL_H / 2 - 90, LOGICAL_W, 180);
  drawText(text, LOGICAL_W / 2, LOGICAL_H / 2 + 24, {
    font: 'black 88px "Pretendard", sans-serif', color: "#fff", align: "center",
    shadow: "rgba(0,0,0,.5)", shadowBlur: 24,
  });
  if (stageP) {
    const team = appData.teams[stageP.team];
    drawText(`${stageP.round}${textData.roundLabel} · ${team.name}`, LOGICAL_W / 2, LOGICAL_H / 2 + 70, {
      font: 'bold 28px "Pretendard", sans-serif', color: "#fff", align: "center",
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

  const cardW = 520, cardH = 380;
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
  drawText(icon, cx, y + 100, {
    font: '80px "Apple Color Emoji","Segoe UI Emoji",sans-serif', color: "#000", align: "center",
  });
  drawText(title, cx, y + 168, {
    font: 'black 38px "Pretendard", sans-serif', color: COLOR.ink, align: "center",
  });
  drawText(desc, cx, y + 208, {
    font: 'bold 17px "Pretendard", sans-serif', color: COLOR.inkSub, align: "center",
  });

  const ptsColor = resultPoints > 0 ? COLOR.team0 : "#98a2b8";
  drawText("+" + resultPoints, cx, y + 280, {
    font: 'black 56px "Pretendard", sans-serif', color: ptsColor, align: "center",
  });

  // 다음 버튼
  const bW = 240, bH = 56, bX = cx - bW / 2, bY = y + cardH - bH - 28;
  const isLast = (stageIndex + 1) >= appData.totalRounds * appData.stagesPerRound;
  const label = isLast ? textData.finalNextBtn : textData.nextBtn;
  ctx.save();
  ctx.fillStyle = "#16336e";
  roundRect(bX, bY + 5, bW, bH, 999); ctx.fill();
  const g = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  g.addColorStop(0, "#2f64c8"); g.addColorStop(1, "#214a99");
  ctx.fillStyle = g;
  roundRect(bX, bY, bW, bH, 999); ctx.fill();
  drawText(label, bX + bW / 2, bY + bH / 2 + 10, {
    font: 'black 24px "Pretendard", sans-serif', color: "#fff", align: "center",
  });
  ctx.restore();
  addBtn({ x: bX, y: bY, w: bW, h: bH, label, kind: "primary",
    onClick: () => { Sfx.click(); nextStage(); } });
}

// ---------- 최종 결과 ----------

function drawFinalScreen() {
  drawBackground();
  drawText(textData.gameOver, LOGICAL_W / 2, 160, {
    font: 'black 64px "Pretendard", sans-serif', color: "#fff", align: "center",
    shadow: "rgba(0,0,0,.45)", shadowBlur: 16,
  });

  const [a, b] = teamScores;
  let winText = textData.draw;
  if (a > b) winText = appData.teams[0].name + textData.winSuffix;
  else if (b > a) winText = appData.teams[1].name + textData.winSuffix;
  drawText(winText, LOGICAL_W / 2, 230, {
    font: 'black 44px "Pretendard", sans-serif', color: COLOR.yellow, align: "center",
    shadow: "rgba(0,0,0,.4)", shadowBlur: 12,
  });

  // 팀 박스
  const bW = 240, bH = 220, gap = 60, totalW = bW * 2 + gap + 80;
  const startX = (LOGICAL_W - totalW) / 2;
  drawFinalTeamBox(startX, 320, bW, bH, 0, a >= b);
  drawText("VS", startX + bW + gap / 2 + 28, 320 + bH / 2 + 12, {
    font: 'black 42px "Pretendard", sans-serif', color: "rgba(255,255,255,.8)", align: "center",
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
  drawText(appData.teams[teamId].name, x + w / 2, y + 56, {
    font: 'bold 26px "Pretendard", sans-serif', color: "#fff", align: "center",
  });
  drawText(String(teamScores[teamId]), x + w / 2, y + 150, {
    font: 'black 72px "Pretendard", sans-serif', color: "#fff", align: "center",
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
  computeBoardLayout();
  beam = null; beamProgress = 0; resultShown = false; resultPoints = 0;
  bounceScheduled.forEach(t => clearTimeout(t)); bounceScheduled = [];
  setScreen("intro", now);
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
  // 이동 장애물 동결 위치
  const key = (c: number, r: number) => c + "," + r;
  const moverCells = new Set<string>();
  stage.movers.forEach(mv => {
    const idx = Math.round(mv.t);
    const c = mv.track[idx];
    moverCells.add(key(c.c, c.r));
  });
  beam = traceLaser(stage, moverCells);
  beamProgress = 0;
  beamStartMs = now;
  const segs = Math.max(1, beam.points.length - 1);
  beamDuration = Math.min(4000, Math.max(900, segs * 340));
  Sfx.fire();

  // 거울 통과 시점에 반사음 예약
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
      bounceScheduled.push(window.setTimeout(() => Sfx.bounce(), t));
    }
  }
}

function showResult() {
  if (!beam || !stageP) return;
  resultShown = true;
  screen = "result";

  let pts = appData.scoring.fail;
  if (beam.result === "perfect") { pts = appData.scoring.perfect; Sfx.perfect(); }
  else if (beam.result === "partial") { pts = appData.scoring.partial; Sfx.partial(); }
  else Sfx.fail();
  resultPoints = pts;
  teamScores[stageP.team] += pts;
}

// 프레임마다 호출
function update(now: number) {
  lastFrameMs = now;
  const dt = (now - (update as any)._last || 0) / 1000;
  (update as any)._last = now;

  if (screen === "manipulate" && stage) {
    // 이동 장애물 진행
    stage.movers.forEach(mv => {
      const speed = 1.2; // 칸/초
      mv.t += mv.dir * speed * dt;
      if (mv.t >= mv.track.length - 1) { mv.t = mv.track.length - 1; mv.dir = -1; }
      else if (mv.t <= 0) { mv.t = 0; mv.dir = 1; }
    });
  }

  if (screen === "intro" && stage) {
    if (now - phaseStartMs > 1900) setScreen("predict", now);
  } else if (screen === "predict" && stage) {
    const rem = Math.ceil(stage.predict - (now - phaseStartMs) / 1000);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) { lastTickSec = rem; Sfx.tick(); }
    if ((now - phaseStartMs) / 1000 >= stage.predict) setScreen("manipulate", now);
  } else if (screen === "manipulate" && stage) {
    const elapsed = (now - phaseStartMs) / 1000;
    const rem = Math.ceil(stage.time - elapsed);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) { lastTickSec = rem; Sfx.tick(); }
    if (rem <= 0) fireLaser(now);
  } else if (screen === "fire") {
    beamProgress = Math.min(1, (now - beamStartMs) / beamDuration);
    if (!resultShown && now - beamStartMs >= beamDuration + 600) showResult();
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
  // 1) 버튼 우선
  const b = hitButton(pos.x, pos.y);
  if (b) { pressedBtn = b; b.onClick(); return; }
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
      Sfx.rotate();
    } else {
      selectedMirror = null;
    }
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

  screen = "title";
  requestAnimationFrame(gameLoop);
}

export { initApp };

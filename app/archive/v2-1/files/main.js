// appHelper.ts
import { toPng } from "html-to-image";
var AppHelper = class {
  static async fetchRawData() {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`Failed to load data.json`);
    return await response.json();
  }
  static async loadAppData() {
    const data = await this.fetchRawData();
    return data.appData;
  }
  static async loadTextData() {
    const data = await this.fetchRawData();
    const textData2 = data.textData;
    if (!textData2?.default_language) {
      return textData2;
    }
    const defaultLang = textData2.default_language;
    let lang = defaultLang;
    if (textData2.supported_multiple_languages) {
      lang = new URLSearchParams(window.location.search).get("lang") || defaultLang;
    }
    const langTexts = textData2[lang];
    const texts = langTexts && Object.keys(langTexts).length > 0 ? langTexts : textData2[defaultLang] || {};
    return texts;
  }
  static async loadAssetList() {
    const data = await this.fetchRawData();
    return data.assetList;
  }
  /**
   * 브라우저 클라이언트 좌표를 캔버스의 논리 해상도 좌표로 변환합니다.
   * AI 지침: appCanvas 규칙에 따라 모든 마우스/터치 좌표 보정에 이 함수를 사용하세요.
   * @param clientX - event.clientX
   * @param clientY - event.clientY
   * @param appCanvas - 기준이 되는 HTMLCanvasElement
   */
  static getRelativeCoordinates(clientX, clientY, appCanvas2) {
    const rect = appCanvas2.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const scaleX = appCanvas2.width / rect.width;
    const scaleY = appCanvas2.height / rect.height;
    return {
      x: x * scaleX,
      y: y * scaleY
    };
  }
  /** 기기 유형 감지 */
  static getPlatform() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || navigator.maxTouchPoints > 0 ? "mobile" : "pc";
  }
  /** 화면 방향 감지 (가로 모드 여부) */
  static isLandscape() {
    return window.innerWidth > window.innerHeight;
  }
  /** 터치 지원 여부 (PC라도 터치 모니터일 수 있음) */
  static supportsTouch() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }
  /** 텍스트를 안전한 HTML로 변환 (XSS 방어) */
  static sanitizeText(text) {
    let safe = text.replace(
      /<(script|style|iframe|svg|math|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );
    safe = safe.replace(
      /<\/?(script|style|iframe|svg|math|form)\b[^>]*\/?>/gi,
      ""
    );
    safe = safe.replace(
      /<\/?(img|a|input|button|textarea|select|option|label|fieldset|legend|link|meta|base|video|audio|source|object|embed|span|div|table|tr|td|th|thead|tbody|tfoot|col|colgroup|caption|h[1-6]|nav|section|article|header|footer|main|aside|details|summary)\b[^>]*>/gi,
      ""
    );
    safe = safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    safe = safe.replace(/&lt;(br)\s*\/?&gt;/gi, "<br>");
    safe = safe.replace(/&lt;(\/?(?:p|b|i|u|strong|em|small))&gt;/gi, "<$1>");
    safe = safe.replace(/&amp;#(\d+);/g, (match, num) => {
      const n = parseInt(num, 10);
      return n === 38 || n === 60 || n === 62 ? match : `&#${num};`;
    });
    safe = safe.replace(/&amp;#x([0-9a-fA-F]+);/g, (match, hex) => {
      const n = parseInt(hex, 16);
      return n === 38 || n === 60 || n === 62 ? match : `&#x${hex};`;
    });
    safe = safe.replace(/\n/g, "<br>");
    return safe;
  }
  /** DOM기반 UI 요소 생성 */
  static createUIElement(elementType, id = "", styles = {}, textContent = "", eventListeners = []) {
    const element = document.createElement(elementType);
    if (id) element.id = id;
    Object.assign(element.style, styles);
    if (styles.pointerEvents === "auto") {
      element.style.touchAction = "none";
    }
    if (textContent) {
      element.innerHTML = this.sanitizeText(textContent);
    }
    eventListeners.forEach(({ event, handler }) => {
      element.addEventListener(event, handler);
    });
    return element;
  }
  /**
   * 캔버스를 캡처하여 Data URL을 반환합니다. (내부 구현용)
   * @param includeUILayer - true이면 UI 레이어 포함, false이면 appCanvas만 캡처
   * @returns Data URL 문자열 또는 캡처 실패 시 null
   */
  static async captureCanvasAsDataUrl(includeUILayer = true) {
    const appCanvas2 = document.getElementById("appCanvas");
    const appContainer2 = document.getElementById("appContainer");
    if (!appCanvas2 || !appContainer2) return null;
    let dataUrl = null;
    try {
      if (includeUILayer) {
        const savedStyle = appContainer2.style.cssText;
        appContainer2.style.transform = "none";
        appContainer2.style.position = "relative";
        appContainer2.style.left = "0";
        appContainer2.style.top = "0";
        dataUrl = await toPng(appContainer2, {
          width: appCanvas2.width,
          height: appCanvas2.height
        });
        appContainer2.style.cssText = savedStyle;
      } else {
        dataUrl = appCanvas2.toDataURL("image/webp");
      }
    } catch (e) {
      return null;
    }
    return dataUrl && dataUrl !== "data:," ? dataUrl : null;
  }
  /**
   * 캔버스를 캡처하여 HTMLImageElement로 반환합니다.
   * AI 지침: 게임 로직에서 캡처한 이미지를 바로 사용하려면 이 함수를 사용하세요. (예: 캔버스에 다시 그리기, UI에 표시 등)
   * @param includeUILayer - true이면 UI 레이어 포함, false이면 appCanvas만 캡처
   * @returns 로드된 HTMLImageElement 또는 캡처 실패 시 null
   */
  static async captureCanvasAsImage(includeUILayer = true) {
    const dataUrl = await this.captureCanvasAsDataUrl(includeUILayer);
    if (!dataUrl) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
};

// app.ts
import * as confetti from "canvas-confetti";
var LOGICAL_W = 1280;
var LOGICAL_H = 800;
var COLOR = {
  bgTop: "#5a86d6",
  bgBot: "#3a5fae",
  panel: "#eef3fb",
  ink: "#1f2d4a",
  inkSub: "#4a5876",
  gridTop: "#dce8fb",
  gridBot: "#c2d6f4",
  gridLine: "rgba(90,130,200,.30)",
  gridEdge: "rgba(60,100,170,.55)",
  team0: "#3b6fd4",
  team1: "#d8453b",
  yellow: "#f5c042",
  green: "#42b549",
  orange: "#f0a92b",
  red: "#e0473d",
  beamCore: "#fff7e8",
  beamMain: "#ff5a36",
  beamGlow: "rgba(255,160,90,.55)",
  hudBg: "rgba(15,28,51,.55)",
  hudInk: "#ffffff"
};
var DELTA = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
var REFLECT = {
  "/": { R: "U", U: "R", L: "D", D: "L" },
  "\\": { R: "D", D: "R", L: "U", U: "L" },
  "|": { L: "R", R: "L", U: "U", D: "D" },
  // 세로 광선 통과
  "-": { U: "D", D: "U", L: "L", R: "R" }
  // 가로 광선 통과
};
var PERP = { R: ["U", "D"], L: ["U", "D"], U: ["L", "R"], D: ["L", "R"] };
function mirrorTypeFor(inDir, outDir) {
  return REFLECT["/"][inDir] === outDir ? "/" : "\\";
}
function orientationCycle(step) {
  return step === 45 ? ["/", "|", "\\", "-"] : ["/", "\\"];
}
var appData;
var textData;
var assetList;
var canvas;
var ctx;
var screen = "title";
var diff = "EASY";
var stageIndex = 0;
var stage = null;
var stageP = null;
var teamScores = [0, 0];
var phaseStartMs = 0;
var lastFrameMs = 0;
var lastTickSec = -1;
var beam = null;
var beamProgress = 0;
var beamStartMs = 0;
var beamDuration = 1200;
var bounceScheduled = [];
var buttons = [];
var pressedBtn = null;
var selectedMirror = null;
var resultShown = false;
var resultPoints = 0;
var confettiPlayed = false;
var Sfx = {
  click() {
  },
  rotate() {
  },
  fire() {
  },
  perfect() {
  },
  partial() {
  },
  fail() {
  },
  bounce() {
  },
  tick() {
  },
  stageStart() {
  }
};
function traceLaser(s, moverCells) {
  let dir = s.emitter.dir;
  let c = s.emitter.c, r = s.emitter.r;
  const points = [{ c, r }];
  const hit = /* @__PURE__ */ new Set();
  const maxSteps = s.cols * s.rows * 4 + 20;
  const key = (cc, rr) => cc + "," + rr;
  const wallSet = new Set(s.walls.map((w) => key(w.c, w.r)));
  const forbSet = new Set(s.forbidden.map((f) => key(f.c, f.r)));
  const targetK = key(s.target.c, s.target.r);
  const mirrorMap = /* @__PURE__ */ new Map();
  s.mirrors.forEach((m) => mirrorMap.set(key(m.c, m.r), m));
  for (let step = 0; step < maxSteps; step++) {
    const [dc, dr] = DELTA[dir];
    c += dc;
    r += dr;
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
      const result = hit.size === s.mirrors.length ? "perfect" : "partial";
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
function randInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
function generateStage(p) {
  for (let attempt = 0; attempt < 700; attempt++) {
    const s = tryBuild(p);
    if (s) return s;
  }
  return generateStage({ ...p, mirrors: Math.max(1, p.mirrors - 1) });
}
function tryBuild(p) {
  const cols = p.cols, rows = p.rows;
  const used = /* @__PURE__ */ new Set();
  const key = (c2, r2) => c2 + "," + r2;
  const inBounds = (c2, r2) => c2 >= 0 && r2 >= 0 && c2 < cols && r2 < rows;
  let emitter;
  const edge = randInt(0, 3);
  if (edge === 0) emitter = { c: 0, r: randInt(1, rows - 2), dir: "R" };
  else if (edge === 1) emitter = { c: cols - 1, r: randInt(1, rows - 2), dir: "L" };
  else if (edge === 2) emitter = { c: randInt(1, cols - 2), r: 0, dir: "D" };
  else emitter = { c: randInt(1, cols - 2), r: rows - 1, dir: "U" };
  used.add(key(emitter.c, emitter.r));
  let c = emitter.c, r = emitter.r;
  let cdir = emitter.dir;
  const mirrors = [];
  for (let i = 0; i < p.mirrors; i++) {
    const run = randInt(1, 3);
    let nc = c, nr = r, ok = true;
    for (let k = 0; k < run; k++) {
      nc += DELTA[cdir][0];
      nr += DELTA[cdir][1];
      if (!inBounds(nc, nr) || used.has(key(nc, nr))) {
        ok = false;
        break;
      }
      used.add(key(nc, nr));
    }
    if (!ok) return null;
    const candidates = PERP[cdir].filter((nd) => {
      const tc2 = nc + DELTA[nd][0], tr2 = nr + DELTA[nd][1];
      return inBounds(tc2, tr2) && !used.has(key(tc2, tr2));
    });
    if (candidates.length === 0) return null;
    const ndir = pick(candidates);
    mirrors.push({ id: i, c: nc, r: nr, sol: mirrorTypeFor(cdir, ndir), ori: "/" });
    c = nc;
    r = nr;
    cdir = ndir;
  }
  const tail = randInt(1, 3);
  let tc = c, tr = r;
  for (let k = 0; k < tail; k++) {
    tc += DELTA[cdir][0];
    tr += DELTA[cdir][1];
    if (!inBounds(tc, tr) || used.has(key(tc, tr))) return null;
    used.add(key(tc, tr));
  }
  const target = { c: tc, r: tr };
  const free = [];
  for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
    if (!used.has(key(cc, rr))) free.push({ c: cc, r: rr });
  }
  shuffle(free);
  const taken = /* @__PURE__ */ new Set();
  const takeNext = () => {
    while (free.length > 0) {
      const f = free.shift();
      const k = key(f.c, f.r);
      if (!taken.has(k)) {
        taken.add(k);
        return f;
      }
    }
    return null;
  };
  const walls = [];
  for (let i = 0; i < p.walls; i++) {
    const f = takeNext();
    if (!f) break;
    walls.push(f);
  }
  const forbidden = [];
  for (let i = 0; i < p.forbidden; i++) {
    const f = takeNext();
    if (!f) break;
    forbidden.push(f);
  }
  const movers = [];
  for (let i = 0; i < p.movers; i++) {
    const seed = takeNext();
    if (!seed) break;
    const dirs = shuffle(["R", "L", "U", "D"]);
    let track = [seed];
    for (const d of dirs) {
      const len = randInt(1, 3);
      let cc = seed.c, rr = seed.r, okExt = true;
      const tmp = [];
      for (let k = 0; k < len; k++) {
        cc += DELTA[d][0];
        rr += DELTA[d][1];
        const kk = key(cc, rr);
        if (!inBounds(cc, rr) || used.has(kk) || taken.has(kk)) {
          okExt = false;
          break;
        }
        tmp.push({ c: cc, r: rr });
      }
      if (okExt && tmp.length >= 1) {
        tmp.forEach((t) => taken.add(key(t.c, t.r)));
        track = track.concat(tmp);
        break;
      }
    }
    if (track.length >= 2) movers.push({ track, t: 0, dir: 1 });
    else taken.delete(key(seed.c, seed.r));
  }
  const cycle = orientationCycle(p.rotateStep);
  mirrors.forEach((m) => {
    const wrong = cycle.filter((o) => o !== m.sol);
    m.ori = pick(wrong);
  });
  const stage2 = {
    cols,
    rows,
    emitter,
    target,
    mirrors,
    walls,
    forbidden,
    movers,
    rotateStep: p.rotateStep,
    time: p.time,
    predict: p.predict
  };
  mirrors.forEach((m) => {
    m.ori = m.sol;
  });
  const moverFreeze = new Set(movers.map((mv) => key(mv.track[0].c, mv.track[0].r)));
  if (traceLaser(stage2, moverFreeze).result !== "perfect") return null;
  mirrors.forEach((m) => {
    const wrong = cycle.filter((o) => o !== m.sol);
    m.ori = pick(wrong);
  });
  if (traceLaser(stage2, moverFreeze).result === "perfect") return null;
  return stage2;
}
function stageParams(d, idx) {
  const b = appData.difficulties[d];
  const round = Math.floor(idx / appData.stagesPerRound);
  return {
    diff: d,
    round: round + 1,
    stageInRound: idx % appData.stagesPerRound + 1,
    team: idx % 2,
    cols: b.cols + round,
    rows: b.rows + (round > 1 ? 1 : 0),
    mirrors: b.mirrors + round,
    walls: b.walls + round,
    forbidden: b.forbidden + (round > 0 ? 1 : 0),
    movers: b.movers + (b.movers > 0 && round > 1 ? 1 : 0),
    time: Math.max(24, b.time - round * 10),
    predict: b.predict,
    rotateStep: b.rotateStep
  };
}
var HUD_H = 76;
var FOOT_H = 96;
var boardCell = 56;
var boardX = 0;
var boardY = HUD_H;
var boardW = 0;
var boardH = 0;
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
function cellCenter(c, r) {
  return { x: boardX + (c + 0.5) * boardCell, y: boardY + (r + 0.5) * boardCell };
}
function pointToCell(px, py) {
  if (px < boardX || py < boardY || px >= boardX + boardW || py >= boardY + boardH) return null;
  return { c: Math.floor((px - boardX) / boardCell), r: Math.floor((py - boardY) / boardCell) };
}
function addBtn(b) {
  const btn = {
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    label: b.label,
    sub: b.sub,
    kind: b.kind || "primary",
    meta: b.meta,
    enabled: b.enabled !== false,
    selected: !!b.selected,
    onClick: b.onClick
  };
  buttons.push(btn);
  return btn;
}
function hitButton(px, py) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (!b.enabled) continue;
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
  }
  return null;
}
function roundRect(x, y, w, h, rr) {
  const r = Math.min(rr, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawText(text, x, y, opts = {}) {
  ctx.save();
  ctx.font = opts.font || 'bold 24px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.fillStyle = opts.color || "#fff";
  ctx.textAlign = opts.align || "left";
  ctx.textBaseline = opts.baseline || "alphabetic";
  if (opts.shadow) {
    ctx.shadowColor = opts.shadow;
    ctx.shadowBlur = opts.shadowBlur || 8;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}
function fillVerticalGradient(x, y, w, h, top, bot) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}
function drawBackground() {
  fillVerticalGradient(0, 0, LOGICAL_W, LOGICAL_H, COLOR.bgTop, COLOR.bgBot);
  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 28; i++) {
    const x = (i * 79 + 13) % LOGICAL_W;
    const y = (i * 173 + 47) % LOGICAL_H;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawTitleScreen(now) {
  drawBackground();
  const cx = LOGICAL_W / 2;
  drawText(textData.title, cx, 200, {
    font: 'black 110px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
    color: "#fff",
    align: "center",
    baseline: "alphabetic",
    shadow: "rgba(0,0,0,.35)",
    shadowBlur: 20
  });
  ctx.save();
  ctx.fillStyle = "#1d3f86";
  ctx.font = 'black 110px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(textData.title, cx + 4, 204);
  ctx.fillStyle = "#fff";
  ctx.fillText(textData.title, cx, 200);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.32)";
  roundRect(cx - 320, 232, 640, 50, 25);
  ctx.fill();
  drawText(textData.tagline, cx, 266, {
    font: 'bold 22px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.restore();
  drawDecoMirror(160, 470, now, "#fff");
  drawDecoMirror(LOGICAL_W - 160, 470, now, "#fff", true);
  const diffs = ["EASY", "NORMAL", "HARD"];
  const dColors = { EASY: COLOR.green, NORMAL: COLOR.orange, HARD: COLOR.red };
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
function drawDecoMirror(cx, cy, now, _color, flip = false) {
  const s = 80 + Math.sin(now / 600) * 4;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  roundRect(-s / 2, -s / 2, s, s, 14);
  const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
  g.addColorStop(0, "#f4f8ff");
  g.addColorStop(1, "#c9d7ee");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#7d92b8";
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineWidth = 14;
  const mg = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
  mg.addColorStop(0, "#bfe6ff");
  mg.addColorStop(0.5, "#5fa8e8");
  mg.addColorStop(1, "#2f6fc0");
  ctx.strokeStyle = mg;
  ctx.beginPath();
  ctx.moveTo(-s / 2 + 14, s / 2 - 14);
  ctx.lineTo(s / 2 - 14, -s / 2 + 14);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.7)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}
function drawDiffButton(x, y, w, h, key, color, isSel) {
  const d = appData.difficulties[key];
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.28)";
  roundRect(x, y + 8, w, h, 18);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(x, y - (isSel ? 4 : 0), w, h, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 3;
  ctx.stroke();
  drawText(d.label, x + w / 2, y + (isSel ? -4 : 0) + 50, {
    font: 'black 34px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.fillStyle = "rgba(0,0,0,.22)";
  roundRect(x + w / 2 - 38, y + (isSel ? -4 : 0) + 64, 76, 26, 13);
  ctx.fill();
  drawText(d.sub, x + w / 2, y + (isSel ? -4 : 0) + 83, {
    font: 'bold 16px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  if (isSel) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#fff";
    roundRect(x - 5, y - 9, w + 10, h + 10, 22);
    ctx.stroke();
  }
  ctx.restore();
  addBtn({
    x,
    y: y - 4,
    w,
    h: h + 4,
    label: key,
    kind: "diff",
    meta: key,
    selected: isSel,
    onClick: () => {
      diff = key;
      Sfx.click();
    }
  });
}
function drawStartButton(x, y, w, h, label) {
  ctx.save();
  ctx.fillStyle = "#16336e";
  roundRect(x, y + 9, w, h, 999);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "#2f64c8");
  g.addColorStop(1, "#214a99");
  ctx.fillStyle = g;
  roundRect(x, y, w, h, 999);
  ctx.fill();
  drawText(label, x + w / 2, y + h / 2 + 13, {
    font: 'black 38px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.restore();
  addBtn({
    x,
    y,
    w,
    h,
    label,
    kind: "primary",
    onClick: () => {
      Sfx.click();
      startGame();
    }
  });
}
function drawGameScreen(now) {
  drawBackground();
  drawHud();
  drawBoard(now);
  drawFooter();
  if (screen === "intro") drawBanner(textData.stageStart);
  if (screen === "result") drawResultCard();
}
function drawHud() {
  if (!stageP) return;
  ctx.fillStyle = COLOR.hudBg;
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);
  drawText(`${stageP.round}R`, 28, 50, {
    font: 'black 36px "Pretendard", sans-serif',
    color: "#fff"
  });
  drawText(`STAGE ${stageP.round}-${stageP.stageInRound}`, 84, 54, {
    font: 'bold 18px "Pretendard", sans-serif',
    color: "rgba(255,255,255,.75)"
  });
  const team = appData.teams[stageP.team];
  const tagW = 200, tagH = 36;
  const tagX = LOGICAL_W / 2 - tagW / 2;
  ctx.fillStyle = team.color;
  roundRect(tagX, 8, tagW, tagH, 18);
  ctx.fill();
  drawText(team.name + textData.turnSuffix, LOGICAL_W / 2, 33, {
    font: 'black 20px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  const t = currentTimerSec();
  if (t >= 0) {
    let color = "#fff";
    if (screen === "manipulate") {
      if (t <= 5) color = "#ff5b4d";
      else if (t <= 10) color = COLOR.yellow;
    }
    const ts = String(t).padStart(2, "0");
    drawText(ts, LOGICAL_W / 2, 70, {
      font: 'black 38px "Pretendard", sans-serif',
      color,
      align: "center"
    });
  }
  const sW = 110, sH = 56, sGap = 12;
  const tot = sW * 2 + sGap;
  const x0 = LOGICAL_W - tot - 28;
  for (let i = 0; i < 2; i++) {
    const sx = x0 + i * (sW + sGap);
    const sy = 10;
    ctx.fillStyle = appData.teams[i].color;
    roundRect(sx, sy, sW, sH, 14);
    ctx.fill();
    if (stageP.team === i) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    drawText(appData.teams[i].name, sx + sW / 2, sy + 20, {
      font: 'bold 14px "Pretendard", sans-serif',
      color: "#fff",
      align: "center"
    });
    drawText(String(teamScores[i]), sx + sW / 2, sy + 48, {
      font: 'black 28px "Pretendard", sans-serif',
      color: "#fff",
      align: "center"
    });
  }
}
function currentTimerSec() {
  if (!stage || !stageP) return -1;
  const el = (lastFrameMs - phaseStartMs) / 1e3;
  if (screen === "predict") return Math.max(0, Math.ceil(stage.predict - el));
  if (screen === "manipulate") return Math.max(0, Math.ceil(stage.time - el));
  return -1;
}
function drawBoard(now) {
  if (!stage) return;
  ctx.save();
  fillVerticalGradient(boardX, boardY, boardW, boardH, COLOR.gridTop, COLOR.gridBot);
  ctx.restore();
  ctx.strokeStyle = COLOR.gridLine;
  ctx.lineWidth = 1;
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
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.gridEdge;
  roundRect(boardX + 1.5, boardY + 1.5, boardW - 3, boardH - 3, 12);
  ctx.stroke();
  stage.forbidden.forEach((f) => drawForbidden(f, now));
  stage.walls.forEach((w) => drawWall(w));
  stage.movers.forEach((mv) => drawMover(mv));
  drawTarget(stage.target, now);
  drawEmitter(stage.emitter, now);
  stage.mirrors.forEach((m) => drawMirror(m, now));
  if (beam && (screen === "fire" || screen === "result")) drawBeam(now);
}
function drawForbidden(f, now) {
  const x = boardX + f.c * boardCell, y = boardY + f.r * boardCell;
  const pulse = 0.5 + 0.5 * Math.sin(now / 240);
  ctx.save();
  roundRect(x + 3, y + 3, boardCell - 6, boardCell - 6, 8);
  ctx.clip();
  ctx.fillStyle = `rgba(224,71,61,${0.32 + pulse * 0.22})`;
  ctx.fillRect(x, y, boardCell, boardCell);
  ctx.strokeStyle = "rgba(150,20,15,.55)";
  ctx.lineWidth = 6;
  for (let i = -boardCell; i < boardCell; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + boardCell);
    ctx.lineTo(x + i + boardCell, y);
    ctx.stroke();
  }
  ctx.restore();
  drawText("\u2715", x + boardCell / 2, y + boardCell / 2 + boardCell * 0.13, {
    font: `bold ${Math.round(boardCell * 0.42)}px sans-serif`,
    color: "#fff",
    align: "center"
  });
}
function drawWall(w) {
  const x = boardX + w.c * boardCell, y = boardY + w.r * boardCell, p = boardCell * 0.1;
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#8a93a6");
  g.addColorStop(1, "#5d6678");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = "#454c5c";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + p, y + boardCell / 2);
  ctx.lineTo(x + boardCell - p, y + boardCell / 2);
  ctx.stroke();
}
function drawMover(mv) {
  const tf = mv.t;
  const i0 = Math.floor(tf);
  const i1 = Math.min(mv.track.length - 1, i0 + 1);
  const f = tf - i0;
  const a = mv.track[i0];
  const b = mv.track[i1];
  const x = boardX + (a.c * (1 - f) + b.c * f + 0.5) * boardCell;
  const y = boardY + (a.r * (1 - f) + b.r * f + 0.5) * boardCell;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(120,60,60,.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < mv.track.length; i++) {
    const cc = boardX + (mv.track[i].c + 0.5) * boardCell;
    const rr = boardY + (mv.track[i].r + 0.5) * boardCell;
    if (i === 0) ctx.moveTo(cc, rr);
    else ctx.lineTo(cc, rr);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  const R = boardCell * 0.34;
  ctx.save();
  ctx.shadowColor = "rgba(80,0,0,.4)";
  ctx.shadowBlur = 12;
  const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.2, x, y, R);
  g.addColorStop(0, "#f6837a");
  g.addColorStop(1, "#9c2a23");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#5a1714";
  ctx.stroke();
  ctx.fillStyle = "#5a1714";
  for (let i = 0; i < 8; i++) {
    const a2 = i / 8 * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a2) * R, y + Math.sin(a2) * R, R * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawTarget(t, now) {
  const { x, y } = cellCenter(t.c, t.r);
  const blink = 0.55 + 0.45 * Math.sin(now / 260);
  const R = boardCell * 0.4;
  ctx.save();
  ctx.shadowColor = `rgba(80,200,120,${blink})`;
  ctx.shadowBlur = 22 * blink;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(x, y, R * (1 - i * 0.3), 0, Math.PI * 2);
    ctx.lineWidth = boardCell * 0.1;
    ctx.strokeStyle = i % 2 === 0 ? `rgba(40,170,80,${0.6 + blink * 0.4})` : "rgba(255,255,255,.9)";
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, R * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(50,200,90,${blink})`;
  ctx.fill();
  ctx.restore();
}
function drawEmitter(e, now) {
  const x = boardX + e.c * boardCell, y = boardY + e.r * boardCell, p = boardCell * 0.12;
  const glow = 0.6 + 0.4 * Math.sin(now / 200);
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#4b5670");
  g.addColorStop(1, "#2b3247");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = "#1c2233";
  ctx.lineWidth = 3;
  ctx.stroke();
  const cc = cellCenter(e.c, e.r);
  const d = DELTA[e.dir];
  const lx = cc.x + d[0] * boardCell * 0.34;
  const ly = cc.y + d[1] * boardCell * 0.34;
  ctx.save();
  ctx.shadowColor = `rgba(255,80,60,${glow})`;
  ctx.shadowBlur = 20 * glow;
  ctx.beginPath();
  ctx.arc(lx, ly, boardCell * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,${Math.round(90 + glow * 80)},70,1)`;
  ctx.fill();
  ctx.restore();
}
function drawMirror(m, now) {
  const x = boardX + m.c * boardCell, y = boardY + m.r * boardCell, p = boardCell * 0.14;
  const selectable = screen === "manipulate";
  const isSel = selectedMirror === m.id;
  if (selectable) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    ctx.save();
    ctx.shadowColor = `rgba(245,192,66,${0.5 + pulse * 0.4})`;
    ctx.shadowBlur = 16 + pulse * 10;
    roundRect(x + p * 0.5, y + p * 0.5, boardCell - p, boardCell - p, 10);
    ctx.fillStyle = "rgba(245,192,66,.12)";
    ctx.fill();
    ctx.restore();
  }
  const g = ctx.createLinearGradient(x, y, x, y + boardCell);
  g.addColorStop(0, "#f4f8ff");
  g.addColorStop(1, "#c9d7ee");
  ctx.fillStyle = g;
  roundRect(x + p, y + p, boardCell - p * 2, boardCell - p * 2, 9);
  ctx.fill();
  ctx.strokeStyle = isSel ? "#ffffff" : "#7d92b8";
  ctx.lineWidth = isSel ? 5 : 2.5;
  ctx.stroke();
  if (isSel) {
    ctx.save();
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
  }
  const m1 = boardCell * 0.22, m2 = boardCell - m1;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = boardCell * 0.16;
  const mg = ctx.createLinearGradient(x, y, x + boardCell, y + boardCell);
  mg.addColorStop(0, "#bfe6ff");
  mg.addColorStop(0.5, "#5fa8e8");
  mg.addColorStop(1, "#2f6fc0");
  ctx.strokeStyle = mg;
  ctx.beginPath();
  if (m.ori === "/") {
    ctx.moveTo(x + m1, y + m2);
    ctx.lineTo(x + m2, y + m1);
  } else if (m.ori === "\\") {
    ctx.moveTo(x + m1, y + m1);
    ctx.lineTo(x + m2, y + m2);
  } else if (m.ori === "|") {
    ctx.moveTo(x + boardCell / 2, y + m1);
    ctx.lineTo(x + boardCell / 2, y + m2);
  } else {
    ctx.moveTo(x + m1, y + boardCell / 2);
    ctx.lineTo(x + m2, y + boardCell / 2);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.7)";
  ctx.lineWidth = boardCell * 0.04;
  ctx.stroke();
  ctx.restore();
  if (selectable) drawRotateIcon(x + boardCell - p, y + p, boardCell * 0.16, now);
}
function drawRotateIcon(cx, cy, R, now) {
  const spin = now / 600 % (Math.PI * 2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.strokeStyle = COLOR.yellow;
  ctx.lineWidth = R * 0.36;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, R, 0.4, Math.PI * 1.6);
  ctx.stroke();
  const ex = Math.cos(Math.PI * 1.6) * R, ey = Math.sin(Math.PI * 1.6) * R;
  ctx.fillStyle = COLOR.yellow;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - R * 0.5, ey - R * 0.1);
  ctx.lineTo(ex - R * 0.1, ey + R * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawBeam(_now) {
  if (!beam) return;
  const pts = beam.points.map((p) => cellCenter(p.c, p.r));
  if (pts.length < 2) return;
  const segLen = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLen.push(d);
    total += d;
  }
  const reveal = total * beamProgress;
  const line = [pts[0]];
  let acc = 0;
  let head = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (acc + segLen[i - 1] <= reveal) {
      line.push(pts[i]);
      acc += segLen[i - 1];
      head = pts[i];
    } else {
      const t = (reveal - acc) / segLen[i - 1];
      head = {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t
      };
      line.push(head);
      break;
    }
  }
  const col = beam.result === "fail" && beamProgress >= 1 ? "#ff3b30" : COLOR.beamMain;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = col;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = COLOR.beamGlow;
  ctx.lineWidth = boardCell * 0.22;
  drawPoly(line);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = col;
  ctx.lineWidth = boardCell * 0.1;
  drawPoly(line);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLOR.beamCore;
  ctx.lineWidth = boardCell * 0.035;
  drawPoly(line);
  if (beamProgress < 1) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(head.x, head.y, boardCell * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawPoly(line) {
  if (line.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(line[0].x, line[0].y);
  for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
  ctx.stroke();
}
function drawFooter() {
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
    roundRect(x, y0 + 10, w, h, 999);
    ctx.fill();
    drawText(hint, x + w / 2, y0 + 38, {
      font: 'bold 18px "Pretendard", sans-serif',
      color: "#fff",
      align: "center"
    });
    ctx.restore();
  }
  const bW = 220, bH = 64, bX = LOGICAL_W - bW - 40, bY = y0 + 6;
  const enabled = screen === "manipulate";
  ctx.save();
  ctx.fillStyle = enabled ? "#135f29" : "#3a4055";
  roundRect(bX, bY + 6, bW, bH, 999);
  ctx.fill();
  if (enabled) {
    const g = ctx.createLinearGradient(bX, bY, bX, bY + bH);
    g.addColorStop(0, "#2fbf55");
    g.addColorStop(1, "#1f8f3f");
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = "#5b6378";
  }
  roundRect(bX, bY, bW, bH, 999);
  ctx.fill();
  drawText(textData.doneBtn, bX + bW / 2, bY + bH / 2 + 10, {
    font: 'black 28px "Pretendard", sans-serif',
    color: enabled ? "#fff" : "rgba(255,255,255,.55)",
    align: "center"
  });
  ctx.restore();
  addBtn({
    x: bX,
    y: bY,
    w: bW,
    h: bH,
    label: textData.doneBtn,
    kind: enabled ? "primary" : "ghost",
    enabled,
    onClick: () => {
      Sfx.click();
      fireLaser(lastFrameMs);
    }
  });
}
function drawBanner(text) {
  const el = (lastFrameMs - phaseStartMs) / 1e3;
  const a = Math.min(1, Math.max(0, 1 - Math.abs(el - 0.7) / 1));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(8,16,32,.45)";
  ctx.fillRect(0, LOGICAL_H / 2 - 90, LOGICAL_W, 180);
  drawText(text, LOGICAL_W / 2, LOGICAL_H / 2 + 24, {
    font: 'black 88px "Pretendard", sans-serif',
    color: "#fff",
    align: "center",
    shadow: "rgba(0,0,0,.5)",
    shadowBlur: 24
  });
  if (stageP) {
    const team = appData.teams[stageP.team];
    drawText(`${stageP.round}${textData.roundLabel} \xB7 ${team.name}`, LOGICAL_W / 2, LOGICAL_H / 2 + 70, {
      font: 'bold 28px "Pretendard", sans-serif',
      color: "#fff",
      align: "center"
    });
  }
  ctx.restore();
}
function drawResultCard() {
  if (!beam) return;
  ctx.save();
  ctx.fillStyle = "rgba(8,16,32,.62)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.restore();
  const cardW = 520, cardH = 380;
  const cx = LOGICAL_W / 2, cy = LOGICAL_H / 2;
  const x = cx - cardW / 2, y = cy - cardH / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = COLOR.panel;
  roundRect(x, y, cardW, cardH, 26);
  ctx.fill();
  ctx.restore();
  const res = beam.result;
  const r = beam.reason;
  let icon = "\u{1F3AF}", title = textData.failTitle, desc = textData.failMiss;
  if (res === "perfect") {
    icon = "\u{1F3AF}";
    title = textData.perfectTitle;
    desc = textData.perfectDesc;
  } else if (res === "partial") {
    icon = "\u2728";
    title = textData.partialTitle;
    desc = textData.partialDesc;
  } else {
    icon = "\u{1F4A5}";
    title = textData.failTitle;
    desc = r === "out" ? textData.failOut : r === "block" ? textData.failBlock : r === "forbidden" ? textData.failForbidden : textData.failMiss;
  }
  drawText(icon, cx, y + 100, {
    font: '80px "Apple Color Emoji","Segoe UI Emoji",sans-serif',
    color: "#000",
    align: "center"
  });
  drawText(title, cx, y + 168, {
    font: 'black 38px "Pretendard", sans-serif',
    color: COLOR.ink,
    align: "center"
  });
  drawText(desc, cx, y + 208, {
    font: 'bold 17px "Pretendard", sans-serif',
    color: COLOR.inkSub,
    align: "center"
  });
  const ptsColor = resultPoints > 0 ? COLOR.team0 : "#98a2b8";
  drawText("+" + resultPoints, cx, y + 280, {
    font: 'black 56px "Pretendard", sans-serif',
    color: ptsColor,
    align: "center"
  });
  const bW = 240, bH = 56, bX = cx - bW / 2, bY = y + cardH - bH - 28;
  const isLast = stageIndex + 1 >= appData.totalRounds * appData.stagesPerRound;
  const label = isLast ? textData.finalNextBtn : textData.nextBtn;
  ctx.save();
  ctx.fillStyle = "#16336e";
  roundRect(bX, bY + 5, bW, bH, 999);
  ctx.fill();
  const g = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  g.addColorStop(0, "#2f64c8");
  g.addColorStop(1, "#214a99");
  ctx.fillStyle = g;
  roundRect(bX, bY, bW, bH, 999);
  ctx.fill();
  drawText(label, bX + bW / 2, bY + bH / 2 + 10, {
    font: 'black 24px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.restore();
  addBtn({
    x: bX,
    y: bY,
    w: bW,
    h: bH,
    label,
    kind: "primary",
    onClick: () => {
      Sfx.click();
      nextStage();
    }
  });
}
function drawFinalScreen() {
  drawBackground();
  drawText(textData.gameOver, LOGICAL_W / 2, 160, {
    font: 'black 64px "Pretendard", sans-serif',
    color: "#fff",
    align: "center",
    shadow: "rgba(0,0,0,.45)",
    shadowBlur: 16
  });
  const [a, b] = teamScores;
  let winText = textData.draw;
  if (a > b) winText = appData.teams[0].name + textData.winSuffix;
  else if (b > a) winText = appData.teams[1].name + textData.winSuffix;
  drawText(winText, LOGICAL_W / 2, 230, {
    font: 'black 44px "Pretendard", sans-serif',
    color: COLOR.yellow,
    align: "center",
    shadow: "rgba(0,0,0,.4)",
    shadowBlur: 12
  });
  const bW = 240, bH = 220, gap = 60, totalW = bW * 2 + gap + 80;
  const startX = (LOGICAL_W - totalW) / 2;
  drawFinalTeamBox(startX, 320, bW, bH, 0, a >= b);
  drawText("VS", startX + bW + gap / 2 + 28, 320 + bH / 2 + 12, {
    font: 'black 42px "Pretendard", sans-serif',
    color: "rgba(255,255,255,.8)",
    align: "center"
  });
  drawFinalTeamBox(startX + bW + gap + 56, 320, bW, bH, 1, b >= a);
  const sW = 280, sH = 70, sX = (LOGICAL_W - sW) / 2;
  drawStartButton(sX, 600, sW, sH, textData.restartBtn);
  if (!confettiPlayed) {
    confettiPlayed = true;
    try {
      confetti.default({ particleCount: 180, spread: 110, origin: { y: 0.5 } });
    } catch (e) {
    }
  }
}
function drawFinalTeamBox(x, y, w, h, teamId, win) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.28)";
  roundRect(x, y + 10, w, h, 22);
  ctx.fill();
  ctx.fillStyle = appData.teams[teamId].color;
  roundRect(x, y, w, h, 22);
  ctx.fill();
  if (win) {
    ctx.strokeStyle = COLOR.yellow;
    ctx.lineWidth = 6;
    roundRect(x - 4, y - 4, w + 8, h + 8, 26);
    ctx.stroke();
  }
  drawText(appData.teams[teamId].name, x + w / 2, y + 56, {
    font: 'bold 26px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  drawText(String(teamScores[teamId]), x + w / 2, y + 150, {
    font: 'black 72px "Pretendard", sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.restore();
}
function setScreen(s, now) {
  screen = s;
  phaseStartMs = now;
  lastTickSec = -1;
  selectedMirror = null;
  if (s === "intro") {
    Sfx.stageStart();
  }
}
function startGame() {
  teamScores = [0, 0];
  stageIndex = 0;
  confettiPlayed = false;
  loadStage(0, performance.now());
}
function loadStage(idx, now) {
  stageIndex = idx;
  stageP = stageParams(diff, idx);
  stage = generateStage(stageP);
  computeBoardLayout();
  beam = null;
  beamProgress = 0;
  resultShown = false;
  resultPoints = 0;
  bounceScheduled.forEach((t) => clearTimeout(t));
  bounceScheduled = [];
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
function fireLaser(now) {
  if (!stage) return;
  setScreen("fire", now);
  const key = (c, r) => c + "," + r;
  const moverCells = /* @__PURE__ */ new Set();
  stage.movers.forEach((mv) => {
    const idx = Math.round(mv.t);
    const c = mv.track[idx];
    moverCells.add(key(c.c, c.r));
  });
  beam = traceLaser(stage, moverCells);
  beamProgress = 0;
  beamStartMs = now;
  const segs = Math.max(1, beam.points.length - 1);
  beamDuration = Math.min(4e3, Math.max(900, segs * 340));
  Sfx.fire();
  if (beam.points.length >= 3) {
    const pts = beam.points;
    const len = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].c - pts[i - 1].c, pts[i].r - pts[i - 1].r);
      len.push(d);
      total += d;
    }
    let acc = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      acc += len[i - 1];
      const t = acc / total * beamDuration;
      bounceScheduled.push(window.setTimeout(() => Sfx.bounce(), t));
    }
  }
}
function showResult() {
  if (!beam || !stageP) return;
  resultShown = true;
  screen = "result";
  let pts = appData.scoring.fail;
  if (beam.result === "perfect") {
    pts = appData.scoring.perfect;
    Sfx.perfect();
  } else if (beam.result === "partial") {
    pts = appData.scoring.partial;
    Sfx.partial();
  } else Sfx.fail();
  resultPoints = pts;
  teamScores[stageP.team] += pts;
}
function update(now) {
  lastFrameMs = now;
  const dt = (now - update._last || 0) / 1e3;
  update._last = now;
  if (screen === "manipulate" && stage) {
    stage.movers.forEach((mv) => {
      const speed = 1.2;
      mv.t += mv.dir * speed * dt;
      if (mv.t >= mv.track.length - 1) {
        mv.t = mv.track.length - 1;
        mv.dir = -1;
      } else if (mv.t <= 0) {
        mv.t = 0;
        mv.dir = 1;
      }
    });
  }
  if (screen === "intro" && stage) {
    if (now - phaseStartMs > 1900) setScreen("predict", now);
  } else if (screen === "predict" && stage) {
    const rem = Math.ceil(stage.predict - (now - phaseStartMs) / 1e3);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) {
      lastTickSec = rem;
      Sfx.tick();
    }
    if ((now - phaseStartMs) / 1e3 >= stage.predict) setScreen("manipulate", now);
  } else if (screen === "manipulate" && stage) {
    const elapsed = (now - phaseStartMs) / 1e3;
    const rem = Math.ceil(stage.time - elapsed);
    if (rem !== lastTickSec && rem > 0 && rem <= 5) {
      lastTickSec = rem;
      Sfx.tick();
    }
    if (rem <= 0) fireLaser(now);
  } else if (screen === "fire") {
    beamProgress = Math.min(1, (now - beamStartMs) / beamDuration);
    if (!resultShown && now - beamStartMs >= beamDuration + 600) showResult();
  }
}
function render(now) {
  buttons = [];
  if (screen === "title") drawTitleScreen(now);
  else if (screen === "final") drawFinalScreen();
  else drawGameScreen(now);
}
function onPointerDown(e) {
  const pos = AppHelper.getRelativeCoordinates(e.clientX, e.clientY, canvas);
  const b = hitButton(pos.x, pos.y);
  if (b) {
    pressedBtn = b;
    b.onClick();
    return;
  }
  if (screen === "manipulate" && stage) {
    const cell = pointToCell(pos.x, pos.y);
    if (!cell) return;
    const m = stage.mirrors.find((mm) => mm.c === cell.c && mm.r === cell.r);
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
function gameLoop(now) {
  update(now);
  render(now);
  requestAnimationFrame(gameLoop);
}
async function initApp() {
  appData = await AppHelper.loadAppData();
  textData = await AppHelper.loadTextData();
  assetList = await AppHelper.loadAssetList();
  canvas = document.getElementById("appCanvas");
  canvas.width = LOGICAL_W;
  canvas.height = LOGICAL_H;
  ctx = canvas.getContext("2d");
  canvas.addEventListener("pointerdown", onPointerDown);
  screen = "title";
  requestAnimationFrame(gameLoop);
}

// main.ts
var logicalWidth = 0;
var logicalHeight = 0;
var appCanvas = document.getElementById("appCanvas");
var uiLayer = document.getElementById("uiLayer");
var appContainer = document.getElementById("appContainer");
var isCanvasLayoutUpdating = false;
function UpdateCanvasLayout() {
  if (!isCanvasLayoutUpdating) {
    window.requestAnimationFrame(() => {
      isCanvasLayoutUpdating = true;
      if (appCanvas.width !== 1 && appCanvas.height !== 1) {
        if (logicalWidth === 0 && logicalHeight === 0) {
          logicalWidth = appCanvas.width;
          logicalHeight = appCanvas.height;
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        appContainer.style.cssText = "";
        appCanvas.style.cssText = "";
        uiLayer.style.cssText = "";
        const aspectCanvas = appCanvas.width / appCanvas.height;
        let displayWidth;
        let displayHeight;
        if (vw / vh > aspectCanvas) {
          displayHeight = vh;
          displayWidth = vh * aspectCanvas;
        } else {
          displayWidth = vw;
          displayHeight = vw / aspectCanvas;
        }
        const appContainerScale = displayWidth / appCanvas.width;
        appContainer.style.position = "absolute";
        appContainer.style.width = appCanvas.width + "px";
        appContainer.style.height = appCanvas.height + "px";
        appContainer.style.transformOrigin = "top left";
        appContainer.style.transform = `scale(${appContainerScale})`;
        appContainer.style.left = (vw - displayWidth) / 2 + "px";
        appContainer.style.top = (vh - displayHeight) / 2 + "px";
        appCanvas.style.position = "absolute";
        appCanvas.style.width = appCanvas.width + "px";
        appCanvas.style.height = "auto";
        appCanvas.style.top = "0";
        appCanvas.style.left = "0";
        appCanvas.style.touchAction = "none";
        const uiLayerScale = appCanvas.width / logicalWidth;
        ;
        uiLayer.style.position = "absolute";
        uiLayer.style.width = logicalWidth + "px";
        uiLayer.style.height = logicalHeight + "px";
        uiLayer.style.transformOrigin = "top left";
        uiLayer.style.transform = `scale(${uiLayerScale})`;
        uiLayer.style.top = "0";
        uiLayer.style.left = "0";
      }
      isCanvasLayoutUpdating = false;
    });
  }
}
function SetCanvasFocus() {
  if (document.activeElement !== appCanvas) {
    window.focus();
    appCanvas.focus();
  }
}
var resizeObserver = new ResizeObserver((entries) => {
  for (let entry of entries) {
    if (entry.target === appCanvas) {
      UpdateCanvasLayout();
    }
  }
});
var isCapturing = false;
var lastPingTime = 0;
var lastCaptureTime = 0;
var lastResolutionTime = 0;
var MIN_PARENT_MESSAGE_INTERVAL = 1e3;
window.parent.postMessage({
  source: "typingx-x-iframe",
  type: "ping-pong-ready"
}, "*");
window.addEventListener("message", async (event) => {
  if (!event.data || event.data.source !== "alparka-parent") return;
  const now = Date.now();
  if (event.data.type === "ping" && now - lastPingTime > MIN_PARENT_MESSAGE_INTERVAL) {
    lastPingTime = now;
    window.parent.postMessage({
      source: "typingx-x-iframe",
      type: "pong"
    }, "*");
  } else if (event.data.type === "request-canvas-capture" && now - lastCaptureTime > MIN_PARENT_MESSAGE_INTERVAL && !isCapturing) {
    lastCaptureTime = now;
    isCapturing = true;
    try {
      const dataUrl = await AppHelper.captureCanvasAsDataUrl(true);
      if (dataUrl) {
        window.parent.postMessage({
          source: "typingx-x-iframe",
          type: "canvas-capture",
          payload: { dataUrl }
        }, "*");
      }
    } finally {
      isCapturing = false;
    }
  } else if (event.data.type === "request-app-resolution" && now - lastResolutionTime > MIN_PARENT_MESSAGE_INTERVAL) {
    lastResolutionTime = now;
    window.parent.postMessage({
      source: "typingx-x-iframe",
      type: "app-resolution",
      payload: { width: appCanvas.width, height: appCanvas.height }
    }, "*");
  }
});
window.addEventListener("resize", UpdateCanvasLayout);
appCanvas.addEventListener("pointerdown", SetCanvasFocus);
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    resizeObserver.observe(appCanvas);
    initApp();
    SetCanvasFocus();
    UpdateCanvasLayout();
  }, 0);
});

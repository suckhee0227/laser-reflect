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
  // 세로 거울: 가로빔 되돌림, 세로빔 통과
  "-": { U: "D", D: "U", L: "L", R: "R" }
  // 가로 거울: 세로빔 되돌림, 가로빔 통과
};
var PERP = { R: ["U", "D"], L: ["U", "D"], U: ["L", "R"], D: ["L", "R"] };
function orientationCycle(step) {
  return step === 45 ? ["/", "|", "\\", "-"] : ["/", "\\"];
}
function mirrorTypeFor(inDir, outDir) {
  return REFLECT["/"][inDir] === outDir ? "/" : "\\";
}
function faceForBeam(o, inDir) {
  const flip = o === "\\";
  let back = false;
  if (o === "/") back = inDir === "R" || inDir === "D";
  else if (o === "\\") back = inDir === "L" || inDir === "D";
  return { back, flip };
}
function oriToAngle45(o) {
  return o === "-" ? Math.PI / 2 : 0;
}
var solInDir = {};
var appData;
var textData;
var assetList;
var canvas;
var ctx;
var ASSET_VER = "8";
var titleImgs = {};
var titleAssetsLoaded = 0;
var titleAssetsTotal = 0;
var titleHover = null;
var modal = null;
var soundOn = true;
var rotatableHoverId = null;
var titleLayout = [];
var editMode = false;
var editSelected = null;
var editDragging = false;
var editDragOffX = 0;
var editDragOffY = 0;
var editResizing = null;
var editResizeStart = null;
var editRotating = false;
var editRotateStart = null;
var editToast = null;
var devMode = false;
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
var mirrorAnim = /* @__PURE__ */ new Map();
var gridCalibMode = false;
var gridCalib = {};
function getCalib() {
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
  fetch("gridcalib.json").then((r) => r.ok ? r.json() : null).then((j) => {
    if (j && typeof j === "object") {
      for (const k in j) if (!gridCalib[k]) gridCalib[k] = j[k];
      if (stage) computeBoardLayout();
    }
  }).catch(() => {
  });
  try {
    const s = localStorage.getItem("laserGridCalib");
    if (s) Object.assign(gridCalib, JSON.parse(s));
  } catch (_) {
  }
}
function saveGridCalib() {
  try {
    localStorage.setItem("laserGridCalib", JSON.stringify(gridCalib));
  } catch (_) {
  }
}
function downloadGridCalibJSON() {
  const blob = new Blob([JSON.stringify(gridCalib, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gridcalib.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
var beamStartMs = 0;
var beamDuration = 1200;
var bounceScheduled = [];
var beamCells = [];
var beamCellArrival = [];
var beamMoverCheckedIdx = 0;
var beamCutIndex = -1;
var comboCount = 0;
var comboMax = 0;
var comboBonus = 0;
var comboScheduled = [];
var comboPopups = [];
var comboParticles = [];
var comboRings = [];
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
  bounce(_pitch) {
  },
  tick() {
  },
  stageStart() {
  }
};
var DEFAULT_TITLE_LAYOUT = [
  // 배경
  { id: "bg", key: "bg", x: 0, y: 0, w: 1280, h: 800, cover: true },
  // 구름
  { id: "cloud1", key: "cloud1", x: 170, y: 60, w: 120, h: 70 },
  { id: "cloud2", key: "cloud2", x: 990, y: 50, w: 130, h: 75 },
  { id: "cloud3", key: "cloud3", x: 880, y: 200, w: 90, h: 55 },
  { id: "cloud4", key: "cloud4", x: 260, y: 280, w: 75, h: 45 },
  // 별
  { id: "star1", key: "star", x: 320, y: 90, w: 34, h: 34 },
  { id: "star2", key: "star", x: 920, y: 80, w: 30, h: 30 },
  { id: "star3", key: "star", x: 720, y: 60, w: 26, h: 26 },
  { id: "star4", key: "star", x: 460, y: 280, w: 22, h: 22 },
  { id: "star5", key: "star", x: 800, y: 290, w: 24, h: 24 },
  { id: "star6", key: "star", x: 200, y: 380, w: 20, h: 20 },
  // 좌·우 상단 거울 데코
  { id: "deco_mirror_L", key: "mirror", x: 170, y: 130, w: 110, h: 110 },
  { id: "deco_mirror_R", key: "mirror_arrow", x: 1e3, y: 140, w: 110, h: 110 },
  // 로고
  { id: "logo", key: "logo", x: 340, y: 50, w: 600, h: 320 },
  // 레이저 빔 장식 (로고 위에 떠서 잘 보이게)
  { id: "deco_laser", key: "laser_beam", x: 150, y: 100, w: 320, h: 140 },
  { id: "deco_mirror_beam", key: "mirror_with_beam", x: 820, y: 20, w: 300, h: 250 },
  // 캐릭터
  { id: "char_blue", key: "char_blue", x: 20, y: 360, w: 260, h: 430 },
  { id: "char_red", key: "char_red", x: 1e3, y: 360, w: 260, h: 430 },
  // 하단 도구 장식
  { id: "toolbox", key: "toolbox", x: 20, y: 650, w: 120, h: 120 },
  { id: "tool_wrench", key: "tool_wrench", x: 140, y: 720, w: 110, h: 65 },
  { id: "stone_deco", key: "stone", x: 1120, y: 690, w: 80, h: 80 },
  { id: "tool_driver", key: "tool_driver", x: 1060, y: 740, w: 200, h: 60 },
  // 인터랙티브
  { id: "btn_settings", key: "btn_settings", x: 40, y: 30, w: 100, h: 130, interactive: "SETTINGS" },
  { id: "btn_scoreboard", key: "btn_scoreboard", x: 1140, y: 30, w: 100, h: 130, interactive: "SCOREBOARD" },
  { id: "btn_easy", key: "btn_easy", x: 330, y: 420, w: 200, h: 130, interactive: "EASY" },
  { id: "btn_normal", key: "btn_normal", x: 540, y: 420, w: 210, h: 130, interactive: "NORMAL" },
  { id: "btn_hard", key: "btn_hard", x: 760, y: 420, w: 200, h: 130, interactive: "HARD" },
  { id: "btn_start", key: "btn_start", x: 480, y: 600, w: 320, h: 100, interactive: "START" }
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
  } catch (e) {
  }
  titleLayout = DEFAULT_TITLE_LAYOUT.map((x) => ({ ...x }));
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
  showEditToast("layout.json \uB2E4\uC6B4\uB85C\uB4DC \u2014 app/assets/title/ \uD3F4\uB354\uC5D0 \uB36E\uC5B4\uC4F0\uAE30");
}
function showEditToast(msg) {
  editToast = { msg, until: performance.now() + 3e3 };
}
function loadTitleAssets() {
  const keys = [
    "bg",
    "logo",
    "char_blue",
    "char_red",
    "btn_settings",
    "btn_scoreboard",
    "btn_easy",
    "btn_normal",
    "btn_hard",
    "btn_start",
    "mirror",
    "mirror_arrow",
    "toolbox",
    "tool_wrench",
    "tool_driver",
    "cloud1",
    "cloud2",
    "cloud3",
    "cloud4",
    "star",
    "24",
    "stone",
    "board",
    "laser_beam",
    "mirror_with_beam",
    "emitter",
    "target",
    "target_hit",
    "mirror_arrow_right",
    "stone_small",
    "mirror_back",
    "emitter_game",
    "mirror_game",
    "mirror_front",
    "mirror_front45",
    "mirror_back45",
    "board_square",
    "board_wide",
    "board_hard",
    "mover"
  ];
  titleAssetsTotal = keys.length;
  keys.forEach((k) => {
    const img = new Image();
    img.onload = () => {
      titleAssetsLoaded++;
    };
    img.onerror = () => {
    };
    img.src = `assets/title/${k}.png?v=${ASSET_VER}`;
    titleImgs[k] = img;
  });
}
function comboColor(n) {
  if (n <= 1) return "#ffffff";
  if (n === 2) return "#f5c042";
  if (n === 3) return "#f0892b";
  if (n === 4) return "#e0473d";
  return "#ffd24a";
}
function comboBonusFor(n) {
  return n >= 2 ? n - 1 : 0;
}
function traceLaser(s, moverCells) {
  let dir = s.emitter.dir;
  let c = s.emitter.c, r = s.emitter.r;
  const points = [{ c, r }];
  const hit = /* @__PURE__ */ new Set();
  const inDir = {};
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
      const result = hit.size === s.mirrors.length ? "perfect" : "partial";
      return { result, reason: "miss", points, hitMirrors: hit, inDir };
    }
    const m = mirrorMap.get(k);
    if (m) {
      inDir[m.id] = dir;
      const nd = REFLECT[m.ori][dir];
      points.push({ c, r });
      if (nd !== dir) hit.add(m.id);
      dir = nd;
    }
  }
  return { result: "fail", reason: "loop", points, hitMirrors: hit, inDir };
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
  const maxRun = Math.max(3, Math.min(cols, rows) - 2);
  const minRun = Math.min(3, maxRun);
  for (let i = 0; i < p.mirrors; i++) {
    const run = randInt(minRun, maxRun);
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
  const tail = randInt(2, maxRun);
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
  const isPathAdjacent = (cell) => {
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dc, dr] of nb) {
      if (used.has(key(cell.c + dc, cell.r + dr))) return true;
    }
    return false;
  };
  free.sort((a, b) => (isPathAdjacent(b) ? 1 : 0) - (isPathAdjacent(a) ? 1 : 0));
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
  const movers = [];
  const mirrorKeys = new Set(mirrors.map((m) => key(m.c, m.r)));
  const segCells = [];
  used.forEach((s) => {
    const [sc, sr] = s.split(",").map(Number);
    if (sc === emitter.c && sr === emitter.r) return;
    if (sc === target.c && sr === target.r) return;
    if (mirrorKeys.has(s)) return;
    segCells.push({ c: sc, r: sr });
  });
  shuffle(segCells);
  const usedP = /* @__PURE__ */ new Set();
  for (let i = 0; i < p.movers; i++) {
    let placed = false;
    for (const P of segCells) {
      const pk = key(P.c, P.r);
      if (usedP.has(pk)) continue;
      const axes = shuffle([[1, 0], [0, 1]]);
      const MAX_SIDE = 3;
      for (const [dc, dr] of axes) {
        const side = (sgn) => {
          const cells = [];
          let cc = P.c, rr = P.r;
          for (let k = 0; k < MAX_SIDE; k++) {
            cc += dc * sgn;
            rr += dr * sgn;
            const kk = key(cc, rr);
            if (!inBounds(cc, rr) || used.has(kk) || taken.has(kk)) break;
            cells.push({ c: cc, r: rr });
          }
          return cells;
        };
        const neg = side(-1), pos = side(1);
        if (neg.length < 1 || neg.length + pos.length < 2) continue;
        const track = [...neg.slice().reverse(), P, ...pos];
        track.forEach((c2) => {
          if (!(c2.c === P.c && c2.r === P.r)) taken.add(key(c2.c, c2.r));
        });
        usedP.add(pk);
        movers.push({ track, t: 0, dir: 1 });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) break;
  }
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
  const cal = gridCalib[d];
  const dcols = cal && cal.dcols || 0;
  const drows = cal && cal.drows || 0;
  return {
    diff: d,
    round: round + 1,
    stageInRound: idx % appData.stagesPerRound + 1,
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
    diagonal: !!b.diagonal
  };
}
var HUD_H = 76;
var FOOT_H = 96;
var boardCell = 56;
var cellW = 56;
var cellH = 56;
var boardX = 0;
var boardY = HUD_H;
var boardW = 0;
var boardH = 0;
var boardImgX = 0;
var boardImgY = 0;
var boardImgW = 0;
var boardImgH = 0;
function boardKeyFor(d) {
  if (d === "NORMAL") return "board_wide";
  if (d === "HARD") return "board_hard";
  return "board_square";
}
function computeBoardLayout() {
  if (!stage) return;
  const img = titleImgs[boardKeyFor(diff)];
  const imgW = img && img.naturalWidth || 1254;
  const imgH = img && img.naturalHeight || 1254;
  const maxW = LOGICAL_W - 40;
  const availH = LOGICAL_H - HUD_H - FOOT_H;
  const maxH = availH - 8;
  const s = Math.min(maxW / imgW, maxH / imgH);
  boardImgW = Math.round(imgW * s);
  boardImgH = Math.round(imgH * s);
  boardImgX = Math.floor((LOGICAL_W - boardImgW) / 2);
  boardImgY = HUD_H + Math.floor((availH - boardImgH) / 2);
  const cal = gridCalib[diff];
  let cell = Math.floor(Math.min(boardImgW, boardImgH) * 0.72 / Math.max(stage.cols, stage.rows));
  if (cal && cal.dc) cell += cal.dc;
  const w0 = cell * stage.cols;
  const h0 = cell * stage.rows;
  let x0 = Math.round(boardImgX + (boardImgW - w0) / 2);
  let y0 = Math.round(boardImgY + (boardImgH - h0) / 2);
  if (cal) {
    x0 += cal.dx;
    y0 += cal.dy;
  }
  const dl = cal && cal.dl || 0, dr = cal && cal.dr || 0;
  const dt = cal && cal.dt || 0, db = cal && cal.db || 0;
  const left = x0 - dl, right = x0 + w0 + dr;
  const top = y0 - dt, bottom = y0 + h0 + db;
  boardX = left;
  boardY = top;
  boardW = Math.max(stage.cols, right - left);
  boardH = Math.max(stage.rows, bottom - top);
  cellW = boardW / stage.cols;
  cellH = boardH / stage.rows;
  boardCell = Math.min(cellW, cellH);
}
function cellX(c) {
  return boardX + c * cellW;
}
function cellY(r) {
  return boardY + r * cellH;
}
function cellCenter(c, r) {
  return { x: boardX + (c + 0.5) * cellW, y: boardY + (r + 0.5) * cellH };
}
function pointToCell(px, py) {
  if (px < boardX || py < boardY || px >= boardX + boardW || py >= boardY + boardH) return null;
  return { c: Math.floor((px - boardX) / cellW), r: Math.floor((py - boardY) / cellH) };
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
  ctx.font = opts.font || 'bold 24px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
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
  if (titleAssetsLoaded > 0) {
    drawTitleScreenImage(now);
  } else {
    drawTitleScreenFallback(now);
  }
  if (!modal && !editMode) drawModeToggle();
}
function drawModeToggle() {
  const w = 250, h = 48, x = LOGICAL_W / 2 - w / 2, y = 12;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.3)";
  roundRect(x, y + 3, w, h, h / 2);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  if (devMode) {
    g.addColorStop(0, "#8a5cf0");
    g.addColorStop(1, "#6a3fc8");
  } else {
    g.addColorStop(0, "#34c266");
    g.addColorStop(1, "#1f8f47");
  }
  ctx.fillStyle = g;
  roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  drawText(devMode ? "\u{1F6E0} \uAC1C\uBC1C\uC790 \uBAA8\uB4DC" : "\u{1F3AF} \uC2E4\uC804 \uBAA8\uB4DC", x + w / 2, y + h / 2 + 9, {
    font: `900 24px ${FF}`,
    color: "#fff",
    align: "center"
  });
  addBtn({
    x,
    y,
    w,
    h,
    label: "MODE",
    kind: "small",
    enabled: true,
    onClick: () => {
      Sfx.click();
      devMode = !devMode;
    }
  });
}
function drawEditChipButton(label, x, y, w, h, bgColor, onClick) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(x, y + 3, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = bgColor;
  roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, h / 2);
  ctx.stroke();
  ctx.font = 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
  addBtn({ x, y, w, h, label, kind: "small", onClick });
}
function drawTitleScreenImage(now) {
  for (const it of titleLayout) {
    if (it.cover) {
      drawAssetCover(it.key);
      continue;
    }
    if (it.key === "char_blue" || it.key === "char_red") {
      drawCharacterShadow(it);
    } else if (!editMode) {
      const sk = shadowKindFor(it);
      if (sk === "ground") drawGroundShadow(it);
    }
    const useDrop = !editMode && shadowKindFor(it) === "drop";
    if (it.interactive && !editMode) {
      const selected = it.interactive === "EASY" && diff === "EASY" || it.interactive === "NORMAL" && diff === "NORMAL" || it.interactive === "HARD" && diff === "HARD";
      drawInteractiveItem(it, now, selected);
    } else if (it.clickRotates && !editMode) {
      if (useDrop) withDropShadow(() => drawRotatableDeco(it, now));
      else drawRotatableDeco(it, now);
    } else {
      if (useDrop) withDropShadow(() => drawAsset(it.key, it.x, it.y, it.w, it.h, it.rot || 0));
      else drawAsset(it.key, it.x, it.y, it.w, it.h, it.rot || 0);
    }
  }
  if (!modal && !editMode) {
    for (const it of titleLayout) {
      if (!it.interactive) continue;
      const ik = it.interactive;
      addBtn({
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        label: ik,
        kind: "small",
        meta: ik,
        selected: ik === diff,
        onClick: () => {
          Sfx.click();
          if (ik === "EASY" || ik === "NORMAL" || ik === "HARD") diff = ik;
          else if (ik === "START") startGame();
          else if (ik === "SETTINGS") modal = "settings";
          else if (ik === "SCOREBOARD") modal = "scoreboard";
        }
      });
    }
  }
  if (modal && !editMode) drawTitleModal(now);
  if (editMode) drawEditorOverlay(now);
  if (!modal) drawEditorControls();
}
function drawEditorControls() {
  const y1 = LOGICAL_H - 36;
  let x = 14;
  const w = 92, h = 26, gap = 6;
  if (!editMode) {
    drawEditChipButton("\uC5D0\uB514\uD130", x, y1, w, h, "#3b6fd4", () => toggleEditMode());
    return;
  }
  drawEditChipButton("\uC800\uC7A5", x, y1, w, h, "#1f8f3f", () => downloadLayoutJSON());
  x += w + gap;
  drawEditChipButton("\uB9AC\uC14B", x, y1, w, h, "#9c6f1f", () => {
    titleLayout = DEFAULT_TITLE_LAYOUT.map((c) => ({ ...c }));
    editSelected = null;
    showEditToast("\uAE30\uBCF8 \uB808\uC774\uC544\uC6C3\uC73C\uB85C \uB9AC\uC14B");
  });
  x += w + gap;
  drawEditChipButton("\uC885\uB8CC", x, y1, w, h, "#9c2a23", () => toggleEditMode());
  if (editSelected !== null) {
    x += w + gap + 16;
    const zw = 70;
    drawEditChipButton("\uB9E8\uB4A4", x, y1, zw, h, "#3a4055", zSendToBack);
    x += zw + gap;
    drawEditChipButton("\uB4A4\uB85C", x, y1, zw, h, "#3a4055", zSendBackward);
    x += zw + gap;
    drawEditChipButton("\uC55E\uC73C\uB85C", x, y1, zw, h, "#3a4055", zBringForward);
    x += zw + gap;
    drawEditChipButton("\uB9E8\uC55E", x, y1, zw, h, "#3a4055", zBringToFront);
    const y2 = y1 - 36;
    let x2 = 14;
    const rw = 70;
    drawEditChipButton("-15\uB3C4", x2, y2, rw, h, "#5a3a8a", () => rotateSelected(-15));
    x2 += rw + gap;
    drawEditChipButton("+15\uB3C4", x2, y2, rw, h, "#5a3a8a", () => rotateSelected(15));
    x2 += rw + gap;
    drawEditChipButton("-5\uB3C4", x2, y2, rw, h, "#3a2a6a", () => rotateSelected(-5));
    x2 += rw + gap;
    drawEditChipButton("+5\uB3C4", x2, y2, rw, h, "#3a2a6a", () => rotateSelected(5));
    x2 += rw + gap;
    drawEditChipButton("\uD68C\uC8040", x2, y2, rw, h, "#3a2a6a", () => {
      if (editSelected !== null) {
        titleLayout[editSelected].rot = 0;
        showEditToast("\uD68C\uC804 0\uB3C4");
      }
    });
    x2 += rw + gap + 16;
    drawEditChipButton("\uBCF5\uC81C", x2, y2, rw, h, "#1f6f8f", duplicateSelected);
    x2 += rw + gap;
    drawEditChipButton("\uC0AD\uC81C", x2, y2, rw, h, "#9c2a23", deleteSelected);
  }
}
function rotateSelected(deg) {
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  it.rot = (it.rot || 0) + deg * Math.PI / 180;
  showEditToast(`${deg > 0 ? "+" : ""}${deg}\xB0 \uD68C\uC804`);
}
function duplicateSelected() {
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  const copy = {
    ...it,
    id: it.id + "_copy_" + Date.now().toString().slice(-4),
    x: it.x + 20,
    y: it.y + 20
  };
  titleLayout.splice(editSelected + 1, 0, copy);
  editSelected += 1;
  showEditToast("\uBCF5\uC81C: " + copy.id);
}
function deleteSelected() {
  if (editSelected === null) return;
  const removed = titleLayout.splice(editSelected, 1)[0];
  editSelected = null;
  showEditToast("\uC0AD\uC81C: " + removed.id);
}
function drawCharacterShadow(_it) {
}
function drawGroundShadow(it, opts = {}) {
  const wr = opts.widthRatio ?? 0.34;
  const hr = opts.heightRatio ?? 0.05;
  const yr = opts.yRatio ?? 0.97;
  const a = opts.alpha ?? 0.18;
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
function shadowKindFor(_it) {
  return "none";
}
function withDropShadow(draw) {
  ctx.save();
  ctx.shadowColor = "rgba(10,20,40,.22)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 3;
  draw();
  ctx.restore();
}
function drawRotatableDeco(it, now) {
  const img = titleImgs[it.key];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const hover = rotatableHoverId === it.id;
  const s = hover ? 1.06 : 1;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const dw = it.w * s, dh = it.h * s;
  const rot = it.rot || 0;
  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  if (hover) {
    ctx.save();
    const pulse = 0.7 + 0.3 * Math.sin(now / 220);
    ctx.shadowColor = `rgba(120,210,255,${pulse})`;
    ctx.shadowBlur = 22;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.shadowBlur = 14;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  if (hover) {
    const ax = cx + it.w * 0.5;
    const ay = cy - it.h * 0.45;
    const R = 14;
    const spin = now / 500 % (Math.PI * 2);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(spin);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, R - 5, 0.3, Math.PI * 1.6);
    ctx.stroke();
    const ex = Math.cos(Math.PI * 1.6) * (R - 5);
    const ey = Math.sin(Math.PI * 1.6) * (R - 5);
    ctx.fillStyle = "#ffe14a";
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 6, ey - 2);
    ctx.lineTo(ex - 2, ey + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
function drawInteractiveItem(it, now, selected) {
  const img = titleImgs[it.key];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const ik = it.interactive;
  const hover = titleHover === ik;
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
  if (hover || selected) {
    const pulse = 0.7 + 0.3 * Math.sin(now / 240);
    ctx.save();
    const glowLayers = (color, blurs) => {
      ctx.shadowColor = color;
      for (const b of blurs) {
        ctx.shadowBlur = b;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
    };
    if (hover && selected) {
      glowLayers(`rgba(255,210,60,${pulse})`, [18, 14, 10]);
      glowLayers(`rgba(255,255,255,1)`, [24, 16, 10]);
    } else if (hover) {
      glowLayers(`rgba(255,255,255,1)`, [22, 16, 12, 8]);
    } else {
      glowLayers(`rgba(255,210,60,${pulse})`, [22, 16, 12, 8]);
    }
    ctx.restore();
  }
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
function drawEditorOverlay(now) {
  ctx.save();
  ctx.fillStyle = "rgba(20,30,50,.18)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < LOGICAL_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LOGICAL_H);
    ctx.stroke();
  }
  for (let y = 0; y < LOGICAL_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LOGICAL_W, y);
    ctx.stroke();
  }
  ctx.restore();
  titleLayout.forEach((it, i) => {
    if (it.cover) return;
    const isSel = editSelected === i;
    const rot = it.rot || 0;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.lineWidth = isSel ? 3 : 1.5;
    ctx.strokeStyle = isSel ? "#ffd24a" : "rgba(255,255,255,.55)";
    ctx.setLineDash(isSel ? [] : [4, 4]);
    ctx.strokeRect(-it.w / 2, -it.h / 2, it.w, it.h);
    ctx.setLineDash([]);
    const label = it.id + (it.interactive ? ` (${it.interactive})` : "") + (rot ? `  ${Math.round(rot * 180 / Math.PI)}\xB0` : "");
    ctx.font = 'bold 12px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isSel ? "#ffd24a" : "rgba(0,0,0,.55)";
    ctx.fillRect(-it.w / 2, -it.h / 2 - 18, tw, 18);
    ctx.fillStyle = isSel ? "#000" : "#fff";
    ctx.fillText(label, -it.w / 2 + 5, -it.h / 2 - 5);
    ctx.restore();
    if (isSel) {
      ctx.save();
      const rh = rotationHandlePos(it);
      const topCenter = localToCanvas(it, 0, -it.h / 2);
      ctx.strokeStyle = "#5ddc8c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(topCenter.x, topCenter.y);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath();
      ctx.arc(rh.x, rh.y + 2, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5ddc8c";
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.75)";
  ctx.fillRect(0, 0, LOGICAL_W, 36);
  ctx.font = 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
  ctx.fillStyle = "#ffd24a";
  ctx.fillText("EDIT MODE", 14, 23);
  ctx.fillStyle = "#fff";
  const help = "click=select \xB7 drag=move \xB7 \uD578\uB4E4=\uB9AC\uC0AC\uC774\uC988 \xB7 \uB179\uC0C9\uC6D0=\uD68C\uC804(Shift=15\xB0\uC2A4\uB0C5) \xB7 O/P=\uD68C\uC804\xB15\xB0(Shift=\xB115\xB0) \xB7 T=\uD68C\uC8040\xB0 \xB7 \uD654\uC0B4\uD45C\xB11px \xB7 [/]=\uB9AC\uC0AC\uC774\uC988 \xB7 Z/Q/A/X=z \xB7 D=\uBCF5\uC81C \xB7 Del=\uC0AD\uC81C \xB7 S=\uC800\uC7A5 \xB7 R=\uB9AC\uC14B \xB7 E=\uC885\uB8CC";
  ctx.fillText(help, 110, 23);
  if (editSelected !== null && titleLayout[editSelected]) {
    const it = titleLayout[editSelected];
    const info = `${it.id}  x=${it.x}  y=${it.y}  w=${it.w}  h=${it.h}`;
    ctx.fillStyle = "#ffd24a";
    ctx.fillText(info, LOGICAL_W - ctx.measureText(info).width - 14, 23);
  }
  ctx.restore();
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
function drawAssetCover(k) {
  const img = titleImgs[k];
  if (!img || !img.complete || img.naturalWidth === 0) return;
  const scale = Math.max(LOGICAL_W / img.naturalWidth, LOGICAL_H / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const dx = (LOGICAL_W - dw) / 2, dy = (LOGICAL_H - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}
function drawAsset(k, x, y, w, h, rot = 0) {
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
function drawTitleModal(now) {
  ctx.save();
  ctx.fillStyle = "rgba(6,12,28,.62)";
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  ctx.restore();
  const w = 540, h = 380;
  const x = (LOGICAL_W - w) / 2, y = (LOGICAL_H - h) / 2;
  const headH = 72;
  const r = 24;
  const pulse = 0.55 + 0.45 * Math.sin(now / 280);
  ctx.save();
  ctx.shadowColor = `rgba(255,210,60,${0.55 * pulse})`;
  ctx.shadowBlur = 36;
  ctx.lineWidth = 5;
  ctx.strokeStyle = `rgba(255,210,60,${0.95})`;
  roundRect(x - 3, y - 3, w + 6, h + 6, r + 3);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = "#f6faff";
  roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(x, y, w, h, r);
  ctx.clip();
  const hg = ctx.createLinearGradient(x, y, x, y + headH);
  hg.addColorStop(0, "#3b6fd4");
  hg.addColorStop(1, "#2a55ad");
  ctx.fillStyle = hg;
  ctx.fillRect(x, y, w, headH);
  ctx.fillStyle = "#f5c042";
  ctx.fillRect(x, y + headH, w, 4);
  ctx.restore();
  const iconCX = x + 38, iconCY = y + headH / 2;
  if (modal === "settings") {
    drawGearIcon(iconCX, iconCY, 18, "#ffe9a8");
  } else {
    drawTrophyIcon(iconCX, iconCY, 20, "#ffe082");
  }
  const title = modal === "settings" ? "\uC124\uC815" : "\uC810\uC218\uD310";
  drawText(title, x + 70, y + headH / 2 + 11, {
    font: '900 30px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff",
    align: "left",
    shadow: "rgba(0,0,0,.35)",
    shadowBlur: 6
  });
  const xBtnR = 18;
  const xBtnX = x + w - 28 - xBtnR;
  const xBtnY = y + headH / 2 - xBtnR;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.beginPath();
  ctx.arc(xBtnX + xBtnR, xBtnY + xBtnR, xBtnR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.9)";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  const cx = xBtnX + xBtnR, cy = xBtnY + xBtnR, d = 7;
  ctx.beginPath();
  ctx.moveTo(cx - d, cy - d);
  ctx.lineTo(cx + d, cy + d);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + d, cy - d);
  ctx.lineTo(cx - d, cy + d);
  ctx.stroke();
  ctx.restore();
  addBtn({
    x: xBtnX,
    y: xBtnY,
    w: xBtnR * 2,
    h: xBtnR * 2,
    label: "X",
    kind: "small",
    onClick: () => {
      modal = null;
    }
  });
  const bodyTop = y + headH + 18;
  if (modal === "settings") {
    drawSettingRow(x + 24, bodyTop, w - 48, 60, "sound", "\uD6A8\uACFC\uC74C", () => {
      const tgW = 76, tgH = 36;
      const tgX = x + w - 24 - tgW - 8;
      const tgY = bodyTop + (60 - tgH) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.18)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = soundOn ? "#2fbf55" : "#b8c0cf";
      roundRect(tgX, tgY, tgW, tgH, 18);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.25)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = "#fff";
      const knobX = tgX + (soundOn ? tgW - 18 : 18);
      ctx.beginPath();
      ctx.arc(knobX, tgY + tgH / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      addBtn({
        x: tgX,
        y: tgY,
        w: tgW,
        h: tgH,
        label: "soundToggle",
        kind: "small",
        onClick: () => {
          soundOn = !soundOn;
        }
      });
    });
    drawSettingRow(x + 24, bodyTop + 72, w - 48, 60, "rotate", "\uD68C\uC804 \uB2E8\uC704", () => {
      const rotInfo = diff === "HARD" ? "45\xB0" : "90\xB0";
      const subInfo = diff === "HARD" ? "HARD" : "EASY \xB7 NORMAL";
      const chipW = 110, chipH = 40;
      const chipX = x + w - 24 - chipW;
      const chipY = bodyTop + 72 + (60 - chipH) / 2;
      ctx.save();
      ctx.fillStyle = "#eaf1ff";
      roundRect(chipX, chipY, chipW, chipH, 14);
      ctx.fill();
      ctx.strokeStyle = "#c5d4ee";
      ctx.lineWidth = 1.5;
      roundRect(chipX, chipY, chipW, chipH, 14);
      ctx.stroke();
      ctx.restore();
      drawText(rotInfo, chipX + chipW / 2, chipY + chipH / 2 + 8, {
        font: '900 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: "#1f2d4a",
        align: "center"
      });
      drawText(subInfo, x + w - 24 - chipW - 12, bodyTop + 72 + 60 / 2 + 5, {
        font: '600 12px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub,
        align: "right"
      });
    });
  } else {
    const [a, b] = teamScores;
    appData.teams.forEach((tm, i) => {
      const ty = bodyTop + i * 78;
      const rx = x + 24, rw = w - 48, rh = 64;
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(20,40,80,.10)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      roundRect(rx, ty, rw, rh, 16);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#e3ebf7";
      ctx.lineWidth = 1.5;
      roundRect(rx, ty, rw, rh, 16);
      ctx.stroke();
      ctx.restore();
      const badgeR = 22;
      const badgeCX = rx + 24 + badgeR;
      const badgeCY = ty + rh / 2;
      ctx.save();
      ctx.fillStyle = tm.color;
      ctx.shadowColor = "rgba(0,0,0,.18)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(badgeCX, badgeCY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,.32)";
      ctx.beginPath();
      ctx.arc(badgeCX - 6, badgeCY - 7, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawText(tm.name, rx + 76, ty + rh / 2 + 8, {
        font: '900 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.ink,
        align: "left"
      });
      const score = i === 0 ? a : b;
      drawText("\uC810", rx + rw - 22, ty + rh / 2 + 8, {
        font: 'bold 16px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub,
        align: "right"
      });
      drawText(String(score), rx + rw - 22 - 22, ty + rh / 2 + 10, {
        font: '900 30px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: tm.color,
        align: "right"
      });
    });
    if (a === 0 && b === 0) {
      drawText("\uC544\uC9C1 \uC9C4\uD589\uD55C \uC2A4\uD14C\uC774\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.", x + w / 2, bodyTop + appData.teams.length * 78 + 20, {
        font: 'bold 13px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
        color: COLOR.inkSub,
        align: "center"
      });
    }
  }
  const bW = 180, bH = 56, bX = x + w / 2 - bW / 2, bY = y + h - bH - 22;
  ctx.save();
  ctx.fillStyle = "#a85a10";
  roundRect(bX, bY + 5, bW, bH, 999);
  ctx.fill();
  ctx.restore();
  ctx.save();
  const bg = ctx.createLinearGradient(bX, bY, bX, bY + bH);
  bg.addColorStop(0, "#ffb84a");
  bg.addColorStop(1, "#f08a1c");
  ctx.fillStyle = bg;
  roundRect(bX, bY, bW, bH, 999);
  ctx.fill();
  const gloss = ctx.createLinearGradient(bX, bY + 4, bX, bY + bH * 0.55);
  gloss.addColorStop(0, "rgba(255,255,255,.55)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  roundRect(bX + 6, bY + 4, bW - 12, bH * 0.55, 999);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,55,0,.65)";
  ctx.lineWidth = 2.5;
  roundRect(bX, bY, bW, bH, 999);
  ctx.stroke();
  ctx.restore();
  drawText("\uB2EB\uAE30", bX + bW / 2, bY + bH / 2 + 10, {
    font: '900 24px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff",
    align: "center",
    shadow: "rgba(120,55,0,.6)",
    shadowBlur: 4
  });
  addBtn({
    x: bX,
    y: bY,
    w: bW,
    h: bH,
    label: "\uB2EB\uAE30",
    kind: "primary",
    onClick: () => {
      modal = null;
    }
  });
}
function drawSettingRow(x, y, w, h, icon, label, drawRight) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(20,40,80,.08)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "#e3ebf7";
  ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 16);
  ctx.stroke();
  ctx.restore();
  const iconCX = x + 28, iconCY = y + h / 2;
  if (icon === "sound") drawSoundIcon(iconCX, iconCY, 14, "#3b6fd4");
  else drawRotateArrowIcon(iconCX, iconCY, 14, "#3b6fd4");
  drawText(label, x + 56, y + h / 2 + 7, {
    font: 'bold 19px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: COLOR.ink,
    align: "left"
  });
  drawRight();
}
function drawGearIcon(cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  const teeth = 8;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = i / (teeth * 2) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.78;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(40,80,170,.85)";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawTrophyIcon(cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy - r * 0.8);
  ctx.lineTo(cx + r * 0.7, cy - r * 0.8);
  ctx.lineTo(cx + r * 0.55, cy + r * 0.3);
  ctx.quadraticCurveTo(cx, cy + r * 0.6, cx - r * 0.55, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = r * 0.18;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx - r * 0.7, cy - r * 0.3, r * 0.35, Math.PI * 0.5, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + r * 0.7, cy - r * 0.3, r * 0.35, -Math.PI * 0.5, Math.PI * 0.5);
  ctx.stroke();
  ctx.fillRect(cx - r * 0.4, cy + r * 0.55, r * 0.8, r * 0.18);
  ctx.fillRect(cx - r * 0.6, cy + r * 0.72, r * 1.2, r * 0.22);
  ctx.restore();
}
function drawSoundIcon(cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(cx - r * 0.9, cy - r * 0.35, r * 0.5, r * 0.7);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.4, cy - r * 0.35);
  ctx.lineTo(cx + r * 0.1, cy - r * 0.85);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.85);
  ctx.lineTo(cx - r * 0.4, cy + r * 0.35);
  ctx.closePath();
  ctx.fill();
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
function drawRotateArrowIcon(cx, cy, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.28;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, -Math.PI * 0.85, Math.PI * 0.45);
  ctx.stroke();
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
function drawTitleScreenFallback(now) {
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
  roundRect(cx - 320, 232, 640, 50, 25);
  ctx.fill();
  drawText(textData.tagline, cx, 266, {
    font: 'bold 22px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
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
    font: '900 34px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff",
    align: "center"
  });
  ctx.fillStyle = "rgba(0,0,0,.22)";
  roundRect(x + w / 2 - 38, y + (isSel ? -4 : 0) + 64, 76, 26, 13);
  ctx.fill();
  drawText(d.sub, x + w / 2, y + (isSel ? -4 : 0) + 83, {
    font: 'bold 16px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
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
    font: '900 38px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
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
  drawCombo(now);
  drawFooter();
  if (screen === "intro") drawBanner(textData.stageStart);
  if (screen === "result") drawResultCard();
}
function drawCombo(now) {
  if (comboRings.length === 0 && comboParticles.length === 0 && comboPopups.length === 0) return;
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
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
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
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeText(text, pp.x, pp.y + yOff);
    ctx.fillStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.fillText(text, pp.x, pp.y + yOff);
    ctx.restore();
  }
}
var FF = '"GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
function drawHud() {
  if (!stageP) return;
  const bg = ctx.createLinearGradient(0, 0, 0, HUD_H);
  bg.addColorStop(0, "rgba(18,30,56,.92)");
  bg.addColorStop(1, "rgba(12,22,44,.78)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LOGICAL_W, HUD_H);
  ctx.fillStyle = "rgba(120,170,255,.45)";
  ctx.fillRect(0, HUD_H - 3, LOGICAL_W, 3);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.4)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  const rg = ctx.createLinearGradient(0, 6, 0, 70);
  rg.addColorStop(0, "#ffd24a");
  rg.addColorStop(1, "#f0a92b");
  ctx.fillStyle = rg;
  roundRect(18, 7, 108, 62, 18);
  ctx.fill();
  ctx.restore();
  drawText(`${stageP.round}R`, 72, 55, { font: `900 50px ${FF}`, color: "#3a2400", align: "center" });
  drawText(`STAGE ${stageP.round}-${stageP.stageInRound}`, 140, 46, {
    font: `bold 24px ${FF}`,
    color: "#fff"
  });
  const team = appData.teams[stageP.team];
  const t = currentTimerSec();
  const tagW = 340, tagH = 56;
  const tagX = LOGICAL_W / 2 - tagW / 2;
  ctx.save();
  ctx.shadowColor = team.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = team.color;
  roundRect(tagX, 9, tagW, tagH, 28);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(tagX + 34, 37, 11, 0, Math.PI * 2);
  ctx.fill();
  drawText(team.name + textData.turnSuffix, LOGICAL_W / 2 + 18, 50, {
    font: `900 38px ${FF}`,
    color: "#fff",
    align: "center"
  });
  if (t >= 0) {
    let color = "#fff";
    if (screen === "manipulate") {
      if (t <= 5) color = "#ff5b4d";
      else if (t <= 10) color = COLOR.yellow;
    }
    drawText(String(t).padStart(2, "0"), tagX + tagW + 22, 50, {
      font: `900 32px ${FF}`,
      color,
      align: "left"
    });
  }
  const sW = 104, sH = 56, sGap = 10;
  const x0 = LOGICAL_W - (sW * 2 + sGap) - 20;
  for (let i = 0; i < 2; i++) {
    const sx = x0 + i * (sW + sGap);
    const sy = 8;
    const active = stageP.team === i;
    ctx.save();
    if (active) {
      ctx.shadowColor = appData.teams[i].color;
      ctx.shadowBlur = 16;
    }
    const g = ctx.createLinearGradient(sx, sy, sx, sy + sH);
    g.addColorStop(0, appData.teams[i].color);
    g.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.fillStyle = g;
    roundRect(sx, sy, sW, sH, 16);
    ctx.fill();
    ctx.restore();
    if (active) {
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "#fff";
      roundRect(sx, sy, sW, sH, 16);
      ctx.stroke();
    }
    drawText(appData.teams[i].name, sx + sW / 2, sy + 22, {
      font: `bold 18px ${FF}`,
      color: "rgba(255,255,255,.95)",
      align: "center"
    });
    drawText(String(teamScores[i]), sx + sW / 2, sy + 50, {
      font: `900 32px ${FF}`,
      color: "#fff",
      align: "center"
    });
  }
}
function currentTimerSec() {
  if (devMode) return -1;
  if (!stage || !stageP) return -1;
  const el = (lastFrameMs - phaseStartMs) / 1e3;
  if (screen === "predict") return Math.max(0, Math.ceil(stage.predict - el));
  if (screen === "manipulate") return Math.max(0, Math.ceil(stage.time - el));
  return -1;
}
function drawBoard(now) {
  if (!stage) return;
  const boardImg = titleImgs[boardKeyFor(diff)];
  const useImg = !!(boardImg && boardImg.complete && boardImg.naturalWidth > 0);
  if (useImg) {
    ctx.save();
    ctx.drawImage(boardImg, boardImgX, boardImgY, boardImgW, boardImgH);
    ctx.restore();
  } else {
    ctx.save();
    fillVerticalGradient(boardX, boardY, boardW, boardH, COLOR.gridTop, COLOR.gridBot);
    ctx.restore();
    ctx.strokeStyle = COLOR.gridLine;
    ctx.lineWidth = 1;
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
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR.gridEdge;
    roundRect(boardX + 1.5, boardY + 1.5, boardW - 3, boardH - 3, 12);
    ctx.stroke();
  }
  stage.forbidden.forEach((f) => drawForbidden(f, now));
  stage.walls.forEach((w) => drawWall(w));
  stage.movers.forEach((mv) => drawMover(mv));
  drawTarget(stage.target, now);
  drawEmitter(stage.emitter, now);
  stage.mirrors.forEach((m) => drawMirror(m, now));
  if (beam && (screen === "fire" || screen === "result")) drawBeam(now);
  if (gridCalibMode) drawGridCalibOverlay();
}
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
  const line1 = `\uACA9\uC790\uBCF4\uC815 [${diff}]  \u2190\u2191\u2193\u2192 \uC774\uB3D9(Shift\xD75)  [ ] \uCE78\uD06C\uAE30  , . \uC5F4  ; ' \uD589  \xB7  \uBAA8\uC11C\uB9AC\uB298\uB9AC\uAE30  A/D \uC88C  J/L \uC6B0  W/X \uC0C1  I/K \uD558  \xB7  S \uC800\uC7A5  Shift+S \uD30C\uC77C\uB0B4\uBCF4\uB0B4\uAE30  R \uB9AC\uC14B  G \uB044\uAE30`;
  const line2 = `${stage.cols}\xD7${stage.rows}\uCE78  cellW=${cellW.toFixed(1)} cellH=${cellH.toFixed(1)}  dx=${cal.dx} dy=${cal.dy} dc=${cal.dc}  L=${cal.dl || 0} R=${cal.dr || 0} T=${cal.dt || 0} B=${cal.db || 0}`;
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
function drawForbidden(f, now) {
  const x = cellX(f.c), y = cellY(f.r);
  const pulse = 0.5 + 0.5 * Math.sin(now / 240);
  ctx.save();
  roundRect(x + 3, y + 3, cellW - 6, cellH - 6, 8);
  ctx.clip();
  ctx.fillStyle = `rgba(224,71,61,${0.32 + pulse * 0.22})`;
  ctx.fillRect(x, y, cellW, cellH);
  ctx.strokeStyle = "rgba(150,20,15,.55)";
  ctx.lineWidth = 6;
  for (let i = -cellH; i < cellW; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + cellH);
    ctx.lineTo(x + i + cellH, y);
    ctx.stroke();
  }
  ctx.restore();
  drawText("\u2715", x + cellW / 2, y + cellH / 2 + boardCell * 0.13, {
    font: `bold ${Math.round(boardCell * 0.42)}px sans-serif`,
    color: "#fff",
    align: "center"
  });
}
function drawWall(w) {
  const img = ((w.c + w.r) % 2 === 0 ? titleImgs.stone : titleImgs.stone_small) || titleImgs.stone;
  const over = 1.16;
  const w2 = cellW * over, h2 = cellH * over;
  const ccx = cellX(w.c) + cellW / 2, ccy = cellY(w.r) + cellH / 2;
  const x = cellX(w.c), y = cellY(w.r);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, ccx - w2 / 2, ccy - h2 / 2, w2, h2);
  } else {
    const p = boardCell * 0.1;
    const g = ctx.createLinearGradient(x, y, x, y + cellH);
    g.addColorStop(0, "#8a93a6");
    g.addColorStop(1, "#5d6678");
    ctx.fillStyle = g;
    roundRect(x + p, y + p, cellW - p * 2, cellH - p * 2, 9);
    ctx.fill();
    ctx.strokeStyle = "#454c5c";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
function drawMover(mv) {
  const tf = mv.t;
  const i0 = Math.floor(tf);
  const i1 = Math.min(mv.track.length - 1, i0 + 1);
  const f = tf - i0;
  const a = mv.track[i0];
  const b = mv.track[i1];
  const x = boardX + (a.c * (1 - f) + b.c * f + 0.5) * cellW;
  const y = boardY + (a.r * (1 - f) + b.r * f + 0.5) * cellH;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(120,60,60,.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < mv.track.length; i++) {
    const cc = boardX + (mv.track[i].c + 0.5) * cellW;
    const rr = boardY + (mv.track[i].r + 0.5) * cellH;
    if (i === 0) ctx.moveTo(cc, rr);
    else ctx.lineTo(cc, rr);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  const img = titleImgs.mover;
  const size = boardCell * 0.82;
  const vx = (b.c - a.c) * mv.dir;
  const vy = (b.r - a.r) * mv.dir;
  const ang = vx !== 0 || vy !== 0 ? Math.atan2(vy, vx) + Math.PI / 2 : 0;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 10;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  } else {
    const R = boardCell * 0.34;
    const g = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.2, x, y, R);
    g.addColorStop(0, "#f6837a");
    g.addColorStop(1, "#9c2a23");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
var targetHitMix = 0;
var targetHitLastNow = 0;
var TARGET_CORE = {
  normal: { cx: 0.47, cy: 0.37, r: 0.205 },
  hit: { cx: 0.5, cy: 0.43, r: 0.185 }
};
var TARGET_LIFT = 0.16;
function drawTargetSprite(img, core, cx, cy, screenR, flip) {
  const scale = screenR / (core.r * img.naturalWidth);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const ox = core.cx * w, oy = core.cy * h;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -ox, -oy, w, h);
  ctx.restore();
}
function drawTarget(t, now) {
  const { x, y: cellMidY } = cellCenter(t.c, t.r);
  const y = cellMidY - boardCell * TARGET_LIFT;
  const blink = 0.55 + 0.45 * Math.sin(now / 260);
  const isHit = !!(beam && (screen === "result" && (beam.result === "perfect" || beam.result === "partial") || screen === "fire" && beamProgress >= 0.95 && (beam.result === "perfect" || beam.result === "partial")));
  const dt = targetHitLastNow ? Math.min(100, now - targetHitLastNow) : 16;
  targetHitLastNow = now;
  const step = dt / 220;
  const aim = isHit ? 1 : 0;
  if (targetHitMix < aim) targetHitMix = Math.min(aim, targetHitMix + step);
  else if (targetHitMix > aim) targetHitMix = Math.max(aim, targetHitMix - step);
  const mix = targetHitMix;
  const imgNormal = titleImgs.target;
  const imgHit = titleImgs.target_hit;
  const lastMirror = stage && stage.mirrors.length ? stage.mirrors[stage.mirrors.length - 1] : null;
  const flip = !!(lastMirror && lastMirror.c < t.c);
  const screenR = boardCell * 0.3;
  const ready = (im) => !!(im && im.complete && im.naturalWidth > 0);
  if (ready(imgNormal) || ready(imgHit)) {
    const pulseFast = 0.6 + 0.4 * Math.sin(now / 90);
    const gR = Math.round(255);
    const gG = Math.round(200 + (60 - 200) * mix);
    const gB = Math.round(80 + (40 - 80) * mix);
    const glowA = blink * (1 - mix) + pulseFast * mix;
    const glowBlur = 22 * blink * (1 - mix) + 40 * pulseFast * mix;
    ctx.save();
    ctx.shadowColor = `rgba(${gR},${gG},${gB},${glowA})`;
    ctx.shadowBlur = glowBlur;
    if (ready(imgNormal) && mix < 1) {
      ctx.globalAlpha = 1 - mix;
      drawTargetSprite(imgNormal, TARGET_CORE.normal, x, y, screenR, flip);
    }
    if (ready(imgHit) && mix > 0) {
      ctx.globalAlpha = mix;
      drawTargetSprite(imgHit, TARGET_CORE.hit, x, y, screenR, flip);
    }
    ctx.restore();
    if (mix > 0.01) {
      ctx.save();
      ctx.globalAlpha = mix;
      const rayLen = boardCell * (0.6 + 0.3 * Math.sin(now / 70));
      ctx.lineCap = "round";
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const ang = i / 8 * Math.PI * 2 + now / 800;
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
}
var EMITTER_IMG_ANGLE = Math.PI / 2;
function emitterAimAngle(e) {
  const card = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };
  if (stage) {
    const d = DELTA[e.dir];
    let c = e.c + d[0], r = e.r + d[1];
    while (c >= 0 && r >= 0 && c < stage.cols && r < stage.rows) {
      if (stage.mirrors.some((m) => m.c === c && m.r === r)) {
        const src = cellCenter(e.c, e.r), dst = cellCenter(c, r);
        return Math.atan2(dst.y - src.y, dst.x - src.x);
      }
      c += d[0];
      r += d[1];
    }
  }
  return card[e.dir];
}
function drawEmitter(e, now) {
  const cc = cellCenter(e.c, e.r);
  const glow = 0.6 + 0.4 * Math.sin(now / 200);
  const img = titleImgs.emitter_game || titleImgs.emitter;
  const size = boardCell * 1.08;
  const aim = emitterAimAngle(e);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(cc.x, cc.y);
    ctx.rotate(aim - EMITTER_IMG_ANGLE);
    ctx.shadowColor = `rgba(255,90,60,${glow})`;
    ctx.shadowBlur = 24 * glow;
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    const x = cellX(e.c), y = cellY(e.r), p = boardCell * 0.12;
    const g = ctx.createLinearGradient(x, y, x, y + cellH);
    g.addColorStop(0, "#4b5670");
    g.addColorStop(1, "#2b3247");
    ctx.fillStyle = g;
    roundRect(x + p, y + p, cellW - p * 2, cellH - p * 2, 9);
    ctx.fill();
    ctx.strokeStyle = "#1c2233";
    ctx.lineWidth = 3;
    ctx.stroke();
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
}
function drawMirror(m, now) {
  const { x: cx, y: cy } = cellCenter(m.c, m.r);
  const selectable = screen === "manipulate";
  const isSel = selectedMirror === m.id;
  const isAxis = m.ori === "|" || m.ori === "-";
  const inDir = solInDir[m.id];
  const r = inDir != null ? faceForBeam(m.ori, inDir) : { back: false, flip: m.ori === "\\" };
  const front = titleImgs.mirror_front || titleImgs.mirror_game || titleImgs.mirror;
  const img = isAxis ? front : (r.back ? titleImgs.mirror_back || front : front) || titleImgs.mirror;
  const flip = r.flip;
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
  const size = boardCell * 0.98;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(cx, cy);
    if (isAxis) ctx.rotate(oriToAngle45(m.ori));
    else if (flip) ctx.scale(-1, 1);
    if (isSel) {
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = 18;
    }
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    const x = cx - boardCell / 2, y = cy - boardCell / 2, pad = boardCell * 0.14;
    const m1 = boardCell * 0.22, m2 = boardCell - m1;
    const g = ctx.createLinearGradient(x, y, x, y + boardCell);
    g.addColorStop(0, "#f4f8ff");
    g.addColorStop(1, "#c9d7ee");
    ctx.fillStyle = g;
    roundRect(x + pad, y + pad, boardCell - pad * 2, boardCell - pad * 2, 9);
    ctx.fill();
    ctx.lineCap = "round";
    ctx.lineWidth = boardCell * 0.16;
    const mg = ctx.createLinearGradient(x, y, x + boardCell, y + boardCell);
    mg.addColorStop(0, "#bfe6ff");
    mg.addColorStop(0.5, "#5fa8e8");
    mg.addColorStop(1, "#2f6fc0");
    ctx.strokeStyle = mg;
    ctx.beginPath();
    if (m.ori.charAt(0) === "/") {
      ctx.moveTo(x + m1, y + m2);
      ctx.lineTo(x + m2, y + m1);
    } else {
      ctx.moveTo(x + m1, y + m1);
      ctx.lineTo(x + m2, y + m2);
    }
    ctx.stroke();
  }
  if (selectable) {
    const p = boardCell * 0.14;
    const x = cellX(m.c);
    const y = cellY(m.r);
    drawRotateIcon(x + cellW - p, y + p, boardCell * 0.16, now);
  }
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
  const src = beamCells.length ? beamCells : beam.points;
  const srcPts = beamCutIndex >= 0 ? src.slice(0, beamCutIndex + 1) : src;
  const pts = srcPts.map((p) => cellCenter(p.c, p.r));
  if (pts.length < 2) return;
  if (stage) {
    const d = DELTA[stage.emitter.dir];
    const len = Math.hypot(d[0], d[1]) || 1;
    pts[0] = { x: pts[0].x + d[0] / len * boardCell * 0.5, y: pts[0].y + d[1] / len * boardCell * 0.5 };
  }
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
  ctx.shadowBlur = 30;
  ctx.strokeStyle = "rgba(255,140,60,.32)";
  ctx.lineWidth = boardCell * 0.35;
  drawPoly(line);
  ctx.shadowBlur = 22;
  ctx.strokeStyle = COLOR.beamGlow;
  ctx.lineWidth = boardCell * 0.22;
  drawPoly(line);
  ctx.shadowBlur = 14;
  ctx.strokeStyle = col;
  ctx.lineWidth = boardCell * 0.11;
  drawPoly(line);
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 8;
  ctx.strokeStyle = COLOR.beamCore;
  ctx.lineWidth = boardCell * 0.045;
  drawPoly(line);
  if (beamProgress < 1) {
    ctx.shadowColor = col;
    ctx.shadowBlur = 34;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(head.x, head.y, boardCell * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const rg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, boardCell * 0.45);
    rg.addColorStop(0, "rgba(255,230,170,.55)");
    rg.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(head.x, head.y, boardCell * 0.45, 0, Math.PI * 2);
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
  if (hint && !devMode) {
    ctx.save();
    ctx.fillStyle = "rgba(15,28,51,.5)";
    const tw = ctx.measureText(hint).width;
    ctx.font = 'bold 18px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';
    const padX = 22;
    const w = Math.min(LOGICAL_W - 360, ctx.measureText(hint).width + padX * 2);
    const h = 40;
    const x = (LOGICAL_W - 320 - w) / 2;
    roundRect(x, y0 + 10, w, h, 999);
    ctx.fill();
    drawText(hint, x + w / 2, y0 + 38, {
      font: 'bold 18px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
      color: "#fff",
      align: "center"
    });
    ctx.restore();
  }
  const bW = 300, bH = 76, bX = LOGICAL_W - bW - 36, bY = y0 + 2;
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
  drawText(textData.doneBtn, bX + bW / 2, bY + bH / 2 + 13, {
    font: `900 38px ${FF}`,
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
  if (devMode) {
    const dy = y0 + 14;
    drawEditChipButton(
      "\u{1F3E0} \uD648",
      28,
      dy,
      92,
      48,
      "#444b63",
      () => {
        Sfx.click();
        screen = "title";
      }
    );
    drawEditChipButton(
      "\uB2E4\uC74C \u25B6",
      128,
      dy,
      104,
      48,
      "#2a5b9c",
      () => {
        Sfx.click();
        nextStage();
      }
    );
    if (screen === "predict" || screen === "manipulate")
      drawEditChipButton(
        "\u{1F534} \uBC1C\uC0AC",
        240,
        dy,
        104,
        48,
        "#b3402f",
        () => {
          Sfx.click();
          fireLaser(lastFrameMs);
        }
      );
  }
}
function drawBanner(text) {
  const el = (lastFrameMs - phaseStartMs) / 1e3;
  const a = Math.min(1, Math.max(0, 1 - Math.abs(el - 0.7) / 1));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(8,16,32,.45)";
  ctx.fillRect(0, LOGICAL_H / 2 - 90, LOGICAL_W, 180);
  drawText(text, LOGICAL_W / 2, LOGICAL_H / 2 + 24, {
    font: '900 88px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
    color: "#fff",
    align: "center",
    shadow: "rgba(0,0,0,.5)",
    shadowBlur: 24
  });
  if (stageP) {
    const team = appData.teams[stageP.team];
    drawText(`${stageP.round}${textData.roundLabel} \xB7 ${team.name}`, LOGICAL_W / 2, LOGICAL_H / 2 + 70, {
      font: 'bold 28px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
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
  const cardW = 660, cardH = 540;
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
  drawText(icon, cx, y + 122, {
    font: '108px "Apple Color Emoji","Segoe UI Emoji",sans-serif',
    color: "#000",
    align: "center"
  });
  drawText(title, cx, y + 212, {
    font: `900 58px ${FF}`,
    color: COLOR.ink,
    align: "center"
  });
  drawText(desc, cx, y + 262, {
    font: `bold 25px ${FF}`,
    color: COLOR.inkSub,
    align: "center"
  });
  const ptsColor = resultPoints > 0 ? COLOR.team0 : "#98a2b8";
  drawText("+" + resultPoints, cx, y + 360, {
    font: `900 90px ${FF}`,
    color: ptsColor,
    align: "center"
  });
  const showBonus = beam.result !== "fail" && comboBonus > 0;
  if (showBonus) {
    const base = resultPoints - comboBonus;
    const detail = `\uAE30\uBCF8 ${base}  +  \uCF64\uBCF4 \uBCF4\uB108\uC2A4 ${comboBonus}  (\uCD5C\uB300 x${comboMax})`;
    drawText(detail, cx, y + 410, {
      font: `bold 22px ${FF}`,
      color: COLOR.inkSub,
      align: "center"
    });
  } else if (comboMax >= 2) {
    drawText(`\uCD5C\uB300 \uCF64\uBCF4 x${comboMax}`, cx, y + 410, {
      font: `bold 22px ${FF}`,
      color: COLOR.inkSub,
      align: "center"
    });
  }
  const bW = 320, bH = 78, bX = cx - bW / 2, bY = y + cardH - bH - 30;
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
  drawText(label, bX + bW / 2, bY + bH / 2 + 13, {
    font: `900 36px ${FF}`,
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
  drawText(textData.gameOver, LOGICAL_W / 2, 158, {
    font: `900 84px ${FF}`,
    color: "#fff",
    align: "center",
    shadow: "rgba(0,0,0,.45)",
    shadowBlur: 16
  });
  const [a, b] = teamScores;
  let winText = textData.draw;
  if (a > b) winText = appData.teams[0].name + textData.winSuffix;
  else if (b > a) winText = appData.teams[1].name + textData.winSuffix;
  drawText(winText, LOGICAL_W / 2, 238, {
    font: `900 60px ${FF}`,
    color: COLOR.yellow,
    align: "center",
    shadow: "rgba(0,0,0,.4)",
    shadowBlur: 12
  });
  const bW = 240, bH = 220, gap = 60, totalW = bW * 2 + gap + 80;
  const startX = (LOGICAL_W - totalW) / 2;
  drawFinalTeamBox(startX, 320, bW, bH, 0, a >= b);
  drawText("VS", startX + bW + gap / 2 + 28, 320 + bH / 2 + 18, {
    font: `900 64px ${FF}`,
    color: "rgba(255,255,255,.85)",
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
  drawText(appData.teams[teamId].name, x + w / 2, y + 60, {
    font: `900 40px ${FF}`,
    color: "#fff",
    align: "center"
  });
  drawText(String(teamScores[teamId]), x + w / 2, y + 150, {
    font: '900 72px "GmarketSans", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif',
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
  {
    const saved = stage.mirrors.map((m) => m.ori);
    stage.mirrors.forEach((m) => m.ori = m.sol);
    solInDir = traceLaser(stage, /* @__PURE__ */ new Set()).inDir;
    stage.mirrors.forEach((m, i) => m.ori = saved[i]);
  }
  computeBoardLayout();
  mirrorAnim.clear();
  beam = null;
  beamProgress = 0;
  resultShown = false;
  resultPoints = 0;
  beamCutIndex = -1;
  beamMoverCheckedIdx = 0;
  beamCellArrival = [];
  beamCells = [];
  targetHitMix = 0;
  targetHitLastNow = 0;
  bounceScheduled.forEach((t) => clearTimeout(t));
  bounceScheduled = [];
  comboScheduled.forEach((t) => clearTimeout(t));
  comboScheduled = [];
  comboCount = 0;
  comboMax = 0;
  comboBonus = 0;
  comboPopups = [];
  comboParticles = [];
  comboRings = [];
  setScreen("intro", now);
}
function regenStageForCalib() {
  if (!stage) return;
  stageP = stageParams(diff, stageIndex);
  stage = generateStage(stageP);
  mirrorAnim.clear();
  beam = null;
  beamProgress = 0;
  resultShown = false;
  beamCutIndex = -1;
  beamMoverCheckedIdx = 0;
  beamCellArrival = [];
  beamCells = [];
  bounceScheduled.forEach((t) => clearTimeout(t));
  bounceScheduled = [];
  comboScheduled.forEach((t) => clearTimeout(t));
  comboScheduled = [];
  comboCount = 0;
  comboMax = 0;
  comboBonus = 0;
  comboPopups = [];
  comboParticles = [];
  comboRings = [];
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
  beam = traceLaser(stage, /* @__PURE__ */ new Set());
  beamProgress = 0;
  beamStartMs = now;
  beamCells = [];
  {
    const pts = beam.points;
    if (pts.length) beamCells.push(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const from = pts[i - 1], to = pts[i];
      const sc = Math.sign(to.c - from.c), sr = Math.sign(to.r - from.r);
      let cc = from.c, rr = from.r, guard = 0;
      while ((cc !== to.c || rr !== to.r) && guard++ < 300) {
        cc += sc;
        rr += sr;
        beamCells.push({ c: cc, r: rr });
      }
    }
  }
  const n = Math.max(1, beamCells.length - 1);
  beamCellArrival = beamCells.map((_, i) => i / n);
  beamDuration = Math.min(2400, Math.max(520, beamCells.length * 62));
  beamMoverCheckedIdx = 0;
  beamCutIndex = -1;
  Sfx.fire();
  comboCount = 0;
  comboMax = 0;
  comboBonus = 0;
  comboPopups = [];
  comboParticles = [];
  comboRings = [];
  comboScheduled.forEach((t) => clearTimeout(t));
  comboScheduled = [];
  const mirrorByCell = /* @__PURE__ */ new Map();
  stage.mirrors.forEach((m) => mirrorByCell.set(key(m.c, m.r), m));
  const reflectedSet = beam.hitMirrors;
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
function triggerCombo(cell, now) {
  comboCount++;
  if (comboCount > comboMax) comboMax = comboCount;
  comboBonus += comboBonusFor(comboCount);
  const { x, y } = cellCenter(cell.c, cell.r);
  const col = comboColor(comboCount);
  if (comboCount >= 2) {
    comboPopups.push({ x, y, count: comboCount, bornMs: now, life: 900 });
  }
  comboRings.push({ x, y, bornMs: now, life: 520, color: col, maxR: boardCell * 0.7 });
  const n = 10 + Math.min(comboCount * 2, 14);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + Math.random() * 0.3;
    const sp = 80 + Math.random() * 140 + comboCount * 12;
    comboParticles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      bornMs: now,
      life: 520 + Math.random() * 280,
      color: col,
      size: 2 + Math.random() * 2.5
    });
  }
  Sfx.bounce(1 + (comboCount - 1) * 0.12);
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
  const bonus = beam.result === "fail" ? 0 : comboBonus;
  resultPoints = pts + bonus;
  teamScores[stageP.team] += resultPoints;
}
function update(now) {
  lastFrameMs = now;
  const dt = (now - update._last || 0) / 1e3;
  update._last = now;
  if ((screen === "manipulate" || screen === "fire" || screen === "result") && stage) {
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
    if (now - phaseStartMs > 1900) setScreen(devMode ? "manipulate" : "predict", now);
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
    if (!devMode && rem <= 0) fireLaser(now);
  } else if (screen === "fire") {
    beamProgress = Math.min(1, (now - beamStartMs) / beamDuration);
    if (beam && beamCutIndex < 0 && stage && stage.movers.length) {
      const moverNow = /* @__PURE__ */ new Set();
      stage.movers.forEach((mv) => {
        const c = mv.track[Math.round(mv.t)];
        moverNow.add(c.c + "," + c.r);
      });
      let front = 0;
      while (front + 1 < beamCells.length && beamCellArrival[front + 1] <= beamProgress) front++;
      for (let i = 1; i <= front; i++) {
        const p = beamCells[i];
        if (moverNow.has(p.c + "," + p.r)) {
          beamCutIndex = i;
          beam.result = "fail";
          beam.reason = "block";
          comboScheduled.forEach((t) => clearTimeout(t));
          comboScheduled = [];
          bounceScheduled.forEach((t) => clearTimeout(t));
          bounceScheduled = [];
          Sfx.fail();
          break;
        }
      }
    }
    if (!resultShown && now - beamStartMs >= beamDuration + 600) showResult();
  }
  if (comboParticles.length > 0) {
    for (const p of comboParticles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
    }
    comboParticles = comboParticles.filter((p) => now - p.bornMs < p.life);
  }
  if (comboPopups.length > 0) {
    comboPopups = comboPopups.filter((p) => now - p.bornMs < p.life);
  }
  if (comboRings.length > 0) {
    comboRings = comboRings.filter((r) => now - r.bornMs < r.life);
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
  if (editMode && screen === "title") {
    const ctrl = hitButton(pos.x, pos.y);
    if (ctrl) {
      pressedBtn = ctrl;
      ctrl.onClick();
      return;
    }
    if (editSelected !== null) {
      const sel = titleLayout[editSelected];
      if (hitRotationHandle(sel, pos.x, pos.y)) {
        const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
        editRotating = true;
        editRotateStart = { rot: sel.rot || 0, mouseAngle: Math.atan2(pos.y - cy, pos.x - cx) };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {
        }
        return;
      }
      const k = hitHandle(sel, pos.x, pos.y);
      if (k) {
        editResizing = k;
        editResizeStart = {
          x: sel.x,
          y: sel.y,
          w: sel.w,
          h: sel.h,
          rot: sel.rot || 0,
          mx: pos.x,
          my: pos.y,
          shift: e.shiftKey
        };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {
        }
        return;
      }
    }
    const hits = titleLayout.map((it, i) => ({ i, area: it.w * it.h, hit: pointInItem(pos.x, pos.y, it) && !it.cover })).filter((a) => a.hit).sort((a, b2) => a.area - b2.area);
    const hit = hits.length > 0 ? hits[0].i : null;
    editSelected = hit;
    if (hit !== null) {
      editDragging = true;
      editDragOffX = pos.x - titleLayout[hit].x;
      editDragOffY = pos.y - titleLayout[hit].y;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
      }
    }
    return;
  }
  const b = hitButton(pos.x, pos.y);
  if (b) {
    pressedBtn = b;
    b.onClick();
    return;
  }
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
function onPointerUp(e) {
  editDragging = false;
  editResizing = null;
  editResizeStart = null;
  editRotating = false;
  editRotateStart = null;
  if (e) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {
    }
  }
}
function pointInBtn(px, py, b) {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}
function pointInItem(px, py, it) {
  const rot = it.rot || 0;
  if (rot === 0) return pointInBtn(px, py, it);
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = px - cx, dy = py - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.h / 2;
}
function localToCanvas(it, lx, ly) {
  const rot = it.rot || 0;
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}
function handlePositions(it) {
  const halfW = it.w / 2, halfH = it.h / 2;
  const locals = [
    ["nw", -halfW, -halfH],
    ["n", 0, -halfH],
    ["ne", halfW, -halfH],
    ["e", halfW, 0],
    ["se", halfW, halfH],
    ["s", 0, halfH],
    ["sw", -halfW, halfH],
    ["w", -halfW, 0]
  ];
  return locals.map(([k, lx, ly]) => {
    const p = localToCanvas(it, lx, ly);
    return [k, p.x, p.y];
  });
}
function rotationHandlePos(it) {
  return localToCanvas(it, 0, -it.h / 2 - 36);
}
function hitHandle(it, px, py) {
  const r = 16;
  for (const [kind, hx, hy] of handlePositions(it)) {
    if (Math.abs(px - hx) <= r && Math.abs(py - hy) <= r) return kind;
  }
  return null;
}
function hitRotationHandle(it, px, py) {
  const p = rotationHandlePos(it);
  return Math.hypot(px - p.x, py - p.y) <= 16;
}
function cursorForHandle(k) {
  switch (k) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    default:
      return "";
  }
}
function onPointerMove(e) {
  const pos = AppHelper.getRelativeCoordinates(e.clientX, e.clientY, canvas);
  if (editMode && screen === "title") {
    if (editRotating && editSelected !== null && editRotateStart) {
      const it = titleLayout[editSelected];
      const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
      const angle = Math.atan2(pos.y - cy, pos.x - cx);
      let newRot = editRotateStart.rot + (angle - editRotateStart.mouseAngle);
      if (e.shiftKey) {
        const step = Math.PI / 12;
        newRot = Math.round(newRot / step) * step;
      }
      it.rot = newRot;
      canvas.style.cursor = "grabbing";
      return;
    }
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
      const halfW = st.w / 2, halfH = st.h / 2;
      const localK = { x: 0, y: 0 };
      if (k.includes("e")) localK.x = halfW;
      if (k.includes("w")) localK.x = -halfW;
      if (k.includes("s")) localK.y = halfH;
      if (k.includes("n")) localK.y = -halfH;
      const anchorLocal = { x: -localK.x, y: -localK.y };
      const anchorCanvas = {
        x: oldCx + anchorLocal.x * cos - anchorLocal.y * sin,
        y: oldCy + anchorLocal.x * sin + anchorLocal.y * cos
      };
      const cmx = pos.x - anchorCanvas.x;
      const cmy = pos.y - anchorCanvas.y;
      const newKx_full = cmx * cos + cmy * sin;
      const newKy_full = -cmx * sin + cmy * cos;
      const newKLocalX = newKx_full + anchorLocal.x;
      const newKLocalY = newKy_full + anchorLocal.y;
      let newW = st.w, newH = st.h;
      if (k.includes("e")) newW = Math.max(minSz, Math.round(2 * newKLocalX));
      if (k.includes("w")) newW = Math.max(minSz, Math.round(-2 * newKLocalX));
      if (k.includes("s")) newH = Math.max(minSz, Math.round(2 * newKLocalY));
      if (k.includes("n")) newH = Math.max(minSz, Math.round(-2 * newKLocalY));
      if (lockAspect) {
        const ratio = st.w / Math.max(1, st.h);
        const scale = Math.max(newW / st.w, newH / st.h);
        newW = Math.max(minSz, Math.round(st.w * scale));
        newH = Math.max(minSz, Math.round(newW / ratio));
      }
      const kSignX = k.includes("e") ? 1 : k.includes("w") ? -1 : 0;
      const kSignY = k.includes("s") ? 1 : k.includes("n") ? -1 : 0;
      const newKLocalFinal = { x: kSignX * newW / 2, y: kSignY * newH / 2 };
      const anchorLocalFinal = { x: -newKLocalFinal.x, y: -newKLocalFinal.y };
      const newCx = anchorCanvas.x - (anchorLocalFinal.x * cos - anchorLocalFinal.y * sin);
      const newCy = anchorCanvas.y - (anchorLocalFinal.x * sin + anchorLocalFinal.y * cos);
      it.w = newW;
      it.h = newH;
      it.x = Math.round(newCx - newW / 2);
      it.y = Math.round(newCy - newH / 2);
      canvas.style.cursor = cursorForHandle(k);
      return;
    }
    if (editDragging && editSelected !== null) {
      const it = titleLayout[editSelected];
      it.x = Math.round(pos.x - editDragOffX);
      it.y = Math.round(pos.y - editDragOffY);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (editSelected !== null) {
      const sel = titleLayout[editSelected];
      if (hitRotationHandle(sel, pos.x, pos.y)) {
        canvas.style.cursor = "crosshair";
        return;
      }
      const k = hitHandle(sel, pos.x, pos.y);
      if (k) {
        canvas.style.cursor = cursorForHandle(k);
        return;
      }
      if (pointInItem(pos.x, pos.y, sel)) {
        canvas.style.cursor = "move";
        return;
      }
    }
    canvas.style.cursor = "default";
    return;
  }
  if (screen !== "title" || modal !== null) {
    if (titleHover !== null) titleHover = null;
    if (rotatableHoverId !== null) rotatableHoverId = null;
    canvas.style.cursor = "";
    return;
  }
  let next = null;
  let nextRot = null;
  for (const it of titleLayout) {
    if (it.interactive && pointInItem(pos.x, pos.y, it)) {
      next = it.interactive;
      break;
    }
  }
  if (!next) {
    for (const it of titleLayout) {
      if (it.clickRotates && pointInItem(pos.x, pos.y, it)) {
        nextRot = it.id;
        break;
      }
    }
  }
  if (next !== titleHover) titleHover = next;
  if (nextRot !== rotatableHoverId) rotatableHoverId = nextRot;
  canvas.style.cursor = next || nextRot ? "pointer" : "";
}
function onPointerLeave() {
  if (titleHover !== null) titleHover = null;
  canvas.style.cursor = "";
}
function onWheel(e) {
  if (!editMode || screen !== "title" || editSelected === null) return;
  e.preventDefault();
  const it = titleLayout[editSelected];
  const ay = Math.min(50, Math.abs(e.deltaY));
  const step = 3e-3 * ay;
  const factor = e.deltaY > 0 ? 1 - step : 1 + step;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  it.w = Math.max(8, Math.round(it.w * factor));
  it.h = Math.max(8, Math.round(it.h * factor));
  it.x = Math.round(cx - it.w / 2);
  it.y = Math.round(cy - it.h / 2);
}
function zSendToBack() {
  if (editSelected === null) return;
  const it = titleLayout.splice(editSelected, 1)[0];
  titleLayout.unshift(it);
  editSelected = 0;
  showEditToast("\uB9E8 \uB4A4\uB85C \uBCF4\uB0C4");
}
function zSendBackward() {
  if (editSelected === null || editSelected === 0) return;
  const t = titleLayout[editSelected - 1];
  titleLayout[editSelected - 1] = titleLayout[editSelected];
  titleLayout[editSelected] = t;
  editSelected -= 1;
  showEditToast("\uD55C \uCE78 \uB4A4\uB85C");
}
function zBringForward() {
  if (editSelected === null || editSelected >= titleLayout.length - 1) return;
  const t = titleLayout[editSelected + 1];
  titleLayout[editSelected + 1] = titleLayout[editSelected];
  titleLayout[editSelected] = t;
  editSelected += 1;
  showEditToast("\uD55C \uCE78 \uC55E\uC73C\uB85C");
}
function zBringToFront() {
  if (editSelected === null) return;
  const it = titleLayout.splice(editSelected, 1)[0];
  titleLayout.push(it);
  editSelected = titleLayout.length - 1;
  showEditToast("\uB9E8 \uC55E\uC73C\uB85C \uBCF4\uB0C4");
}
function toggleEditMode() {
  if (screen !== "title") return;
  editMode = !editMode;
  editSelected = null;
  editDragging = false;
  editResizing = null;
  canvas.style.cursor = "";
  if (editMode) {
    try {
      canvas.focus();
      window.focus();
    } catch (_) {
    }
  }
  showEditToast(editMode ? "\uC5D0\uB514\uD130 ON" : "\uC5D0\uB514\uD130 OFF");
}
function onKeyDown(e) {
  const code = e.code;
  if (code === "KeyE") {
    toggleEditMode();
    e.preventDefault();
    return;
  }
  if (screen !== "title") {
    if (code === "KeyG") {
      gridCalibMode = !gridCalibMode;
      if (stage) computeBoardLayout();
      e.preventDefault();
      return;
    }
    if (gridCalibMode && stage) {
      const cal = getCalib();
      const step2 = e.shiftKey ? 5 : 1;
      let handled = true;
      let regen = false;
      if (code === "ArrowLeft") cal.dx -= step2;
      else if (code === "ArrowRight") cal.dx += step2;
      else if (code === "ArrowUp") cal.dy -= step2;
      else if (code === "ArrowDown") cal.dy += step2;
      else if (code === "BracketLeft") cal.dc -= 1;
      else if (code === "BracketRight") cal.dc += 1;
      else if (code === "Comma") {
        cal.dcols = (cal.dcols || 0) - 1;
        regen = true;
      } else if (code === "Period") {
        cal.dcols = (cal.dcols || 0) + 1;
        regen = true;
      } else if (code === "Semicolon") {
        cal.drows = (cal.drows || 0) - 1;
        regen = true;
      } else if (code === "Quote") {
        cal.drows = (cal.drows || 0) + 1;
        regen = true;
      } else if (code === "KeyA") cal.dl = (cal.dl || 0) + step2;
      else if (code === "KeyD") cal.dl = (cal.dl || 0) - step2;
      else if (code === "KeyL") cal.dr = (cal.dr || 0) + step2;
      else if (code === "KeyJ") cal.dr = (cal.dr || 0) - step2;
      else if (code === "KeyW") cal.dt = (cal.dt || 0) + step2;
      else if (code === "KeyX") cal.dt = (cal.dt || 0) - step2;
      else if (code === "KeyK") cal.db = (cal.db || 0) + step2;
      else if (code === "KeyI") cal.db = (cal.db || 0) - step2;
      else if (code === "KeyS") {
        saveGridCalib();
        if (e.shiftKey) downloadGridCalibJSON();
      } else if (code === "KeyR") {
        cal.dx = 0;
        cal.dy = 0;
        cal.dc = 0;
        cal.dcols = 0;
        cal.drows = 0;
        cal.dl = 0;
        cal.dr = 0;
        cal.dt = 0;
        cal.db = 0;
        regen = true;
      } else handled = false;
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
    showEditToast(editSelected === null && !editMode ? "\uC5D0\uB514\uD130 OFF" : "\uC120\uD0DD \uD574\uC81C");
    e.preventDefault();
    return;
  }
  if (code === "KeyS") {
    e.preventDefault();
    downloadLayoutJSON();
    return;
  }
  if (code === "KeyR") {
    titleLayout = DEFAULT_TITLE_LAYOUT.map((x) => ({ ...x }));
    editSelected = null;
    showEditToast("\uAE30\uBCF8 \uB808\uC774\uC544\uC6C3\uC73C\uB85C \uB9AC\uC14B");
    e.preventDefault();
    return;
  }
  if (editSelected === null) return;
  const it = titleLayout[editSelected];
  const step = e.shiftKey ? 10 : 1;
  if (code === "ArrowLeft") {
    it.x -= step;
    e.preventDefault();
  }
  if (code === "ArrowRight") {
    it.x += step;
    e.preventDefault();
  }
  if (code === "ArrowUp") {
    it.y -= step;
    e.preventDefault();
  }
  if (code === "ArrowDown") {
    it.y += step;
    e.preventDefault();
  }
  if (code === "BracketLeft" || code === "BracketRight") {
    const f = code === "BracketLeft" ? 0.95 : 1.05;
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    it.w = Math.max(8, Math.round(it.w * f));
    it.h = Math.max(8, Math.round(it.h * f));
    it.x = Math.round(cx - it.w / 2);
    it.y = Math.round(cy - it.h / 2);
    e.preventDefault();
  }
  if (code === "KeyQ") {
    zSendBackward();
    e.preventDefault();
  }
  if (code === "KeyA") {
    zBringForward();
    e.preventDefault();
  }
  if (code === "KeyZ") {
    zSendToBack();
    e.preventDefault();
  }
  if (code === "KeyX") {
    zBringToFront();
    e.preventDefault();
  }
  if (code === "KeyO" || code === "KeyP") {
    const dir = code === "KeyO" ? -1 : 1;
    const step2 = (e.shiftKey ? 15 : 5) * Math.PI / 180;
    it.rot = (it.rot || 0) + dir * step2;
    e.preventDefault();
  }
  if (code === "KeyT") {
    it.rot = 0;
    showEditToast("\uD68C\uC804 0\xB0\uB85C \uB9AC\uC14B");
    e.preventDefault();
  }
  if (code === "KeyD") {
    const copy = {
      ...it,
      id: it.id + "_copy_" + Date.now().toString().slice(-4),
      x: it.x + 20,
      y: it.y + 20
    };
    titleLayout.splice(editSelected + 1, 0, copy);
    editSelected += 1;
    showEditToast("\uBCF5\uC81C: " + copy.id);
    e.preventDefault();
  }
  if (code === "Delete" || code === "Backspace") {
    const removed = titleLayout.splice(editSelected, 1)[0];
    editSelected = null;
    showEditToast("\uC0AD\uC81C: " + removed.id);
    e.preventDefault();
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
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown, true);
  try {
    if (document.fonts) {
      const f = document.fonts;
      await Promise.all([
        f.load('700 32px "GmarketSans"').catch(() => {
        }),
        f.load('500 16px "GmarketSans"').catch(() => {
        }),
        f.load('300 14px "GmarketSans"').catch(() => {
        }),
        f.load('bold 14px "Pretendard"').catch(() => {
        }),
        f.load('900 32px "Pretendard"').catch(() => {
        })
      ]);
      await f.ready;
    }
  } catch (_) {
  }
  loadTitleAssets();
  await loadTitleLayout();
  loadGridCalib();
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

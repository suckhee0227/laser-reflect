// import section

import { AppHelper } from "./appHelper";
import { Howl } from "howler";
import * as confetti from "canvas-confetti";

// declaration section

// Interface for stage data
interface IStageData {
  // Number of columns in the grid
  cols: number;
  // Number of rows in the grid
  rows: number;
  // Array of string representing the grid map
  grid: string[];
  // Initial count of mirrors available in inventory
  inventoryMirrors: number;
}

// Interface for application data
interface IAppData {
  // List of all stages
  stages: IStageData[];
}

// Interface for text data
interface ITextData {
  // Game title
  title: string;
  // Title for instructions
  instructionsTitle: string;
  // Array of instruction strings
  instructions: string[];
  // Start button text
  startBtn: string;
  // Play button text
  playBtn: string;
  // Stage clear message
  stageClear: string;
  // Next stage button text
  nextBtn: string;
  // All clear message
  allClear: string;
  // Restart button text
  restartBtn: string;
  // Label for inventory
  inventoryLabel: string;
}

// Interface for single sound asset
interface ISoundAsset {
  // Unique sound ID
  id: string;
  // File path
  file_path: string;
}

// Interface for asset list
interface IAssetList {
  // Array of sound assets
  sounds: ISoundAsset[];
}

// Point interface for coordinates
interface IPoint {
  // X coordinate
  x: number;
  // Y coordinate
  y: number;
}

// Game states enumeration
enum GameState {
  // Title screen
  TITLE,
  // Instructions screen
  INSTRUCTIONS,
  // Gameplay screen
  PLAYING,
  // Stage cleared screen
  STAGE_CLEAR,
  // Game completed screen
  ALL_CLEAR,
}

// Class representing a mirror object
class Mirror {
  // Grid column index (-1 if not on grid)
  c: number;

  // Grid row index (-1 if not on grid)
  r: number;

  // Pixel x coordinate for rendering
  px: number;

  // Pixel y coordinate for rendering
  py: number;

  // Mirror angle type (0 for '/', 1 for '\')
  type: number;

  // Constructor to initialize mirror
  constructor(c: number, r: number, px: number, py: number) {
    this.c = c;
    this.r = r;
    this.px = px;
    this.py = py;
    this.type = 0;
  }
}

// Logical canvas width
const LOGICAL_WIDTH = 800;

// Logical canvas height
const LOGICAL_HEIGHT = 600;

// Current state of the game
let gameState: GameState = GameState.TITLE;

// Index of the current stage
let currentStageIndex: number = 0;

// Application data object
let appData: IAppData;

// Text data object
let textData: ITextData;

// Asset list object
let assetList: IAssetList;

// Canvas rendering context
let ctx: CanvasRenderingContext2D;

// Canvas element reference
let canvas: HTMLCanvasElement;

// UI Layer element reference
let uiLayer: HTMLElement;

// Background music instance
let bgm: Howl | null = null;

// Sound for placing a mirror
let sndPlace: Howl | null = null;

// Sound for rotating a mirror
let sndRotate: Howl | null = null;

// Sound when laser hits target
let sndHit: Howl | null = null;

// Sound when stage is cleared
let sndClear: Howl | null = null;

// Number of grid columns for current stage
let gridCols: number = 0;

// Number of grid rows for current stage
let gridRows: number = 0;

// Size of a single grid cell in pixels
let gridCellSize: number = 0;

// X offset to center the grid in the game area
let gridOffsetX: number = 0;

// Y offset to center the grid in the game area
let gridOffsetY: number = 0;

// 2D array representing the map layout
let mapGrid: string[][] = [];

// Number of mirrors currently in inventory
let inventoryCount: number = 0;

// List of active mirrors in the game
let mirrors: Mirror[] = [];

// Reference to the mirror currently being dragged
let draggingMirror: Mirror | null = null;

// Flag indicating if a drag operation is active
let isDragging: boolean = false;

// X coordinate where pointer went down
let pointerDownX: number = 0;

// Y coordinate where pointer went down
let pointerDownY: number = 0;

// Timestamp when pointer went down
let pointerDownTime: number = 0;

// Laser emitter column index
let emitterC: number = 0;

// Laser emitter row index
let emitterR: number = 0;

// Laser emitter direction X
let emitterDx: number = 0;

// Laser emitter direction Y
let emitterDy: number = 0;

// Path points of the active laser beam
let laserPath: IPoint[] = [];

// Flag indicating if the laser reached the target
let isTargetHit: boolean = false;

// Timestamp when the target was hit to trigger delay
let stageClearDelay: number = 0;

// Time counter for background animation
let titleTime: number = 0;

// Function to find the asset path by id
function getAssetPath(id: string): string {
  const asset = assetList.sounds.find((s) => s.id === id);
  return asset ? asset.file_path : "";
}

// Initialize Howler sounds
function initSounds() {
  if (bgm) return;
  bgm = new Howl({ src: [getAssetPath("bgm")], loop: true, volume: 0.5 });
  sndPlace = new Howl({ src: [getAssetPath("place")], volume: 0.8 });
  sndRotate = new Howl({ src: [getAssetPath("rotate")], volume: 0.8 });
  sndHit = new Howl({ src: [getAssetPath("hit")], volume: 0.8 });
  sndClear = new Howl({ src: [getAssetPath("clear")], volume: 1.0 });
  bgm.play();
}

// Set up pointer event handlers on canvas
function setupInputHandlers() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
}

// Get logical coordinates from pointer event
function getMousePos(e: Event): IPoint {
  const pe = e as PointerEvent;
  return AppHelper.getRelativeCoordinates(pe.clientX, pe.clientY, canvas);
}

// Pointer down event handler
function onPointerDown(e: Event) {
  const pos = getMousePos(e);
  pointerDownX = pos.x;
  pointerDownY = pos.y;
  pointerDownTime = Date.now();

  if (gameState !== GameState.PLAYING) return;

  for (let i = mirrors.length - 1; i >= 0; i--) {
    const m = mirrors[i];
    const mx = gridOffsetX + m.c * gridCellSize + gridCellSize / 2;
    const my = gridOffsetY + m.r * gridCellSize + gridCellSize / 2;
    if (Math.hypot(mx - pos.x, my - pos.y) < gridCellSize / 2) {
      draggingMirror = m;
      mirrors.splice(i, 1);
      draggingMirror.px = pos.x;
      draggingMirror.py = pos.y;
      isDragging = true;
      return;
    }
  }

  for (let i = 0; i < inventoryCount; i++) {
    const ix = 700;
    const iy = 120 + i * 80;
    if (Math.hypot(ix - pos.x, iy - pos.y) < 30) {
      draggingMirror = new Mirror(-1, -1, pos.x, pos.y);
      inventoryCount--;
      isDragging = true;
      return;
    }
  }
}

// Pointer move event handler
function onPointerMove(e: Event) {
  if (!isDragging || !draggingMirror) return;
  const pos = getMousePos(e);
  draggingMirror.px = pos.x;
  draggingMirror.py = pos.y;
}

// Pointer up event handler
function onPointerUp(e: Event) {
  if (!isDragging || !draggingMirror) return;
  const pos = getMousePos(e);
  const dt = Date.now() - pointerDownTime;
  const dist = Math.hypot(pos.x - pointerDownX, pos.y - pointerDownY);

  const isClick = dt < 300 && dist < 10;

  if (isClick && draggingMirror.c !== -1) {
    draggingMirror.type = 1 - draggingMirror.type;
    mirrors.push(draggingMirror);
    if (sndRotate) sndRotate.play();
  } else {
    const c = Math.floor((pos.x - gridOffsetX) / gridCellSize);
    const r = Math.floor((pos.y - gridOffsetY) / gridCellSize);

    const inGrid =
      pos.x > gridOffsetX &&
      pos.x < gridOffsetX + gridCols * gridCellSize &&
      pos.y > gridOffsetY &&
      pos.y < gridOffsetY + gridRows * gridCellSize;

    if (inGrid && mapGrid[r][c] === "." && !mirrors.some((m) => m.c === c && m.r === r)) {
      draggingMirror.c = c;
      draggingMirror.r = r;
      mirrors.push(draggingMirror);
      if (sndPlace) sndPlace.play();
    } else {
      if (pos.x > 600) {
        inventoryCount++;
      } else {
        if (draggingMirror.c !== -1) {
          mirrors.push(draggingMirror);
        } else {
          inventoryCount++;
        }
      }
    }
  }

  draggingMirror = null;
  isDragging = false;
  calculateLaser();
}

// Clear all UI elements from the layer
function clearUIElements() {
  while (uiLayer.firstChild) {
    uiLayer.removeChild(uiLayer.firstChild);
  }
}

// Display the title screen
function showTitleScreen() {
  clearUIElements();
  gameState = GameState.TITLE;

  const title = AppHelper.createUIElement(
    "div",
    "titleText",
    {
      position: "absolute",
      top: "30%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "64px",
      fontWeight: "bold",
      color: "#0ff",
      textShadow: "0 0 20px #0ff",
      textAlign: "center",
    },
    textData.title,
  );

  const startBtn = AppHelper.createUIElement(
    "button",
    "startBtn",
    {
      position: "absolute",
      top: "60%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "32px",
      padding: "15px 40px",
      backgroundColor: "#005555",
      color: "#fff",
      border: "2px solid #0ff",
      borderRadius: "10px",
      cursor: "pointer",
      pointerEvents: "auto",
    },
    textData.startBtn,
    [
      {
        event: "click",
        handler: () => {
          initSounds();
          showInstructionsScreen();
        },
      },
    ],
  );

  uiLayer.appendChild(title);
  uiLayer.appendChild(startBtn);
}

// Display instructions screen
function showInstructionsScreen() {
  clearUIElements();
  gameState = GameState.INSTRUCTIONS;

  const title = AppHelper.createUIElement(
    "div",
    "instrTitle",
    {
      position: "absolute",
      top: "20%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "48px",
      fontWeight: "bold",
      color: "#0ff",
    },
    textData.instructionsTitle,
  );

  const container = AppHelper.createUIElement("div", "instrContainer", {
    position: "absolute",
    top: "45%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: "24px",
    color: "#fff",
    textAlign: "center",
    lineHeight: "1.8",
  });

  textData.instructions.forEach((line, index) => {
    const p = AppHelper.createUIElement("p", `instrLine${index}`, { margin: "10px 0" }, line);
    container.appendChild(p);
  });

  const playBtn = AppHelper.createUIElement(
    "button",
    "playBtn",
    {
      position: "absolute",
      top: "75%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "32px",
      padding: "15px 40px",
      backgroundColor: "#005555",
      color: "#fff",
      border: "2px solid #0ff",
      borderRadius: "10px",
      cursor: "pointer",
      pointerEvents: "auto",
    },
    textData.playBtn,
    [
      {
        event: "click",
        handler: () => {
          clearUIElements();
          loadStage(0);
        },
      },
    ],
  );

  uiLayer.appendChild(title);
  uiLayer.appendChild(container);
  uiLayer.appendChild(playBtn);
}

// Display stage clear overlay
function showStageClear() {
  if (sndClear) sndClear.play();

  const overlay = AppHelper.createUIElement("div", "clearOverlay", {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "auto",
  });

  const title = AppHelper.createUIElement(
    "div",
    "clearTitle",
    {
      fontSize: "56px",
      fontWeight: "bold",
      color: "#0f0",
      textShadow: "0 0 20px #0f0",
      marginBottom: "50px",
    },
    textData.stageClear,
  );

  const nextBtn = AppHelper.createUIElement(
    "button",
    "nextBtn",
    {
      fontSize: "32px",
      padding: "15px 40px",
      backgroundColor: "#005500",
      color: "#fff",
      border: "2px solid #0f0",
      borderRadius: "10px",
      cursor: "pointer",
      pointerEvents: "auto",
    },
    textData.nextBtn,
    [
      {
        event: "click",
        handler: () => {
          currentStageIndex++;
          if (currentStageIndex >= appData.stages.length) {
            showAllClear();
          } else {
            clearUIElements();
            loadStage(currentStageIndex);
          }
        },
      },
    ],
  );

  overlay.appendChild(title);
  overlay.appendChild(nextBtn);
  uiLayer.appendChild(overlay);
}

// Display all clear celebration screen
function showAllClear() {
  clearUIElements();
  gameState = GameState.ALL_CLEAR;

  if (sndClear) sndClear.play();

  confetti.default({
    particleCount: 150,
    spread: 100,
    origin: { y: 0.6 },
  });

  const title = AppHelper.createUIElement(
    "div",
    "allClearTitle",
    {
      position: "absolute",
      top: "30%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "56px",
      fontWeight: "bold",
      color: "#ff0",
      textShadow: "0 0 20px #ff0",
    },
    textData.allClear,
  );

  const restartBtn = AppHelper.createUIElement(
    "button",
    "restartBtn",
    {
      position: "absolute",
      top: "60%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "32px",
      padding: "15px 40px",
      backgroundColor: "#550000",
      color: "#fff",
      border: "2px solid #f00",
      borderRadius: "10px",
      cursor: "pointer",
      pointerEvents: "auto",
    },
    textData.restartBtn,
    [
      {
        event: "click",
        handler: () => {
          currentStageIndex = 0;
          showTitleScreen();
        },
      },
    ],
  );

  uiLayer.appendChild(title);
  uiLayer.appendChild(restartBtn);
}

// Load and initialize a stage by index
function loadStage(index: number) {
  const stageData = appData.stages[index];
  gridCols = stageData.cols;
  gridRows = stageData.rows;
  inventoryCount = stageData.inventoryMirrors;
  mirrors = [];
  laserPath = [];
  isTargetHit = false;
  stageClearDelay = 0;
  gameState = GameState.PLAYING;

  gridCellSize = Math.min(500 / gridCols, 500 / gridRows);
  gridOffsetX = (600 - gridCols * gridCellSize) / 2;
  gridOffsetY = (600 - gridRows * gridCellSize) / 2;

  mapGrid = [];
  for (let r = 0; r < gridRows; r++) {
    mapGrid.push(stageData.grid[r].split(" "));
  }

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cell = mapGrid[r][c];
      if ([">", "<", "^", "v"].includes(cell)) {
        emitterC = c;
        emitterR = r;
        if (cell === ">") {
          emitterDx = 1;
          emitterDy = 0;
        }
        if (cell === "<") {
          emitterDx = -1;
          emitterDy = 0;
        }
        if (cell === "^") {
          emitterDx = 0;
          emitterDy = -1;
        }
        if (cell === "v") {
          emitterDx = 0;
          emitterDy = 1;
        }
      }
    }
  }
}

// Calculate the path of the laser based on mirrors and walls
function calculateLaser() {
  laserPath = [];
  isTargetHit = false;

  let c = emitterC;
  let r = emitterR;
  let dx = emitterDx;
  let dy = emitterDy;

  let cx = gridOffsetX + c * gridCellSize + gridCellSize / 2;
  let cy = gridOffsetY + r * gridCellSize + gridCellSize / 2;
  laserPath.push({ x: cx, y: cy });

  let maxSteps = 100;
  while (maxSteps-- > 0) {
    const nextC = c + dx;
    const nextR = r + dy;

    if (nextC < 0 || nextC >= gridCols || nextR < 0 || nextR >= gridRows) {
      laserPath.push({ x: cx + dx * gridCellSize, y: cy + dy * gridCellSize });
      break;
    }

    const nextPx = gridOffsetX + nextC * gridCellSize + gridCellSize / 2;
    const nextPy = gridOffsetY + nextR * gridCellSize + gridCellSize / 2;
    const cell = mapGrid[nextR][nextC];
    const m = mirrors.find((mr) => mr.c === nextC && mr.r === nextR);

    laserPath.push({ x: nextPx, y: nextPy });

    if (m) {
      if (m.type === 0) {
        const temp = dx;
        dx = -dy;
        dy = -temp;
      } else {
        const temp = dx;
        dx = dy;
        dy = temp;
      }
      c = nextC;
      r = nextR;
      cx = nextPx;
      cy = nextPy;
    } else if (cell === "#") {
      laserPath.pop();
      laserPath.push({ x: cx + (dx * gridCellSize) / 2, y: cy + (dy * gridCellSize) / 2 });
      break;
    } else if (cell === "T") {
      isTargetHit = true;
      break;
    } else if ([">", "<", "^", "v"].includes(cell)) {
      laserPath.pop();
      laserPath.push({ x: cx + (dx * gridCellSize) / 2, y: cy + (dy * gridCellSize) / 2 });
      break;
    } else {
      c = nextC;
      r = nextR;
      cx = nextPx;
      cy = nextPy;
    }
  }
}

// Main game loop function
function gameLoop(time: number) {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// Update game logic state
function update() {
  if (gameState === GameState.PLAYING) {
    calculateLaser();
    if (isTargetHit) {
      if (stageClearDelay === 0) {
        if (sndHit) sndHit.play();
        stageClearDelay = Date.now();
      } else if (Date.now() - stageClearDelay > 1500) {
        gameState = GameState.STAGE_CLEAR;
        showStageClear();
      }
    } else {
      stageClearDelay = 0;
    }
  }
}

// Draw rotating laser effect for title screen
function drawTitleBg() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  titleTime += 0.05;
  ctx.save();
  ctx.translate(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
  ctx.rotate(titleTime * 0.1);

  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.strokeStyle = `hsl(${(titleTime * 20 + i * 50) % 360}, 100%, 50%)`;
    ctx.lineWidth = 4;
    ctx.shadowBlur = 20;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.moveTo(-400, Math.sin(titleTime + i) * 200);
    ctx.lineTo(400, Math.cos(titleTime - i) * 200);
    ctx.stroke();
  }
  ctx.restore();
}

// Draw mirror icon or placed mirror
function drawMirror(x: number, y: number, type: number, isIcon: boolean) {
  const size = isIcon ? 50 : gridCellSize * 0.7;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "rgba(50, 150, 255, 0.2)";
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#4cf";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (type === 0) {
    ctx.moveTo(-size / 2 + 5, size / 2 - 5);
    ctx.lineTo(size / 2 - 5, -size / 2 + 5);
  } else {
    ctx.moveTo(-size / 2 + 5, -size / 2 + 5);
    ctx.lineTo(size / 2 - 5, size / 2 - 5);
  }
  ctx.stroke();

  ctx.restore();
}

// Render the main gameplay screen
function draw() {
  if (gameState === GameState.TITLE || gameState === GameState.INSTRUCTIONS) {
    drawTitleBg();
    return;
  }

  if (gameState === GameState.ALL_CLEAR) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    return;
  }

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cell = mapGrid[r][c];
      const x = gridOffsetX + c * gridCellSize;
      const y = gridOffsetY + r * gridCellSize;

      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(x + 1, y + 1, gridCellSize - 2, gridCellSize - 2);

      if (cell === "#") {
        ctx.fillStyle = "#333";
        ctx.fillRect(x + 2, y + 2, gridCellSize - 4, gridCellSize - 4);
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 4, y + 4, gridCellSize - 8, gridCellSize - 8);
      } else if ([">", "<", "^", "v"].includes(cell)) {
        ctx.fillStyle = "#522";
        ctx.beginPath();
        ctx.arc(x + gridCellSize / 2, y + gridCellSize / 2, gridCellSize * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#f33";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        const cx = x + gridCellSize / 2;
        const cy = y + gridCellSize / 2;
        ctx.moveTo(cx, cy);
        if (cell === ">") ctx.lineTo(cx + gridCellSize * 0.4, cy);
        if (cell === "<") ctx.lineTo(cx - gridCellSize * 0.4, cy);
        if (cell === "^") ctx.lineTo(cx, cy - gridCellSize * 0.4);
        if (cell === "v") ctx.lineTo(cx, cy + gridCellSize * 0.4);
        ctx.stroke();
      } else if (cell === "T") {
        const blink = Math.sin(Date.now() / 100) * 0.2 + 0.8;
        ctx.fillStyle = isTargetHit ? `rgba(0, 255, 0, ${blink})` : "#252";
        ctx.beginPath();
        ctx.arc(x + gridCellSize / 2, y + gridCellSize / 2, gridCellSize * 0.3, 0, Math.PI * 2);
        ctx.fill();

        if (isTargetHit) {
          ctx.shadowBlur = 20;
          ctx.shadowColor = "#0f0";
          ctx.strokeStyle = "#0f0";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  mirrors.forEach((m) => {
    if (m !== draggingMirror) {
      drawMirror(
        gridOffsetX + m.c * gridCellSize + gridCellSize / 2,
        gridOffsetY + m.r * gridCellSize + gridCellSize / 2,
        m.type,
        false,
      );
    }
  });

  if (laserPath.length > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#0ff";
    ctx.beginPath();
    ctx.moveTo(laserPath[0].x, laserPath[0].y);
    for (let i = 1; i < laserPath.length; i++) {
      ctx.lineTo(laserPath[i].x, laserPath[i].y);
    }
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  ctx.fillStyle = "#222";
  ctx.fillRect(600, 0, 200, 600);
  ctx.fillStyle = "#fff";
  ctx.font = "24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(textData.inventoryLabel, 700, 50);

  for (let i = 0; i < inventoryCount; i++) {
    drawMirror(700, 120 + i * 80, 0, true);
  }

  if (draggingMirror) {
    drawMirror(draggingMirror.px, draggingMirror.py, draggingMirror.type, false);
  }
}

// Entry point function
async function initApp() {
  appData = await AppHelper.loadAppData<IAppData>();
  textData = await AppHelper.loadTextData<ITextData>();
  assetList = await AppHelper.loadAssetList<IAssetList>();

  canvas = document.getElementById("appCanvas") as HTMLCanvasElement;
  uiLayer = document.getElementById("uiLayer") as HTMLElement;

  canvas.width = LOGICAL_WIDTH;
  canvas.height = LOGICAL_HEIGHT;
  ctx = canvas.getContext("2d")!;

  setupInputHandlers();
  showTitleScreen();
  requestAnimationFrame(gameLoop);
}

// export section

export { initApp };

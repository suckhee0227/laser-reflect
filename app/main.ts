import { initApp } from "./app";
import { AppHelper } from "./appHelper";

let logicalWidth: number = 0;
let logicalHeight: number = 0;

const appCanvas = document.getElementById("appCanvas") as HTMLCanvasElement;
const uiLayer = document.getElementById("uiLayer") as HTMLDivElement;
const appContainer = document.getElementById("appContainer") as HTMLDivElement;

let isCanvasLayoutUpdating: boolean = false;

function UpdateCanvasLayout() {
  if (!isCanvasLayoutUpdating) {
    window.requestAnimationFrame(() => {
      isCanvasLayoutUpdating = true;

      if (appCanvas.width !== 1 && appCanvas.height !== 1) {
        // appCanvas의 사이즈가 1×1에서 처음 변경될 때
        // 그 크기를 기준 해상도로 간주하고 기록
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

        let displayWidth: number;
        let displayHeight: number;

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

        const uiLayerScale = appCanvas.width / logicalWidth;;
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

const resizeObserver = new ResizeObserver((entries) => {
  for (let entry of entries) {
    if (entry.target === appCanvas) {
      UpdateCanvasLayout();
    }
  }
});

// 부모 메시지 핸들러
let isCapturing: boolean = false;
let lastPingTime: number = 0;
let lastCaptureTime: number = 0;
let lastResolutionTime: number = 0;
const MIN_PARENT_MESSAGE_INTERVAL: number = 1000;

// 부모에게 ping-pong 지원을 알리는 초기 신호 (unsolicited pong)
window.parent.postMessage({
  source: "typingx-x-iframe",
  type: "ping-pong-ready"
}, "*");

window.addEventListener("message", async (event) => {
  if (!event.data || event.data.source !== "alparka-parent") return;

  const now = Date.now();

  // Heartbeat: 게임 응답 확인
  if (event.data.type === "ping"
    && now - lastPingTime > MIN_PARENT_MESSAGE_INTERVAL) {
    lastPingTime = now;
    
    window.parent.postMessage({
      source: "typingx-x-iframe",
      type: "pong"
    }, "*");
  } 
  // 썸네일 캡처
  else if (event.data.type === "request-canvas-capture" 
    && now - lastCaptureTime > MIN_PARENT_MESSAGE_INTERVAL
    && !isCapturing ) {
    lastCaptureTime = now;
    isCapturing = true;

    try {
      const dataUrl = await AppHelper.captureCanvasAsDataUrl(true);
      if (dataUrl) {
        window.parent.postMessage({
          source: "typingx-x-iframe",
          type: "canvas-capture",
          payload: { dataUrl: dataUrl }
        }, "*");
      }
    } finally {
      isCapturing = false;
    }
  }
  // 앱 해상도 요청 (전체화면 방향 결정용)
  else if (event.data.type === "request-app-resolution"
    && now - lastResolutionTime > MIN_PARENT_MESSAGE_INTERVAL) {
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

// DOM이 준비되면 실행합니다.
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    resizeObserver.observe(appCanvas);
    initApp();
    SetCanvasFocus();
    UpdateCanvasLayout();
  }, 0);
});

import { toPng } from "html-to-image";

export class AppHelper {
  private static async fetchRawData() {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`Failed to load data.json`);
    return await response.json();
  }

  static async loadAppData<T>(): Promise<T> {
    const data = await this.fetchRawData();
    return data.appData as T;
  }

  static async loadTextData<T>(): Promise<T> {
    const data = await this.fetchRawData();
    const textData = data.textData;

    // No multi-language structure, return as-is
    if (!textData?.default_language) {
      return textData as T;
    }

    const defaultLang = textData.default_language;
    let lang = defaultLang;
    if (textData.supported_multiple_languages) {
      lang = new URLSearchParams(window.location.search).get("lang") || defaultLang;
    }
    const langTexts = textData[lang];
    const texts = (langTexts && Object.keys(langTexts).length > 0) ? langTexts : textData[defaultLang] || {};
    return texts as T;
  }

  static async loadAssetList<T>(): Promise<T> {
    const data = await this.fetchRawData();
    return data.assetList as T;
  }

  /**
   * 브라우저 클라이언트 좌표를 캔버스의 논리 해상도 좌표로 변환합니다.
   * AI 지침: appCanvas 규칙에 따라 모든 마우스/터치 좌표 보정에 이 함수를 사용하세요.
   * @param clientX - event.clientX
   * @param clientY - event.clientY
   * @param appCanvas - 기준이 되는 HTMLCanvasElement
   */
  static getRelativeCoordinates(
    clientX: number,
    clientY: number,
    appCanvas: HTMLCanvasElement,
  ): { x: number; y: number } {
    const rect = appCanvas.getBoundingClientRect();

    // 1. 캔버스 내 상대 위치 계산
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // 2. 논리 해상도 보정 (HTMLCanvasElement는 width/height 속성이 기본이므로 direct 접근 가능)
    const scaleX = appCanvas.width / rect.width;
    const scaleY = appCanvas.height / rect.height;

    return {
      x: x * scaleX,
      y: y * scaleY,
    };
  }

  /** 기기 유형 감지 */
  static getPlatform(): "mobile" | "pc" {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) || navigator.maxTouchPoints > 0
      ? "mobile"
      : "pc";
  }

  /** 화면 방향 감지 (가로 모드 여부) */
  static isLandscape(): boolean {
    return window.innerWidth > window.innerHeight;
  }

  /** 터치 지원 여부 (PC라도 터치 모니터일 수 있음) */
  static supportsTouch(): boolean {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  /** 텍스트를 안전한 HTML로 변환 (XSS 방어) */
  private static sanitizeText(text: string): string {
    // 1단계: 위험 태그 제거 (내용 포함 삭제)
    let safe = text.replace(
      /<(script|style|iframe|svg|math|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );
    // 1단계 태그의 자기 닫힘 및 잔여 단독 태그도 제거
    safe = safe.replace(
      /<\/?(script|style|iframe|svg|math|form)\b[^>]*\/?>/gi,
      ""
    );

    // 2단계: 위험 태그 제거 (태그만 삭제, 내용 유지)
    safe = safe.replace(
      /<\/?(img|a|input|button|textarea|select|option|label|fieldset|legend|link|meta|base|video|audio|source|object|embed|span|div|table|tr|td|th|thead|tbody|tfoot|col|colgroup|caption|h[1-6]|nav|section|article|header|footer|main|aside|details|summary)\b[^>]*>/gi,
      ""
    );

    // 3단계: 남은 전부 이스케이프
    safe = safe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // 4단계: 안전 태그만 복원
    safe = safe.replace(/&lt;(br)\s*\/?&gt;/gi, "<br>");
    safe = safe.replace(/&lt;(\/?(?:p|b|i|u|strong|em|small))&gt;/gi, "<$1>");

    // 5단계: 숫자 HTML 엔티티 복원 (< > & 제외)
    safe = safe.replace(/&amp;#(\d+);/g, (match, num) => {
      const n = parseInt(num, 10);
      return (n === 38 || n === 60 || n === 62) ? match : `&#${num};`;
    });
    safe = safe.replace(/&amp;#x([0-9a-fA-F]+);/g, (match, hex) => {
      const n = parseInt(hex, 16);
      return (n === 38 || n === 60 || n === 62) ? match : `&#x${hex};`;
    });

    // 6단계: \n → <br> 변환
    safe = safe.replace(/\n/g, "<br>");

    return safe;
  }

  /** DOM기반 UI 요소 생성 */
  static createUIElement(
    elementType: string,
    id: string = "",
    styles: Partial<CSSStyleDeclaration> = {},
    textContent: string = "",
    eventListeners: { event: string; handler: (event: Event) => void }[] = []
  ): HTMLElement {
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
  static async captureCanvasAsDataUrl(
    includeUILayer: boolean = true
  ): Promise<string | null> {
    const appCanvas = document.getElementById("appCanvas") as HTMLCanvasElement;
    const appContainer = document.getElementById("appContainer") as HTMLDivElement;

    if (!appCanvas || !appContainer) return null;

    let dataUrl: string | null = null;

    try {
      if (includeUILayer) {
        // appContainer 전체 캡처 (캔버스 + UI 레이어)
        const savedStyle = appContainer.style.cssText;

        // 캡처용 스타일로 임시 변경
        appContainer.style.transform = "none";
        appContainer.style.position = "relative";
        appContainer.style.left = "0";
        appContainer.style.top = "0";

        dataUrl = await toPng(appContainer, {
          width: appCanvas.width,
          height: appCanvas.height,
        });

        // 원본 스타일 복원
        appContainer.style.cssText = savedStyle;
      } else {
        // appCanvas만 캡처
        dataUrl = appCanvas.toDataURL("image/webp");
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
  static async captureCanvasAsImage(
    includeUILayer: boolean = true
  ): Promise<HTMLImageElement | null> {
    const dataUrl = await this.captureCanvasAsDataUrl(includeUILayer);
    if (!dataUrl) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
}

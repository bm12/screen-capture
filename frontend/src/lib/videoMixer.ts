export type CanvasSizes = {
  width: number;
  height: number;
};

type StreamConfig = {
  stream: MediaStream;
  videoElement: HTMLVideoElement;
  width?: number;
  height?: number;
  top?: number;
  left?: number;
};

const visuallyHiddenStyles: Record<string, string> = {
  opacity: '0',
  width: '1px',
  height: '1px',
  position: 'absolute',
  pointerEvents: 'none',
};

type MixerOptions = {
  container: HTMLElement;
  firstStream: StreamConfig;
  secondStream?: StreamConfig | null;
  sizes: CanvasSizes;
  showPreview?: boolean;
  previewClassName?: string;
};

export class VideoStreamMixer {
  private canvas: HTMLCanvasElement | null = null;

  private ctx: CanvasRenderingContext2D | null = null;

  private videoStream: MediaStream | null = null;

  private rafId: number | null = null;

  private isLoopEnabled = false;

  private isVisibilityPaused = false;

  private lastFrameTimestamp = 0;

  private readonly frameIntervalMs = 1000 / 30;

  private options: MixerOptions;

  private readonly handleVisibilityChange = () => {
    if (typeof document === 'undefined') {
      return;
    }

    this.isVisibilityPaused = document.visibilityState === 'hidden';

    if (this.isVisibilityPaused && this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      return;
    }

    if (!this.isVisibilityPaused) {
      this.requestNextFrame();
    }
  };

  constructor(options: MixerOptions) {
    this.options = options;
  }

  init() {
    if (this.canvas) {
      return;
    }

    const { container, sizes, showPreview = true, previewClassName } = this.options;
    const canvas = document.createElement('canvas');
    canvas.width = sizes.width;
    canvas.height = sizes.height;

    if (showPreview) {
      if (previewClassName) {
        canvas.classList.add(previewClassName);
      }
    } else {
      Object.entries(visuallyHiddenStyles).forEach(([key, value]) => {
        canvas.style.setProperty(key, value);
      });
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Не удалось создать 2D контекст для canvas');
    }

    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = ctx;

    this.prepareVideoElement(this.options.firstStream);
    if (this.options.secondStream) {
      this.prepareVideoElement(this.options.secondStream);
    }

    this.isLoopEnabled = true;
    this.isVisibilityPaused = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.lastFrameTimestamp = 0;
    this.requestNextFrame();
    this.videoStream = canvas.captureStream(30);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private prepareVideoElement(streamConfig: StreamConfig) {
    const { stream, videoElement } = streamConfig;
    videoElement.srcObject = stream;
    videoElement.playsInline = true;
    videoElement.muted = true;
    if (videoElement.readyState >= 2) {
      void videoElement.play();
    } else {
      videoElement.onloadedmetadata = () => {
        void videoElement.play();
      };
    }
  }

  private requestNextFrame() {
    if (!this.isLoopEnabled || this.isVisibilityPaused || this.rafId !== null) {
      return;
    }

    this.rafId = requestAnimationFrame(this.computeFrame);
  }

  private computeFrame = (timestamp?: number) => {
    if (!this.ctx || !this.canvas) {
      return;
    }

    if (!this.isLoopEnabled) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      return;
    }

    if (this.isVisibilityPaused) {
      this.rafId = null;
      return;
    }

    const now = typeof timestamp === 'number' ? timestamp : performance.now();
    if (now - this.lastFrameTimestamp < this.frameIntervalMs) {
      this.rafId = null;
      this.requestNextFrame();
      return;
    }

    this.lastFrameTimestamp = now;

    const { firstStream, secondStream, sizes } = this.options;
    const firstVideo = firstStream.videoElement;
    const firstWidth = firstStream.width ?? sizes.width;
    const firstHeight = firstStream.height ?? sizes.height;
    const firstLeft = firstStream.left ?? 0;
    const firstTop = firstStream.top ?? 0;

    this.ctx.drawImage(firstVideo, firstLeft, firstTop, firstWidth, firstHeight);

    if (secondStream) {
      const secondVideo = secondStream.videoElement;
      const secondWidth = secondStream.width ?? sizes.width / 4;
      const secondHeight = secondStream.height ?? sizes.height / 4;
      const secondLeft = secondStream.left ?? sizes.width - secondWidth - 24;
      const secondTop = secondStream.top ?? sizes.height - secondHeight - 24;
      this.ctx.drawImage(secondVideo, secondLeft, secondTop, secondWidth, secondHeight);
    }

    this.rafId = null;
    this.requestNextFrame();
  };

  getVideoStream() {
    return this.videoStream;
  }

  stop() {
    this.isLoopEnabled = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isVisibilityPaused = false;
  }

  destroy() {
    this.stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.ctx = null;
    this.videoStream = null;
  }
}

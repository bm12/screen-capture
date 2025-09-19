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

  private scheduleNextFrame = false;

  private options: MixerOptions;

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

    this.scheduleNextFrame = true;
    this.computeFrame();
    this.videoStream = canvas.captureStream(60);
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

  private computeFrame = () => {
    if (!this.ctx || !this.canvas) {
      return;
    }

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

    if (this.scheduleNextFrame) {
      this.rafId = requestAnimationFrame(this.computeFrame);
    }
  };

  getVideoStream() {
    return this.videoStream;
  }

  stop() {
    this.scheduleNextFrame = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.ctx = null;
    this.videoStream = null;
  }
}

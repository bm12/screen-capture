import { createCanvasAndCtx, appendAll } from './utils/dom.js';

const visualyHiddenStyles = {
  opacity: 0,
  width: '1px',
};

/**
 * @typedef {object} StreamData
 * @property {MediaStream} stream
 * @property {string} video
 * @property {number} [width=]
 * @property {number} [height=]
 * @property {number} [top=0]
 * @property {number} [left=0]
 */

class VideoStreamMixer {
  constructor({
    sizes,
    firstStreamData,
    secondStreamData,
    container,
    previewClassName,
    showPreview = true,
  }) {
    /** @type {HTMLElement} */
    this.container = document.querySelector(container);
    /** @type {boolean} */
    this.showPreview = showPreview;
    /** @type {string} */
    this.previewClassName = previewClassName;

    /** @type {StreamData} */
    this.firstStreamData = {
      stream: firstStreamData.stream,
      video: firstStreamData.video,
      top: firstStreamData.top ?? 0,
      left: firstStreamData.left ?? 0,
      width: firstStreamData.width ?? sizes.width,
      height: firstStreamData.height ?? sizes.height,
    };
    /** @type {StreamData} */
    this.secondStreamData = {
      stream: secondStreamData.stream,
      video: secondStreamData.video,
      top: secondStreamData.top ?? 0,
      left: secondStreamData.left ?? 0,
      width: secondStreamData.width ?? sizes.width,
      height: secondStreamData.height ?? sizes.height,
    };

    /** @type {{ width: number, height: number }} */
    this.sizes = sizes;
  }

  static applyHiddenStyles = (elem) => {
    Object.keys(visualyHiddenStyles).forEach((styleKey) => {
      elem.style[styleKey] = visualyHiddenStyles[styleKey];
    });
  };

  init() {
    const [canvas, ctx] = createCanvasAndCtx();
    canvas.width = this.sizes.width;
    canvas.height = this.sizes.height;

    if (this.showPreview) {
      canvas.classList.add(this.previewClassName);
    } else {
      VideoStreamMixer.applyHiddenStyles(canvas);
    }

    const childs = [canvas];
    appendAll(this.container, childs);

    this.ctx = ctx;
    this.canvas = canvas;

    this.firstVideo = document.querySelector(this.firstStreamData.video);
    this.firstVideo.srcObject = this.firstStreamData.stream;

    this.secondVideo = document.querySelector(this.secondStreamData.video);
    this.secondVideo.srcObject = this.secondStreamData.stream;

    this.scheduleNextRaf = true;
    this.computeFrame();

    this.videoStream = canvas.captureStream(60);
  }

  getVideoStream() {
    return this.videoStream;
  }

  /** @private */
  computeFrame = () => {
    const ctx = this.ctx;
    const data1 = this.firstStreamData;
    const data2 = this.secondStreamData;
    ctx.drawImage(this.firstVideo, data1.left, data1.top, data1.width, data1.height);
    ctx.drawImage(this.secondVideo, data2.left, data2.top, data2.width, data2.height);

    if (this.scheduleNextRaf) {
      this.rafId = requestAnimationFrame(this.computeFrame);
    }
  };

  stop() {
    this.scheduleNextRaf = false;
  }

  destroy() {
    this.stop();
    cancelAnimationFrame(this.rafId);

    this.ctx = null;
    this.canvas.remove();
    this.firstVideo.srcObject = null;
    this.secondVideo.srcObject = null;
  }
}


export { VideoStreamMixer };

import { createCanvasAndCtx, appendAll } from './utils/dom.js';

const visualyHiddenStyles = { opacity: 0, width: '1px' };

/**
 * @typedef {object} StreamConfig
 * @property {MediaStream} stream
 * @property {string} video
 * @property {number} [width=]
 * @property {number} [height=]
 * @property {number} [top=0]
 * @property {number} [left=0]
 */

/**
 * @typedef {{ width: number, height: number }} CanvasSizes
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

    /** @type {StreamConfig} */
    this.firstStreamData = VideoStreamMixer.mapStreamData(sizes, firstStreamData);
    /** @type {StreamConfig} */
    this.secondStreamData = VideoStreamMixer.mapStreamData(sizes, secondStreamData);

    /** @type {CanvasSizes} */
    this.sizes = sizes;
  }

  /**
   * @param {CanvasSizes} sizes
   * @param {object} data
   * @returns {StreamConfig}
   */
  static mapStreamData(sizes, data) {
    const streamDataDefaulValues = {
      stream: null,
      video: null,
      top: 0,
      left: 0,
      width: sizes.width,
      height: sizes.height,
    };
    const newData = {};

    Object.keys(streamDataDefaulValues).forEach((key) => {
      newData[key] = data[key] ?? streamDataDefaulValues[key];
    });

    return newData;
  }

  static applyHiddenStyles = (elem) => {
    Object.keys(visualyHiddenStyles).forEach((styleKey) => {
      elem.style[styleKey] = visualyHiddenStyles[styleKey];
    });
  };

  init() {
    const [canvas, ctx] = createCanvasAndCtx({ ctx: { alpha: false } });
    canvas.width = this.sizes.width;
    canvas.height = this.sizes.height;

    if (this.showPreview) {
      canvas.classList.add(this.previewClassName);
    } else {
      VideoStreamMixer.applyHiddenStyles(canvas);
    }

    const childs = [canvas];
    appendAll(this.container ?? document.body, childs);

    this.ctx = ctx;
    this.canvas = canvas;

    this.firstVideo = document.querySelector(this.firstStreamData.video);
    this.firstVideo.srcObject = this.firstStreamData.stream;

    this.secondVideo = document.querySelector(this.secondStreamData.video);
    this.secondVideo.srcObject = this.secondStreamData.stream;

    this.scheduleNextRaf = true;
    requestAnimationFrame(this.computeFrame);

    this.videoStream = canvas.captureStream(60);
  }

  getVideoStream = () => this.videoStream;

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

export const getCapturedStream = (video) => (video.captureStream || video.mozCaptureStream)();

export const getDisplayMedia = (audio, screenSizes) => {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      cursor: 'always',
      logicalSurface: true,
      width: screenSizes.width,
      height: screenSizes.height,
      frameRate: 60,
    },
    audio,
  });
};

export const getUserMedia = (audio, video) => {
  if (!audio && !video) return Promise.resolve(null);

  return navigator.mediaDevices.getUserMedia({
    audio: audio ? ({
      echoCancellation: true,
      noiseSuppression: true,
    }) : false,
    video,
  })
};

export const getCameraImageSizes = (cameraSettings, canvasWidth, canvasHeight) => {
  const {
    aspectRatio,
    width: cameraWidth,
    height: cameraHeight,
  } = cameraSettings;
  const quarterCanvasWidth = canvasWidth / 4;
  const quarterCanvasHeight = canvasHeight / 4;

  if (cameraWidth >= cameraHeight) {
    const cameraImageWidth = cameraWidth > quarterCanvasWidth ? quarterCanvasWidth : cameraWidth;
    const cameraImageHeight = cameraImageWidth / aspectRatio;

    return [cameraImageWidth, cameraImageHeight];
  } else {
    const cameraImageWidth = cameraHeight > quarterCanvasHeight ? quarterCanvasHeight : cameraHeight;
    const cameraImageHeight = cameraImageWidth / aspectRatio;

    return [cameraImageWidth, cameraImageHeight];

  }
};

export const getScreenSizes = (useNative) => {
  const { height, width } = window.screen;
  if (!useNative) return { width, height };

  return {
    width: width * window.devicePixelRatio,
    height: height * window.devicePixelRatio,
  };
};

/**
 * @param {object} options
 * @param {MediaStream} options.stream - source stream to be recorded
 * @param {string} options.mimeType - mimeType for MediaRecorder and type for Blob
 * @returns {{
 *  inctance: MediaRecorder,
 *  rec: () => Promise<Blob>
 * }}
 */
export const getRecorder = ({ stream, mimeType }) => {
  const recorder = new MediaRecorder(stream, { mimeType });
  return {
    inctance: recorder,
    rec: () => {
      const promise = new Promise((resolve, reject) => {
        const data = [];
        recorder.ondataavailable = event => data.push(event.data);
        recorder.onerror = (err) => reject(err);

        recorder.onstop = () => {
          const recordedBlob = new Blob(data, { type: mimeType });
          resolve(recordedBlob);
        };
      });
      recorder.start();
      return promise;
    },
    stop: () => recorder.stop(),
  };
}

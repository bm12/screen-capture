export const getCapturedStream = (video) => (video.captureStream || video.mozCaptureStream)();

export const getAverageVolume = (analyser) => {
  const array = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(array);
  let values = 0;

  const length = array.length;
  for (var i = 0; i < length; i++) {
    values += (array[i]);
  }

  const average = values / length;

  return average;
};

export const getSourseAndGain = (context, stream) => {
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();

  return [source, gain];
};

export const setGainAndConnectSource = (gainNode, source, audioDestination, gainValue = 1) => {
  gainNode.gain.value = gainValue;
  source.connect(gainNode).connect(audioDestination);
};

export const getAnalyzer = (context) => {
  const analyser = context.createAnalyser();
  analyser.smoothingTimeConstant = 0.8;
  analyser.fftSize = 1024;

  return analyser;
};

export const getDisplayMedia = (audio) => {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      cursor: 'always',
      logicalSurface: true,
      width: 1920,
      height: 1080,
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
/**
 * Gets a string like 'Now: {{time}}'
 * and replace with values from the object
 * @param {string} string
 * @param {object} values
 */
export const templateParser = (string, values) => {
  if (!string) return '';
  if (!values) return string;
  return string.replace(/{{(\w+)}}/ig, (full, match) => values[match]);
}

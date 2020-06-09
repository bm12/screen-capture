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

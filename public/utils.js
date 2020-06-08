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
  gainNode.gain.value = 1.0;
  source.connect(gainNode).connect(audioDestination);
}

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
    },
    audio,
  });
}

export const getUserMedia = () => {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    }
  })
}
/** @param {AnalyserNode} analyser */
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

/**
 * @param {AudioContext} context
 * @param {MediaStream} stream
 */
export const getSourseAndGain = (context, stream) => {
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();

  return [source, gain];
};

/**
 * @param {GainNode} gainNode
 * @param {MediaStreamAudioSourceNode} source
 * @param {MediaStreamAudioDestinationNode} audioDestination
 * @param {number} gainValue
 */
export const setGainAndConnectSource = (gainNode, source, audioDestination, gainValue = 1) => {
  gainNode.gain.value = gainValue;
  source.connect(gainNode).connect(audioDestination);
};

/** @param {AudioContext} context */
export const getAnalyzer = (context) => {
  const analyser = context.createAnalyser();
  analyser.smoothingTimeConstant = 0.8;
  analyser.fftSize = 1024;

  return analyser;
};

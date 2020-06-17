/**
 * @param {Array} tracks
 * @param {MediaStream} destinationStream
 */
export const addTracksInStream = (tracks, destinationStream) => {
  tracks.forEach((track) => {
    destinationStream.addTrack(track);
  });
};

/**
 * @returns {{
 *  hasMicro: boolean,
 *  hasCamera: boolean,
 * }}
 */
export const getDeviceInfo = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();

  const hasMicro = devices.find(device => device.kind === 'audioinput');
  const hasCamera = devices.find(device => device.kind === 'videoinput');

  return { hasMicro, hasCamera };
};

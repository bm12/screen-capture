/**
 * @param {object} config
 * @param {function} onaddstream
 * @param {WebSocket} signalingChannel
 */
export const createPeerConnection = (config, onaddstream, signalingChannel) => {
  const connection = new RTCPeerConnection(config);

  connection.onicecandidate = (evt) => {
    if (!evt || !evt.candidate) return;
    signalingChannel.send(JSON.stringify({ event: 'web-rtc', data: evt.candidate }));
  };
  connection.onaddstream = onaddstream;

  return connection;
};

/**
 * @param {RTCPeerConnection} peerConnection
 * @param {WebSocket} signalingChannel
 */
export const createAndSendOffer = (peerConnection, signalingChannel) => {
  return peerConnection
    .createOffer()
    .then(offer => {
      return peerConnection
        .setLocalDescription(offer)
        .then(() => signalingChannel.send(JSON.stringify({ event: 'web-rtc', data: offer })));
    })
    .catch((err) => {
      alert(JSON.stringify(err, null, 2));
      console.error(err);
    });
};

/**
 * @param {RTCPeerConnection} peerConnection
 * @param {WebSocket} signalingChannel
 */
export const createAndSendAnswer = (peerConnection, signalingChannel) => {
  return peerConnection
    .createAnswer()
    .then(answer => {
      return peerConnection
        .setLocalDescription(answer)
        .then(() => signalingChannel.send(JSON.stringify({ event: 'web-rtc', data: answer })));
    })
    .catch((err) => {
      alert(JSON.stringify(err, null, 2));
      console.error(err);
    });
}

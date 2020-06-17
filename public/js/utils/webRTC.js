export const createPeerConnection = (config, onaddstream, signalingChannel) => {
  const connection = new RTCPeerConnection(config);

  // send any ice candidates to the other peer
  connection.onicecandidate = evt => {
    if (!evt || !evt.candidate) return;
    signalingChannel.send(JSON.stringify({ event: 'web-rtc', data: evt.candidate }));
  };
;
  connection.onaddstream = onaddstream;

  return connection;
};

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

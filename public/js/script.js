import { AudioStreamMixer } from './AudioStreamMixer.js';
import { addTracksInStream } from './utils/media.js';
import { templateParser } from './utils/string.js';
import {
  getCameraImageSizes,
  getCapturedStream,
  getDisplayMedia,
  getRecorder,
  getScreenSizes,
  getUserMedia,
} from './utils/video.js';
import { VideoStreamMixer } from './VideoStreamMixer.js';
import { setErrorElHidden } from './utils/dom.js';
import { createPeerConnection, createAndSendOffer, createAndSendAnswer } from './utils/webRTC.js';
import { iceServers } from './constants.js';

const startBtn = document.querySelector('#start');
const endBtn = document.querySelector('#end');
const generateRoomIdBtn = document.querySelector('#generateRoomId');
const setRoomId = document.querySelector('#setRoomId');
/** @type {HTMLVideoElement} */
const video = document.querySelector('#video');
/** @type {HTMLVideoElement} */
const streamConsumerVideo = document.querySelector('#streamConsumerVideo');
/** @type {HTMLAnchorElement} */
const downloadButton = document.querySelector('#downloadButton');
/** @type {HTMLInputElement} */
const audioCheckbox = document.querySelector('#audioCheckbox');
/** @type {HTMLInputElement} */
const microCheckbox = document.querySelector('#microCheckbox');
/** @type {HTMLInputElement} */
const cameraCheckbox = document.querySelector('#cameraCheckbox');
/** @type {HTMLInputElement} */
const streamingRadio = document.querySelector('#streamingRadio');
/** @type {HTMLInputElement} */
const streamingProviderId = document.querySelector('#streamingProviderId');
/** @type {HTMLInputElement} */
const streamingConsumerId = document.querySelector('#streamingConsumerId');

let stream = null;
let userStream = null;
let recorder = null;
let videoMixer = null;
let audioMixer = null;
let peerConn = null;
let signalingChannel = null;
let roomId = null;

const mimeType = 'video/webm';
const USE_CAPTURED_STREAM = false;
const USE_NATIVE_RESOLUTION = true;

const rtcConfiguration = {
  iceServers,
};

const onAddStream = (evt) => {
  console.log('Stream received from remote', evt);
  // set remote video stream as source for video element
  streamConsumerVideo.srcObject = evt.stream;
  streamConsumerVideo.hidden = false;
  streamConsumerVideo.controls = true;

  video.hidden = true;
};

const init = () => {
  const ondevicechange = async (e) => {
    const devices = await navigator.mediaDevices.enumerateDevices();

    const hasMicro = devices.find(device => device.kind === 'audioinput');
    const hasCamera = devices.find(device => device.kind === 'videoinput');

    setErrorElHidden('.micro-checkbox-wrap', hasMicro);
    setErrorElHidden('.camera-checkbox-wrap', hasCamera);
  }
  navigator.mediaDevices.addEventListener('devicechange', ondevicechange);

  signalingChannel = new WebSocket(`wss://${window.location.host}`);
  signalingChannel.onmessage = function onWsConnMessage(evt) {
    // if no peerConn is set the client is set, we should answer with an adp message
    if (!peerConn) {
      peerConn = createPeerConnection(rtcConfiguration, onAddStream, signalingChannel);
      setTimeout(() => createAndSendAnswer(peerConn, signalingChannel), 1000);
    }

    const signal = JSON.parse(evt.data);
    if ('sdp' in signal) {
      console.log('Received SDP from remote peer.', signal);
      peerConn.setRemoteDescription(new RTCSessionDescription(signal));
    } else if ('candidate' in signal) {
      console.log('Received ICECandidate from remote peer.');
      peerConn.addIceCandidate(new RTCIceCandidate(signal));
    }
  };
  ondevicechange();
};

init();

startBtn.addEventListener('click', async () => {
  try {
    const screenSizes = getScreenSizes(USE_NATIVE_RESOLUTION);
    userStream = await getUserMedia(microCheckbox.checked, cameraCheckbox.checked);
    stream = await getDisplayMedia(audioCheckbox.checked, screenSizes);

    downloadButton.hidden = true;
    if (downloadButton.href) URL.revokeObjectURL(downloadButton.href);

    const capturedStream = USE_CAPTURED_STREAM ? getCapturedStream() : stream;
    let videoStream = capturedStream;
    video.srcObject = capturedStream;

    if (cameraCheckbox.checked) {
      const { width, height } = screenSizes;
      const cameraSettings = userStream.getVideoTracks()[0].getSettings();

      video.classList.add('visualyHidden');

      const [cameraImageWidth, cameraImageHeight] = getCameraImageSizes(cameraSettings, width, height);

      videoMixer = new VideoStreamMixer({
        container: '#canvasContainer',
        previewClassName: 'previewCanvas',
        firstStreamData: {
          stream: capturedStream,
          video: '#capturedVideo',
        },
        secondStreamData: {
          stream: userStream,
          video: '#cameraVideo',
          width: cameraImageWidth,
          height: cameraImageHeight,
        },
        sizes: screenSizes,
      });
      videoMixer.init();
      videoStream = videoMixer.getVideoStream();
    }

    const composedStream = new MediaStream();
    addTracksInStream(videoStream.getVideoTracks(), composedStream);

    if (capturedStream.getAudioTracks().length > 0) {
      audioMixer = new AudioStreamMixer({
        systemAudioStream: capturedStream,
        userAudioStream: userStream,
      });

      audioMixer.start();
      const audioStream = audioMixer.getAudioStream();
      addTracksInStream(audioStream.getAudioTracks(), composedStream);
    } else {
      const micTracks = userStream?.getAudioTracks() ?? [];
      if (micTracks.length > 0) {
        addTracksInStream(micTracks, composedStream);
      }
    }

    if (streamingRadio.checked) {
      const peerConnection = createPeerConnection(rtcConfiguration, onAddStream, signalingChannel);
      // Store a reference to the peer connection
      peerConn = peerConnection;
      // Add stream to the peerConnection
      peerConnection.addStream(composedStream);
      // broadcast offer to other clients on the signalingChannel
      createAndSendOffer(peerConnection, signalingChannel);
    } else {
      recorder = getRecorder({ stream: composedStream, mimeType });
      const recordedBlob = await recorder.rec();
      const today = new Date();
      const fileName = templateParser('captured-{{date}}-{{time}}.webm', {
        date: today.toDateString(),
        time: today.toTimeString().substr(0, 17).replace(':', '-'),
      });

      downloadButton.href = URL.createObjectURL(recordedBlob);
      downloadButton.download = fileName;
      downloadButton.hidden = false;
    }

    console.log(stream);
  } catch (err) {
    console.error(err);
  }
});

setRoomId.addEventListener('click', () => {
  roomId = streamingConsumerId.value;
  generateRoomIdBtn.disabled = true;
  signalingChannel.send(JSON.stringify({ event: 'stream-request', roomId }));
});

generateRoomIdBtn.addEventListener('click', () => {
  roomId = String(Math.floor(Math.random() * 1000) + 1);
  streamingProviderId.value = roomId;
  setRoomId.disabled = true;
  signalingChannel.send(JSON.stringify({ event: 'stream-request', roomId }));
});

endBtn.addEventListener('click', () => {
  stream.getTracks().forEach(t => t.stop());
  userStream?.getTracks().forEach(t => t.stop());
  recorder?.stop();
  videoMixer?.destroy();
  audioMixer?.destroy();

  video.srcObject = null;
  video.hidden = false;
  video.classList.remove('visualyHidden');

  streamConsumerVideo.hidden = true;
});

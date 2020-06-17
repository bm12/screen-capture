import { AudioStreamMixer } from './AudioStreamMixer.js';
import { addTracksInStream, getDeviceInfo } from './utils/media.js';
import { templateParser } from './utils/string.js';
import {
  getCameraImageSizes,
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

/** @type {MediaStream} */
let screenStream = null;
/** @type {MediaStream} */
let userStream = null;
/** @type {VideoStreamMixer} */
let videoMixer = null;
/** @type {AudioStreamMixer} */
let audioMixer = null;
/** @type {RTCPeerConnection} */
let peerConn = null;
/** @type {WebSocket} */
let signalingChannel = null;

let recorder = null;
let roomId = null;

const mimeType = 'video/webm';
const USE_NATIVE_RESOLUTION = true;

const rtcConfiguration = {
  iceServers,
};

const onAddStream = (evt) => {
  console.log('Stream received from remote', evt);
  streamConsumerVideo.srcObject = evt.stream;
  streamConsumerVideo.hidden = false;

  video.hidden = true;
};

const init = () => {
  const ondevicechange = async () => {
    const { hasMicro, hasCamera } = await getDeviceInfo();

    setErrorElHidden('.micro-checkbox-wrap', hasMicro);
    setErrorElHidden('.camera-checkbox-wrap', hasCamera);
  }
  navigator.mediaDevices.addEventListener('devicechange', ondevicechange);
  ondevicechange();

  signalingChannel = new WebSocket(`wss://${window.location.host}`);
  signalingChannel.onmessage = (evt) => {
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
};

init();

startBtn.addEventListener('click', async () => {
  try {
    const screenSizes = getScreenSizes(USE_NATIVE_RESOLUTION);
    userStream = await getUserMedia(microCheckbox.checked, cameraCheckbox.checked);
    screenStream = await getDisplayMedia(audioCheckbox.checked, screenSizes);

    downloadButton.hidden = true;
    if (downloadButton.href) URL.revokeObjectURL(downloadButton.href);

    let videoStream = screenStream;
    video.srcObject = screenStream;

    if (cameraCheckbox.checked) {
      const { width, height } = screenSizes;
      const cameraSettings = userStream.getVideoTracks()[0].getSettings();

      video.hidden = true;

      const [cameraImageWidth, cameraImageHeight] = getCameraImageSizes(cameraSettings, width, height);

      videoMixer = new VideoStreamMixer({
        container: '#canvasContainer',
        previewClassName: 'previewCanvas',
        firstStreamData: {
          stream: screenStream,
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

    if (screenStream.getAudioTracks().length > 0) {
      audioMixer = new AudioStreamMixer({
        systemAudioStream: screenStream,
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

      peerConn = peerConnection;
      peerConnection.addStream(composedStream);
      createAndSendOffer(peerConnection, signalingChannel);
    } else {
      recorder = getRecorder({ stream: composedStream, mimeType });
      recorder.rec();
      const recordedBlob = await recorder.getResult();
      const today = new Date();
      const fileName = templateParser('captured-{{date}}-{{time}}.webm', {
        date: today.toDateString(),
        time: today.toTimeString().substr(0, 17).replace(':', '-'),
      });

      downloadButton.href = URL.createObjectURL(recordedBlob);
      downloadButton.download = fileName;
      downloadButton.hidden = false;
    }

    console.log(composedStream);
  } catch (err) {
    console.error(err);
  }
});

setRoomId.addEventListener('click', () => {
  roomId = streamingConsumerId.value;
  generateRoomIdBtn.disabled = true;
  signalingChannel.send(JSON.stringify({ event: 'room-request', roomId }));
});

generateRoomIdBtn.addEventListener('click', () => {
  roomId = String(Math.floor(Math.random() * 1000) + 1);
  streamingProviderId.value = roomId;
  setRoomId.disabled = true;
  signalingChannel.send(JSON.stringify({ event: 'room-request', roomId }));
});

endBtn.addEventListener('click', () => {
  screenStream.getTracks().forEach(t => t.stop());
  userStream?.getTracks().forEach(t => t.stop());
  recorder?.stop();
  videoMixer?.destroy();
  audioMixer?.destroy();

  video.srcObject = null;
  video.hidden = false;

  streamConsumerVideo.hidden = true;
});

import {
  getCameraImageSizes,
  getCapturedStream,
  getDisplayMedia,
  getRecorder,
  getUserMedia,
} from './utils/video.js';
import {
  getAnalyzer,
  getAverageVolume,
  getSourseAndGain,
  setGainAndConnectSource,
} from './utils/audio.js'
import { templateParser } from './utils/string.js'
import { VideoStreamMixer } from './VideoStreamMixer.js';

const startBtn = document.querySelector('#start-capture');
const endBtn = document.querySelector('#end-capture');
/** @type {HTMLVideoElement} */
const video = document.querySelector('#video');
/** @type {HTMLAnchorElement} */
const downloadButton = document.querySelector('#downloadButton');
/** @type {HTMLInputElement} */
const audioCheckbox = document.querySelector('#audioCheckbox');
/** @type {HTMLInputElement} */
const microCheckbox = document.querySelector('#microCheckbox');
/** @type {HTMLInputElement} */
const cameraCheckbox = document.querySelector('#cameraCheckbox');
let stream = null;
let userStream = null;
let recorder = null;
let videoMixer = null;
let stopScheduledRaf = true;

const mimeType = 'video/webm';
const USE_CAPTURED_STREAM = false;

startBtn.addEventListener('click', async () => {
  try {
    stream = await getDisplayMedia(audioCheckbox.checked);
    userStream = await getUserMedia(microCheckbox.checked, cameraCheckbox.checked);

    downloadButton.hidden = true;
    if (downloadButton.href) URL.revokeObjectURL(downloadButton.href);

    const capturedStream = USE_CAPTURED_STREAM ? getCapturedStream() : stream;
    let videoStream = capturedStream;
    video.srcObject = capturedStream;

    if (cameraCheckbox.checked) {
      const { width, height } = window.screen;
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
        sizes: { width, height },
      });
      videoMixer.init();
      videoStream = videoMixer.getVideoStream();
    }
    const composedStream = new MediaStream();

    videoStream.getVideoTracks().forEach((videoTrack) => {
      composedStream.addTrack(videoTrack);
    });

    if (capturedStream.getAudioTracks().length > 0) {
      const context = new AudioContext();
      const audioDestination = context.createMediaStreamDestination();

      const [systemSource, systemGain] = getSourseAndGain(context, capturedStream);
      setGainAndConnectSource(systemGain, systemSource, audioDestination);

      if (userStream && userStream.getAudioTracks().length > 0) {
        const [micSource, micGain] = getSourseAndGain(context, userStream);
        setGainAndConnectSource(micGain, micSource, audioDestination);

        const analyser = getAnalyzer(context);

        micSource.connect(analyser);
        function listenMicroVolume() {
          const average = getAverageVolume(analyser);

          console.log(Math.round(average));
          if (average > 30) {
            systemGain.gain.setTargetAtTime(0.32, context.currentTime, 50);
          } else {
            systemGain.gain.setTargetAtTime(1, context.currentTime, 50);
          }

          if (!stopScheduledRaf) requestAnimationFrame(listenMicroVolume);
        }
        stopScheduledRaf = false;
        listenMicroVolume();
      }

      audioDestination.stream.getAudioTracks().forEach((audioTrack) => {
        composedStream.addTrack(audioTrack);
      });
    } else {
      const micTracks = (userStream && userStream.getAudioTracks()) || [];
      if (micTracks.length > 0) {
        micTracks.forEach((micTrack) => {
          composedStream.addTrack(micTrack);
        });
      }
    }

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

    console.log(stream);
  } catch (err) {
    console.error(err);
  }
});

endBtn.addEventListener('click', () => {
  stream.getTracks().forEach(t => t.stop());
  userStream?.getTracks().forEach(t => t.stop());
  recorder.stop();
  videoMixer?.destroy();

  stopScheduledRaf = true;

  video.srcObject = null;
  video.classList.remove('visualyHidden');
});

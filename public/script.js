import {
  getAnalyzer,
  getAverageVolume,
  getCapturedStream,
  getDisplayMedia,
  getSourseAndGain,
  getUserMedia,
  setGainAndConnectSource
} from './utils.js';

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
let stream = null;
let micStream = null;
let recorder = null;
let stopGainAnalyzer = true;

const mimeType = 'video/webm';
const USE_CAPTURED_STREAM = false;

startBtn.addEventListener('click', async () => {
  try {
    stream = await getDisplayMedia(audioCheckbox.checked);
    micStream = microCheckbox.checked ?
      await getUserMedia() :
      null;

    downloadButton.hidden = true;
    if (downloadButton.href) URL.revokeObjectURL(downloadButton.href);

    const capturedStream = USE_CAPTURED_STREAM ? getCapturedStream() : stream;
    const composedStream = new MediaStream();

    capturedStream.getVideoTracks().forEach((videoTrack) => {
      composedStream.addTrack(videoTrack);
    });

    if (capturedStream.getAudioTracks().length > 0) {
      const context = new AudioContext();
      const audioDestination = context.createMediaStreamDestination();

      const [systemSource, systemGain] = getSourseAndGain(context, capturedStream);
      setGainAndConnectSource(systemGain, systemSource, audioDestination);

      if (micStream && micStream.getAudioTracks().length > 0) {
        const [micSource, micGain] = getSourseAndGain(context, micStream);
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

          if (!stopGainAnalyzer) requestAnimationFrame(listenMicroVolume);
        }
        stopGainAnalyzer = false;
        listenMicroVolume();
      }

      audioDestination.stream.getAudioTracks().forEach((audioTrack) => {
        composedStream.addTrack(audioTrack);
      });
    } else {
      const micTracks = (micStream && micStream.getAudioTracks()) || [];
      if (micTracks.length > 0) {
        micTracks.forEach((micTrack) => {
          composedStream.addTrack(micTrack);
        });
      }
    }

    video.srcObject = stream;

    recorder = new MediaRecorder(composedStream, { mimeType });

    let data = [];

    recorder.ondataavailable = event => data.push(event.data);
    recorder.start();
    recorder.onstop = () => {
      const recordedBlob = new Blob(data, { type: mimeType });
      const today = new Date();
      const fileName = `captured-${today.toDateString()}-${today.toTimeString().substr(0, 17).replace(':', '-')}.webm`;

      downloadButton.href = URL.createObjectURL(recordedBlob);
      downloadButton.download = fileName;
      downloadButton.hidden = false;
    };

    console.log(stream);
  } catch (err) {
    console.log(err);
  }
});

endBtn.addEventListener('click', () => {
  stream.getTracks().forEach(t => t.stop());
  micStream.getTracks().forEach(t => t.stop());
  recorder.stop();
  stopGainAnalyzer = true;
  video.srcObject = null;
});

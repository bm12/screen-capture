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
let recorder = null;
let stopGainAnylizer = true;

const USE_CAPTURED_STREAM = false;


const getCapturedStream = (video) => (video.captureStream || video.mozCaptureStream)();

const getAverageVolume = (analyser) => {
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

startBtn.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        logicalSurface: true,
      },
      audio: audioCheckbox.checked
    });
    micStream = microCheckbox.checked ?
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        }
      }) :
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

      const systemSource = context.createMediaStreamSource(capturedStream);
      const systemGain = context.createGain();
      systemGain.gain.value = 1.0;
      systemSource.connect(systemGain).connect(audioDestination);

      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = context.createMediaStreamSource(micStream);
        const micGain = context.createGain();
        micGain.gain.value = 1;
        micSource.connect(micGain).connect(audioDestination);

        analyser = context.createAnalyser();
        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;

        micSource.connect(analyser);
        function listenMicroVolume() {
          const average = getAverageVolume(analyser);

          console.log(Math.round(average));
          if (average > 30) {
            systemGain.gain.setTargetAtTime(0.32, context.currentTime, 50);
          } else {
            systemGain.gain.setTargetAtTime(1, context.currentTime, 50);
          }

          if (!stopGainAnylizer) requestAnimationFrame(listenMicroVolume);
        }
        stopGainAnylizer = false;
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

    recorder = new MediaRecorder(composedStream, {
      mimeType: 'video/webm'
    });
    let data = [];

    recorder.ondataavailable = event => data.push(event.data);
    recorder.start();
    recorder.onstop = () => {
      const recordedBlob = new Blob(data, { type: 'video/webm' });
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
  recorder.stop();
  stopGainAnylizer = true;
  video.srcObject = null;
});

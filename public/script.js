const startBtn = document.querySelector('#start-capture');
const endBtn = document.querySelector('#end-capture');
/** @type {HTMLVideoElement} */
const video = document.querySelector('#video');
/** @type {HTMLAnchorElement} */
const downloadButton = document.querySelector('#downloadButton');
/** @type {HTMLInputElement} */
const audioCheckbox = document.querySelector('#audioCheckbox');
let stream = null;
let recorder = null;

const USE_CAPTURED_STREAM = false;


const getCapturedStream = (video) => (video.captureStream || video.mozCaptureStream)();

startBtn.addEventListener('click', async (e) => {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          logicalSurface: true,
        },
        audio: audioCheckbox.checked
      });

      downloadButton.hidden = true;
      if (downloadButton.href) URL.revokeObjectURL(downloadButton.href);

      video.srcObject = stream;
      const capturedStream = USE_CAPTURED_STREAM ? getCapturedStream() : stream;

      recorder = new MediaRecorder(capturedStream, {
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
    } catch(err) {
      console.log(err);
    }
});

endBtn.addEventListener('click', () => {
  stream.getTracks().forEach(t => t.stop());
  recorder.stop();
  video.srcObject = null;
});

import { setGainAndConnectSource, getSourseAndGain, getAnalyzer, getAverageVolume } from './utils/audio.js'

class AudioStreamMixer {
  constructor({
    systemAudioStream,
    userAudioStream,
    microAverageVolume = 30,
  }) {
    this.systemAudioStream = systemAudioStream;
    this.userAudioStream = userAudioStream;
    this.microAverageVolume = microAverageVolume;
  }

  start() {
    this.context = new AudioContext();
    this.audioDestination = this.context.createMediaStreamDestination();
    this.audioStream = new MediaStream;

    this.createAudioTracks();
  }

  /** @private */
  createAudioTracks() {
    const { systemAudioStream, userAudioStream, context, audioDestination } = this;

    const [systemSource, systemGain] = getSourseAndGain(context, systemAudioStream);
    setGainAndConnectSource(systemGain, systemSource, audioDestination);
    this.systemGain = systemGain;

    if (userAudioStream?.getAudioTracks().length > 0) {
      const [micSource, micGain] = getSourseAndGain(context, userAudioStream);
      setGainAndConnectSource(micGain, micSource, audioDestination);

      this.analyser = getAnalyzer(context);

      micSource.connect(this.analyser);

      this.scheduleNextRaf = true;
      this.listenMicroVolume();
    }
  }

  getAudioStream = () => this.audioDestination.stream;

  /** @private */
  listenMicroVolume = () => {
    const { context, analyser, microAverageVolume, systemGain } = this;
    const average = getAverageVolume(analyser);

    if (average > microAverageVolume) {
      systemGain.gain.setTargetAtTime(0.32, context.currentTime, 50);
    } else {
      systemGain.gain.setTargetAtTime(1, context.currentTime, 50);
    }

    if (this.scheduleNextRaf) requestAnimationFrame(this.listenMicroVolume);
  };

  stop() {
    this.scheduleNextRaf = false;
  }

  destroy() {
    this.stop();
    this.context.close();
  }
}

export { AudioStreamMixer };

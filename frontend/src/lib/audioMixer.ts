const getAverageVolume = (analyser: AnalyserNode) => {
  const array = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(array);
  let values = 0;

  const length = array.length;
  for (let i = 0; i < length; i += 1) {
    values += array[i];
  }

  const average = values / length;
  return average;
};

const getSourceAndGain = (context: AudioContext, stream: MediaStream) => {
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();

  return [source, gain] as const;
};

const setGainAndConnectSource = (
  gainNode: GainNode,
  source: MediaStreamAudioSourceNode,
  audioDestination: MediaStreamAudioDestinationNode,
  gainValue = 1,
) => {
  gainNode.gain.value = gainValue;
  source.connect(gainNode).connect(audioDestination);
};

const getAnalyser = (context: AudioContext) => {
  const analyser = context.createAnalyser();
  analyser.smoothingTimeConstant = 0.8;
  analyser.fftSize = 1024;

  return analyser;
};

type AudioMixerOptions = {
  systemAudioStream: MediaStream;
  userAudioStream: MediaStream | null;
  microAverageVolume?: number;
};

export class AudioStreamMixer {
  private context: AudioContext | null = null;

  private audioDestination: MediaStreamAudioDestinationNode | null = null;

  private audioStream: MediaStream | null = null;

  private analyser: AnalyserNode | null = null;

  private systemGain: GainNode | null = null;

  private volumeIntervalId: number | null = null;

  private readonly volumeCheckIntervalMs = 150;

  private options: AudioMixerOptions;

  constructor(options: AudioMixerOptions) {
    this.options = options;
  }

  start() {
    if (this.context) {
      return;
    }

    console.log('[audio-mixer] Инициализация аудиомикшера');
    this.context = new AudioContext();
    this.audioDestination = this.context.createMediaStreamDestination();
    this.audioStream = this.audioDestination.stream;

    this.createAudioTracks();
  }

  private createAudioTracks() {
    if (!this.context || !this.audioDestination) {
      return;
    }

    const { systemAudioStream, userAudioStream, microAverageVolume = 30 } = this.options;
    const [systemSource, systemGain] = getSourceAndGain(this.context, systemAudioStream);
    setGainAndConnectSource(systemGain, systemSource, this.audioDestination);
    this.systemGain = systemGain;

    if (userAudioStream && userAudioStream.getAudioTracks().length > 0) {
      const [micSource, micGain] = getSourceAndGain(this.context, userAudioStream);
      setGainAndConnectSource(micGain, micSource, this.audioDestination);

      this.analyser = getAnalyser(this.context);
      micSource.connect(this.analyser);

      this.startVolumeMonitoring(microAverageVolume);
    }
  }

  private startVolumeMonitoring(microAverageVolume: number) {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.volumeIntervalId !== null) {
      window.clearInterval(this.volumeIntervalId);
    }

    const checkVolume = () => {
      if (!this.context || !this.analyser || !this.systemGain) {
        return;
      }

      const hasActiveMic = this.options.userAudioStream
        ?.getAudioTracks()
        .some((track) => track.enabled && track.readyState === 'live');

      if (!hasActiveMic) {
        this.systemGain.gain.setTargetAtTime(1, this.context.currentTime, 0.05);
        return;
      }

      const average = getAverageVolume(this.analyser);
      if (average > microAverageVolume) {
        this.systemGain.gain.setTargetAtTime(0.32, this.context.currentTime, 0.05);
      } else {
        this.systemGain.gain.setTargetAtTime(1, this.context.currentTime, 0.05);
      }
    };

    checkVolume();
    this.volumeIntervalId = window.setInterval(checkVolume, this.volumeCheckIntervalMs);
  }

  getAudioStream() {
    return this.audioStream;
  }

  stop() {
    if (typeof window !== 'undefined' && this.volumeIntervalId !== null) {
      window.clearInterval(this.volumeIntervalId);
      this.volumeIntervalId = null;
    }
  }

  destroy() {
    this.stop();
    if (this.context) {
      this.context.close();
      this.context = null;
    }
    this.audioDestination = null;
    this.audioStream = null;
    this.analyser = null;
    this.systemGain = null;
  }
}

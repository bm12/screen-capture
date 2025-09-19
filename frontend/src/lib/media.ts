import { DEFAULT_STREAM_FRAME_RATE, USE_NATIVE_SCREEN_RESOLUTION } from './constants';

type ScreenSizes = {
  width: number;
  height: number;
};

export const getScreenSizes = (
  useNativeResolution: boolean = USE_NATIVE_SCREEN_RESOLUTION,
): ScreenSizes => {
  const { height, width } = window.screen;
  if (!useNativeResolution) {
    return { width, height };
  }

  return {
    width: width * window.devicePixelRatio,
    height: height * window.devicePixelRatio,
  };
};

export const getDisplayMedia = async (
  withSystemAudio: boolean,
  screenSizes: ScreenSizes = getScreenSizes(),
): Promise<MediaStream> => {
  console.log('[media] Запрашиваем захват экрана', { withSystemAudio, screenSizes });
  const videoConstraints: MediaTrackConstraints & {
    cursor?: 'always' | 'motion' | 'never';
    logicalSurface?: boolean;
  } = {
    width: screenSizes.width,
    height: screenSizes.height,
    frameRate: DEFAULT_STREAM_FRAME_RATE,
    cursor: 'always',
    logicalSurface: true,
  };
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints,
    audio: withSystemAudio,
  });
  console.log('[media] Экран захвачен');
  return stream;
};

export const getUserMedia = async (
  withMicrophone: boolean,
  videoConstraints: boolean | MediaTrackConstraints,
): Promise<MediaStream | null> => {
  if (!withMicrophone && !videoConstraints) {
    return null;
  }

  console.log('[media] Запрашиваем доступ к устройствам пользователя', {
    withMicrophone,
    withCamera: Boolean(videoConstraints),
  });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: withMicrophone
      ? {
          echoCancellation: true,
          noiseSuppression: true,
        }
      : false,
    video: videoConstraints,
  });

  console.log('[media] Устройства пользователя доступны');
  return stream;
};

export const addTracksToStream = (tracks: MediaStreamTrack[], destinationStream: MediaStream) => {
  tracks.forEach((track) => {
    destinationStream.addTrack(track);
  });
};

export const getCameraImageSizes = (
  cameraSettings: MediaTrackSettings,
  canvasWidth: number,
  canvasHeight: number,
): [number, number] => {
  const { aspectRatio = 1, width: cameraWidth = 0, height: cameraHeight = 0 } = cameraSettings;
  const quarterCanvasWidth = canvasWidth / 4;
  const quarterCanvasHeight = canvasHeight / 4;

  if (cameraWidth >= cameraHeight) {
    const cameraImageWidth = cameraWidth > quarterCanvasWidth ? quarterCanvasWidth : cameraWidth;
    const cameraImageHeight = cameraImageWidth / aspectRatio;

    return [cameraImageWidth, cameraImageHeight];
  }

  const cameraImageWidth = cameraHeight > quarterCanvasHeight ? quarterCanvasHeight : cameraHeight;
  const cameraImageHeight = cameraImageWidth / aspectRatio;

  return [cameraImageWidth, cameraImageHeight];
};

export const getDeviceInfo = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const hasMicrophone = devices.some((device) => device.kind === 'audioinput');
  const hasCamera = devices.some((device) => device.kind === 'videoinput');

  return { hasMicrophone, hasCamera, devices };
};

export const stopStream = (stream: MediaStream | null | undefined) => {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
};

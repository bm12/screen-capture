export const guessFacingMode = (
  device?: MediaDeviceInfo | null,
): 'user' | 'environment' | null => {
  if (!device?.label) {
    return null;
  }
  const label = device.label.toLowerCase();
  if (label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('задн')) {
    return 'environment';
  }
  if (
    label.includes('front') ||
    label.includes('user') ||
    label.includes('face') ||
    label.includes('фронт') ||
    label.includes('лицев')
  ) {
    return 'user';
  }
  return null;
};

const MOBILE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 960, max: 1280 },
  height: { ideal: 540, max: 720 },
  frameRate: { ideal: 24, max: 30 },
};

const DEFAULT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

const CONSERVATIVE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640, max: 960 },
  height: { ideal: 360, max: 540 },
  frameRate: { ideal: 20, max: 24 },
};

const isMobileDevice = () => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
};

type NetworkQuality = 'slow' | 'unknown' | 'fast';

const getNetworkQuality = (): NetworkQuality => {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const connection =
    (navigator as Navigator & { connection?: unknown }).connection as
      | (NetworkInformation & { saveData?: boolean })
      | undefined;

  if (!connection) {
    return 'unknown';
  }

  if ('saveData' in connection && connection.saveData) {
    return 'slow';
  }

  const effectiveType = connection.effectiveType;
  if (!effectiveType) {
    return 'unknown';
  }

  if (['slow-2g', '2g', '3g'].includes(effectiveType)) {
    return 'slow';
  }

  if (effectiveType === '4g') {
    return 'fast';
  }

  return 'unknown';
};

const pickBaseVideoConstraints = (): MediaTrackConstraints => {
  const mobile = isMobileDevice();
  const networkQuality = getNetworkQuality();

  if (networkQuality === 'slow') {
    return CONSERVATIVE_VIDEO_CONSTRAINTS;
  }

  if (mobile) {
    return MOBILE_VIDEO_CONSTRAINTS;
  }

  return DEFAULT_VIDEO_CONSTRAINTS;
};

export const buildVideoConstraints = (
  deviceId?: string | null,
  facingMode?: 'user' | 'environment' | null,
): MediaTrackConstraints => {
  const baseConstraints = { ...pickBaseVideoConstraints() };

  if (deviceId) {
    return {
      ...baseConstraints,
      deviceId: { exact: deviceId },
    };
  }

  if (facingMode) {
    return {
      ...baseConstraints,
      facingMode: { exact: facingMode },
    };
  }

  return {
    ...baseConstraints,
    facingMode: 'user',
  };
};

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

export const buildVideoConstraints = (
  deviceId?: string | null,
  facingMode?: 'user' | 'environment' | null,
): MediaTrackConstraints => {
  if (deviceId) {
    return { deviceId: { exact: deviceId } };
  }
  if (facingMode) {
    return { facingMode: { exact: facingMode } };
  }
  return { facingMode: 'user' };
};

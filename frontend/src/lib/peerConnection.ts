import { getEffectiveIceServers } from './ice';

interface CreatePeerConnectionOptions {
  uid?: string;
  forceRelay?: boolean;
  configuration?: RTCConfiguration;
}

export const createPeerConnection = async (
  options: CreatePeerConnectionOptions = {},
): Promise<RTCPeerConnection> => {
  const { uid, forceRelay, configuration } = options;
  const iceServers = await getEffectiveIceServers(uid);

  const rtcConfiguration: RTCConfiguration = {
    ...configuration,
    iceServers,
  };

  if (forceRelay) {
    rtcConfiguration.iceTransportPolicy = 'relay';
  }

  return new RTCPeerConnection(rtcConfiguration);
};

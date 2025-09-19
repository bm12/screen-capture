export type ScenarioMode = 'stream' | 'call';

export type RoomParticipant = {
  clientId: string;
  role: string;
};

export type RoomJoinedPayload = {
  roomId: string;
  mode: ScenarioMode;
  role: string;
  participants: RoomParticipant[];
};

export type PeerUpdatePayload = {
  clientId: string;
  role: string;
};

export type SignalEnvelope =
  | {
      kind: 'description';
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: 'candidate';
      candidate: RTCIceCandidateInit;
    };

export type SignalMessagePayload = {
  roomId: string;
  senderId: string;
  signal: SignalEnvelope;
};

export type ErrorPayload = {
  message: string;
  details?: unknown;
};

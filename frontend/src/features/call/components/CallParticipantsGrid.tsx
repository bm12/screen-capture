import type { RefObject } from 'react';

import type { RemoteParticipant } from '../hooks/useCallPeers';

type CallParticipantsGridProps = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  remoteParticipants: RemoteParticipant[];
};

export const CallParticipantsGrid = ({
  localVideoRef,
  remoteParticipants,
}: CallParticipantsGridProps) => (
  <div className="video-grid">
    <div className="video-grid__item">
      <video ref={localVideoRef} autoPlay playsInline muted className="video-grid__video" />
      <span className="video-grid__label">Вы</span>
    </div>
    {remoteParticipants.map((participant) => (
      <div key={participant.id} className="video-grid__item">
        <video
          autoPlay
          playsInline
          ref={(element) => {
            if (element) {
              element.srcObject = participant.stream;
              element.play().catch(() => undefined);
            }
          }}
        />
        <span className="video-grid__label">{participant.id.slice(0, 6)}</span>
      </div>
    ))}
  </div>
);

import { useCallback } from 'react';
import type { RefObject } from 'react';

import type { RemoteParticipant } from '../hooks/useCallPeers';

type CallParticipantsGridProps = {
  localVideoRef: RefObject<HTMLVideoElement | null>;
  localStreamRef: RefObject<MediaStream | null>;
  remoteParticipants: RemoteParticipant[];
  containerRef: RefObject<HTMLDivElement | null>;
  isFullscreen: boolean;
};

export const CallParticipantsGrid = ({
  localVideoRef,
  localStreamRef,
  remoteParticipants,
  containerRef,
  isFullscreen,
}: CallParticipantsGridProps) => {
  const handleLocalVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      localVideoRef.current = element;
      if (!element) {
        return;
      }

      const stream = localStreamRef.current;
      if (stream && element.srcObject !== stream) {
        element.srcObject = stream;
      }

      element.muted = true;
      if (element.srcObject) {
        element.play().catch(() => undefined);
      }
    },
    [localStreamRef, localVideoRef],
  );

  if (isFullscreen && remoteParticipants.length > 0) {
    const [primaryParticipant, ...secondaryParticipants] = remoteParticipants;

    return (
      <div ref={containerRef} className="video-stage video-stage--fullscreen">
        <div className="video-stage__primary">
          <video
            autoPlay
            playsInline
            ref={(element) => {
              if (element) {
                element.srcObject = primaryParticipant.stream;
                element.play().catch(() => undefined);
              }
            }}
            className="video-stage__primary-video"
          />
          <span className="video-grid__label">{primaryParticipant.id.slice(0, 6)}</span>
        </div>

        <div className="video-stage__local-preview">
          <video
            ref={handleLocalVideoRef}
            autoPlay
            playsInline
            muted
            className="video-stage__local-video"
          />
          <span className="video-grid__label">Вы</span>
        </div>

        {secondaryParticipants.length > 0 && (
          <div className="video-stage__thumbnails">
            {secondaryParticipants.map((participant) => (
              <div key={participant.id} className="video-stage__thumbnail">
                <video
                  autoPlay
                  playsInline
                  ref={(element) => {
                    if (element) {
                      element.srcObject = participant.stream;
                      element.play().catch(() => undefined);
                    }
                  }}
                  className="video-stage__thumbnail-video"
                />
                <span className="video-grid__label">{participant.id.slice(0, 6)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="video-grid">
      <div className="video-grid__item">
        <video ref={handleLocalVideoRef} autoPlay playsInline muted className="video-grid__video" />
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
};

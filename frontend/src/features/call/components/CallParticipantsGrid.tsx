import { useCallback, useEffect, useRef, useState } from 'react';
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
  const blockedElementsRef = useRef(new Set<HTMLVideoElement>());
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const isAutoplayDeniedError = (error: unknown): error is DOMException =>
    error instanceof DOMException && error.name === 'NotAllowedError';

  const updateAutoplayBlockedState = useCallback(() => {
    setAutoplayBlocked(blockedElementsRef.current.size > 0);
  }, []);

  const attemptToPlay = useCallback(
    (element: HTMLVideoElement) => {
      let playPromise: Promise<void> | undefined;

      try {
        playPromise = element.play();
      } catch (error) {
        if (isAutoplayDeniedError(error)) {
          blockedElementsRef.current.add(element);
          updateAutoplayBlockedState();
          return;
        }

        blockedElementsRef.current.delete(element);
        updateAutoplayBlockedState();
        return;
      }

      if (!playPromise) {
        blockedElementsRef.current.delete(element);
        updateAutoplayBlockedState();
        return;
      }

      playPromise
        .then(() => {
          blockedElementsRef.current.delete(element);
          updateAutoplayBlockedState();
        })
        .catch((error) => {
          if (isAutoplayDeniedError(error)) {
            blockedElementsRef.current.add(element);
            updateAutoplayBlockedState();
            return;
          }

          blockedElementsRef.current.delete(element);
          updateAutoplayBlockedState();
        });
    },
    [updateAutoplayBlockedState],
  );

  const retryBlockedElements = useCallback(() => {
    const blockedElements = Array.from(blockedElementsRef.current);

    blockedElements.forEach((element) => {
      if (!element.isConnected) {
        blockedElementsRef.current.delete(element);
        return;
      }

      attemptToPlay(element);
    });

    updateAutoplayBlockedState();
  }, [attemptToPlay, updateAutoplayBlockedState]);

  useEffect(() => {
    if (!autoplayBlocked) {
      return;
    }

    if (typeof document === 'undefined') {
      return;
    }

    const target = containerRef.current ?? document;

    const handleInteraction = () => {
      retryBlockedElements();
    };

    target.addEventListener('click', handleInteraction);
    target.addEventListener('touchend', handleInteraction);

    retryBlockedElements();

    return () => {
      target.removeEventListener('click', handleInteraction);
      target.removeEventListener('touchend', handleInteraction);
    };
  }, [autoplayBlocked, containerRef, retryBlockedElements]);

  const clearBlockedElementById = useCallback(
    (participantId: string) => {
      let removed = false;

      blockedElementsRef.current.forEach((element) => {
        if (element.dataset?.autoplayParticipantId === participantId) {
          blockedElementsRef.current.delete(element);
          removed = true;
        }
      });

      if (removed) {
        updateAutoplayBlockedState();
      }
    },
    [updateAutoplayBlockedState],
  );

  const attachStreamToElement = useCallback(
    (element: HTMLVideoElement | null, stream: MediaStream | null | undefined) => {
      if (!element) {
        return;
      }

      const currentStream = element.srcObject as MediaStream | null;
      let streamAttached = false;

      if (stream && currentStream !== stream) {
        element.srcObject = stream;
        streamAttached = true;
      } else if (!stream) {
        blockedElementsRef.current.delete(element);
        updateAutoplayBlockedState();
      }

      if ((streamAttached || element.paused) && element.srcObject) {
        attemptToPlay(element);
      }
    },
    [attemptToPlay, updateAutoplayBlockedState],
  );

  const handleRemoteVideoElement = useCallback(
    (
      element: HTMLVideoElement | null,
      participantId: string,
      stream: MediaStream | null | undefined,
    ) => {
      if (!element) {
        clearBlockedElementById(participantId);
        return;
      }

      element.dataset.autoplayParticipantId = participantId;
      attachStreamToElement(element, stream);
    },
    [attachStreamToElement, clearBlockedElementById],
  );

  const handleLocalVideoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      const previousElement = localVideoRef.current;
      if (!element && previousElement) {
        blockedElementsRef.current.delete(previousElement);
        updateAutoplayBlockedState();
      }

      localVideoRef.current = element;

      if (!element) {
        return;
      }

      const stream = localStreamRef.current;
      element.muted = true;
      attachStreamToElement(element, stream);
    },
    [attachStreamToElement, localStreamRef, localVideoRef, updateAutoplayBlockedState],
  );

  if (isFullscreen && remoteParticipants.length > 0) {
    const [primaryParticipant, ...secondaryParticipants] = remoteParticipants;

    return (
      <div ref={containerRef} className="video-stage video-stage--fullscreen">
        {autoplayBlocked && (
          <button
            type="button"
            className="video-grid__autoplay-warning"
            onClick={retryBlockedElements}
          >
            Нажмите, чтобы включить звук участников
          </button>
        )}
        <div className="video-stage__primary">
              <video
                autoPlay
                playsInline
                ref={(element) => {
                  handleRemoteVideoElement(element, primaryParticipant.id, primaryParticipant.stream);
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
                      handleRemoteVideoElement(element, participant.id, participant.stream);
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
      {autoplayBlocked && (
        <button
          type="button"
          className="video-grid__autoplay-warning"
          onClick={retryBlockedElements}
        >
          Нажмите, чтобы включить звук участников
        </button>
      )}
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
              handleRemoteVideoElement(element, participant.id, participant.stream);
            }}
          />
          <span className="video-grid__label">{participant.id.slice(0, 6)}</span>
        </div>
      ))}
    </div>
  );
};

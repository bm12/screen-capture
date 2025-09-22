import { Alert, Button, Card, Space, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CallControls } from './components/CallControls';
import { CallParticipantsGrid } from './components/CallParticipantsGrid';
import { useCallPeers } from './hooks/useCallPeers';
import { useLocalMedia } from './hooks/useLocalMedia';

type CallRoomProps = {
  roomId: string;
};

export const CallRoom = ({ roomId }: CallRoomProps) => {
  const [messageApi, contextHolder] = message.useMessage();

  const {
    localStreamRef,
    localVideoRef,
    isMicEnabled,
    isCameraEnabled,
    videoDevices,
    shareLink,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    copyShareLink,
    setupLocalStream,
    registerStreamUpdateHandler,
    registerVideoTrackSwitchHandler,
  } = useLocalMedia({ roomId, messageApi });

  const { remoteParticipants, status, joinRoom, leaveRoom } = useCallPeers({
    roomId,
    messageApi,
    localStreamRef,
    registerStreamUpdateHandler,
    registerVideoTrackSwitchHandler,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  const handleFullscreenChange = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const currentElement = document.fullscreenElement;
    setIsFullscreen(currentElement === videoContainerRef.current);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [handleFullscreenChange]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (
      remoteParticipants.length === 0 &&
      document.fullscreenElement === videoContainerRef.current &&
      document.exitFullscreen
    ) {
      document.exitFullscreen().catch((error) =>
        console.warn('[call] Не удалось выйти из полноэкранного режима', error),
      );
    }
  }, [remoteParticipants.length]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') {
      return;
    }

    const container = videoContainerRef.current;
    if (!container) {
      return;
    }

    if (!container.requestFullscreen) {
      messageApi.warning('Ваш браузер не поддерживает полноэкранный режим.');
      return;
    }

    const isAlreadyFullscreen = document.fullscreenElement === container;

    try {
      if (isAlreadyFullscreen) {
        if (!document.exitFullscreen) {
          messageApi.warning('Ваш браузер не поддерживает выход из полноэкранного режима.');
          return;
        }
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
        await container.requestFullscreen();
      }
    } catch (error) {
      console.error('[call] Не удалось переключить полноэкранный режим', error);
      messageApi.error('Не удалось переключить полноэкранный режим.');
    }
  }, [messageApi]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        await setupLocalStream();
        if (!isMounted) {
          return;
        }
        console.log('[call] Отправляем запрос на присоединение к комнате', { roomId });
        await joinRoom();
      } catch (error) {
        console.error('[call] Ошибка инициализации', error);
        messageApi.error('Не удалось подключиться к звонку. Попробуйте обновить страницу.');
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
      leaveRoom({ close: true }).catch((error) =>
        console.error('[call] Ошибка при выходе из комнаты', error),
      );
    };
  }, [joinRoom, leaveRoom, messageApi, roomId, setupLocalStream]);

  const participantsCount = remoteParticipants.length + 1;
  const canEnterFullscreen = remoteParticipants.length > 0;

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={3}>Комнатный звонок</Typography.Title>
          <Typography.Paragraph className="card-description">
            Поделитесь ссылкой со знакомыми. Каждый участник может включать и выключать микрофон и
            камеру, а также переключать доступные камеры.
          </Typography.Paragraph>
        </div>

        <Space align="center" wrap>
          <Typography.Text className="link-copy">{shareLink}</Typography.Text>
          <Button icon={<CopyOutlined />} onClick={copyShareLink}>
            Скопировать ссылку
          </Button>
        </Space>

        <CallParticipantsGrid
          localVideoRef={localVideoRef}
          localStreamRef={localStreamRef}
          remoteParticipants={remoteParticipants}
          containerRef={videoContainerRef}
          isFullscreen={isFullscreen}
        />

        <CallControls
          isMicEnabled={isMicEnabled}
          isCameraEnabled={isCameraEnabled}
          canSwitchCamera={videoDevices.length > 0}
          onToggleMicrophone={toggleMicrophone}
          onToggleCamera={toggleCamera}
          onSwitchCamera={switchCamera}
          isFullscreen={isFullscreen}
          canToggleFullscreen={canEnterFullscreen}
          onToggleFullscreen={toggleFullscreen}
          participantsCount={participantsCount}
        />

        <Alert type="info" showIcon message={status} />
      </Space>
    </Card>
  );
};

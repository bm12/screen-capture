import { Alert, Button, Card, Space, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useEffect } from 'react';

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

        <CallParticipantsGrid localVideoRef={localVideoRef} remoteParticipants={remoteParticipants} />

        <CallControls
          isMicEnabled={isMicEnabled}
          isCameraEnabled={isCameraEnabled}
          canSwitchCamera={videoDevices.length > 0}
          onToggleMicrophone={toggleMicrophone}
          onToggleCamera={toggleCamera}
          onSwitchCamera={switchCamera}
          participantsCount={participantsCount}
        />

        <Alert type="info" showIcon message={status} />
      </Space>
    </Card>
  );
};

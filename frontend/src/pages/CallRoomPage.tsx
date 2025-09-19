import { useParams } from 'react-router-dom';
import { Typography } from 'antd';
import { CallRoom } from '../features/call/CallRoom';

export const CallRoomPage = () => {
  const { roomId = '' } = useParams();

  return (
    <div className="stack-gap">
      <Typography.Title level={2}>Комната видеозвонка</Typography.Title>
      <Typography.Paragraph className="card-description">
        Отправьте ссылку друзьям или коллегам. Чтобы попасть в комнату, достаточно открыть ссылку
        или ввести код на главной странице.
      </Typography.Paragraph>
      <CallRoom roomId={roomId.toUpperCase()} />
    </div>
  );
};

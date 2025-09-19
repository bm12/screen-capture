import { useParams } from 'react-router-dom';
import { Typography } from 'antd';
import { StreamingViewer } from '../features/streaming/StreamingViewer';

export const StreamJoinPage = () => {
  const { roomId = '' } = useParams();

  return (
    <div className="stack-gap">
      <Typography.Title level={2}>Просмотр трансляции</Typography.Title>
      <Typography.Paragraph className="card-description">
        Вы подключились по прямой ссылке. Если ведущий уже начал трансляцию, изображение появится
        автоматически. В противном случае подождите, пока ведущий начнёт показ.
      </Typography.Paragraph>
      <StreamingViewer initialRoomId={roomId.toUpperCase()} autoStart />
    </div>
  );
};

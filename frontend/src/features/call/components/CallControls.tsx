import { Button, Space, Tag, Tooltip } from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  RetweetOutlined,
  TeamOutlined,
  VideoCameraAddOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';

type CallControlsProps = {
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  canSwitchCamera: boolean;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  participantsCount: number;
};

export const CallControls = ({
  isMicEnabled,
  isCameraEnabled,
  canSwitchCamera,
  onToggleMicrophone,
  onToggleCamera,
  onSwitchCamera,
  participantsCount,
}: CallControlsProps) => (
  <Space size="middle" wrap>
    <Tooltip title={isMicEnabled ? 'Выключить микрофон' : 'Включить микрофон'}>
      <Button
        icon={isMicEnabled ? <AudioOutlined /> : <AudioMutedOutlined />}
        onClick={onToggleMicrophone}
        type={isMicEnabled ? 'default' : 'primary'}
        danger={!isMicEnabled}
      />
    </Tooltip>
    <Tooltip title={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}>
      <Button
        icon={isCameraEnabled ? <VideoCameraOutlined /> : <VideoCameraAddOutlined />}
        onClick={onToggleCamera}
        type={isCameraEnabled ? 'default' : 'primary'}
        danger={!isCameraEnabled}
      />
    </Tooltip>
    <Tooltip title="Переключить камеру">
      <Button icon={<RetweetOutlined />} onClick={onSwitchCamera} disabled={!canSwitchCamera}>
        Сменить камеру
      </Button>
    </Tooltip>
    <Tag icon={<TeamOutlined />} color="blue">
      Участников: {participantsCount}
    </Tag>
  </Space>
);

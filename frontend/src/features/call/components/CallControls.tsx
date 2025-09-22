import { Button, Space, Tag, Tooltip } from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
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
  isFullscreen: boolean;
  canToggleFullscreen: boolean;
  onToggleFullscreen: () => void;
  participantsCount: number;
};

export const CallControls = ({
  isMicEnabled,
  isCameraEnabled,
  canSwitchCamera,
  onToggleMicrophone,
  onToggleCamera,
  onSwitchCamera,
  isFullscreen,
  canToggleFullscreen,
  onToggleFullscreen,
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
    <Tooltip title={isFullscreen ? 'Свернуть из полноэкранного режима' : 'На весь экран'}>
      <Button
        icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        onClick={onToggleFullscreen}
        disabled={!canToggleFullscreen}
      >
        {isFullscreen ? 'Свернуть' : 'На весь экран'}
      </Button>
    </Tooltip>
    <Tag icon={<TeamOutlined />} color="blue">
      Участников: {participantsCount}
    </Tag>
  </Space>
);

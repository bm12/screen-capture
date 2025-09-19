import { Space } from 'antd';
import { StreamingHostPanel } from './StreamingHostPanel';
import { StreamingViewer } from './StreamingViewer';

export const StreamingPanel = () => {
  return (
    <Space direction="vertical" size="large" className="full-width">
      <div className="section-split">
        <StreamingHostPanel />
        <StreamingViewer />
      </div>
    </Space>
  );
};

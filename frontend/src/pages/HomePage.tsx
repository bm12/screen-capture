import { Tabs, Typography } from 'antd';
import type { TabsProps } from 'antd';
import { ScreenRecorderPanel } from '../features/recording/ScreenRecorderPanel';
import { StreamingPanel } from '../features/streaming/StreamingPanel';
import { CallPanel } from '../features/call/CallPanel';

const items: TabsProps['items'] = [
  {
    key: 'record',
    label: 'Запись экрана',
    children: <ScreenRecorderPanel />,
  },
  {
    key: 'stream',
    label: 'Трансляция экрана',
    children: <StreamingPanel />,
  },
  {
    key: 'call',
    label: 'Видеозвонок',
    children: <CallPanel />,
  },
];

export const HomePage = () => {
  return (
    <div className="stack-gap">
      <div>
        <Typography.Title level={2}>Центр экранных коммуникаций</Typography.Title>
        <Typography.Paragraph className="card-description">
          Выберите сценарий: запишите экран и скачайте ролик, поделитесь трансляцией по ссылке или
          создайте комнату для видеозвонка. Все инструменты работают прямо в браузере.
        </Typography.Paragraph>
      </div>
      <Tabs items={items} defaultActiveKey="record" />
    </div>
  );
};

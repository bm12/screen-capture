import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Input, Space, Typography, message } from 'antd';
import { CopyOutlined, LinkOutlined, PhoneOutlined } from '@ant-design/icons';

export const CallPanel = () => {
  const [isCreating, setIsCreating] = useState(false);
  const [callId, setCallId] = useState('');
  const [callLink, setCallLink] = useState<string | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const navigate = useNavigate();

  const createCall = async () => {
    setIsCreating(true);
    try {
      const response = await fetch('/api/calls', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error('Server responded with an error');
      }
      const data = await response.json();
      setCallId(data.roomId.toUpperCase());
      setCallLink(data.url);
      messageApi.success('Ссылка на звонок создана.');
    } catch (error) {
      console.error('Не удалось создать комнату', error);
      messageApi.error('Не удалось создать комнату. Попробуйте ещё раз.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!callLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(callLink);
      messageApi.success('Ссылка скопирована.');
    } catch (error) {
      console.error('Не удалось скопировать ссылку', error);
      messageApi.warning('Скопируйте ссылку вручную.');
    }
  };

  const joinCall = () => {
    if (!callId) {
      messageApi.warning('Введите код комнаты.');
      return;
    }
    navigate(`/call/${callId.toUpperCase()}`);
  };

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={4}>Видеозвонок</Typography.Title>
          <Typography.Paragraph className="card-description">
            Создайте комнату, отправьте ссылку коллегам или введите код, чтобы подключиться к уже
            существующему звонку.
          </Typography.Paragraph>
        </div>

        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text strong>Создать новую комнату</Typography.Text>
          <Space>
            <Button type="primary" icon={<PhoneOutlined />} loading={isCreating} onClick={createCall}>
              Создать ссылку
            </Button>
            {callLink && (
              <Button icon={<CopyOutlined />} onClick={copyLink}>
                Скопировать ссылку
              </Button>
            )}
          </Space>
          {callLink && (
            <Alert
              type="success"
              showIcon
              message="Ссылка создана"
              description={
                <Typography.Text className="link-copy">
                  <LinkOutlined /> {callLink}
                </Typography.Text>
              }
            />
          )}
        </Space>

        <Space direction="vertical" size={12} className="full-width">
          <Typography.Text strong>Подключиться по коду</Typography.Text>
          <Space.Compact className="full-width">
            <Input
              placeholder="Например, F9G2K1"
              value={callId}
              onChange={(event) => setCallId(event.target.value.toUpperCase())}
            />
            <Button type="primary" onClick={joinCall}>
              Подключиться
            </Button>
          </Space.Compact>
        </Space>
      </Space>
    </Card>
  );
};

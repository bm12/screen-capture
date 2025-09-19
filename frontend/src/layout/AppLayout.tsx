import { Layout, Typography } from 'antd';
import { Link, Outlet } from 'react-router-dom';

const { Header, Content, Footer } = Layout;

export const AppLayout = () => {
  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="app-header__inner">
          <Typography.Title level={3} className="app-header__title">
            <Link to="/">Медиацентр</Link>
          </Typography.Title>
          <Typography.Text className="app-header__subtitle">
            Запись экрана, трансляции и видеозвонки в браузере
          </Typography.Text>
        </div>
      </Header>
      <Content className="app-content">
        <Outlet />
      </Content>
      <Footer className="app-footer">
        <Typography.Text type="secondary">
          Проект для внутренних видеосессий. Работает полностью в браузере.
        </Typography.Text>
      </Footer>
    </Layout>
  );
};

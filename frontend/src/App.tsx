import { ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';

const App = () => {
  return (
    <ConfigProvider
      locale={ruRU}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  );
};

export default App;

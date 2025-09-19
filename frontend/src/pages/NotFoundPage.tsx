import { Button, Result } from 'antd';
import { Link } from 'react-router-dom';

export const NotFoundPage = () => (
  <Result
    status="404"
    title="Страница не найдена"
    subTitle="Кажется, такой страницы нет. Вернитесь на главную и выберите нужный сценарий."
    extra={
      <Button type="primary">
        <Link to="/">На главную</Link>
      </Button>
    }
  />
);

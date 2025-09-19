import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { HomePage } from './pages/HomePage';
import { StreamJoinPage } from './pages/StreamJoinPage';
import { CallRoomPage } from './pages/CallRoomPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <NotFoundPage />, // fallback for router errors
    children: [
      { index: true, element: <HomePage /> },
      { path: 'stream/:roomId', element: <StreamJoinPage /> },
      { path: 'call/:roomId', element: <CallRoomPage /> },
    ],
  },
]);

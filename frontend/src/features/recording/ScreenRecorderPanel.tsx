import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  addTracksToStream,
  getCameraImageSizes,
  getDeviceInfo,
  getDisplayMedia,
  getScreenSizes,
  getUserMedia,
  stopStream,
} from '../../lib/media';
import { AudioStreamMixer } from '../../lib/audioMixer';
import { VideoStreamMixer } from '../../lib/videoMixer';
import { createRecorder } from '../../lib/recorder';
import { RECORDER_MIME_TYPE } from '../../lib/constants';

export const ScreenRecorderPanel = () => {
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(true);
  const [includeCamera, setIncludeCamera] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string>('');
  const [deviceInfo, setDeviceInfo] = useState({ hasMicrophone: true, hasCamera: true });

  const [messageApi, contextHolder] = message.useMessage();

  const screenStreamRef = useRef<MediaStream | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const audioMixerRef = useRef<AudioStreamMixer | null>(null);
  const videoMixerRef = useRef<VideoStreamMixer | null>(null);
  const cleanupRef = useRef<(preserveDownload?: boolean) => void>(() => {});

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  const downloadDisabled = useMemo(() => !downloadUrl, [downloadUrl]);

  const updateDeviceInfo = async () => {
    try {
      const info = await getDeviceInfo();
      setDeviceInfo({ hasMicrophone: info.hasMicrophone, hasCamera: info.hasCamera });
    } catch (error) {
      console.error('Не удалось получить информацию об устройствах', error);
    }
  };

  useEffect(() => {
    updateDeviceInfo();
    const handleDeviceChange = () => updateDeviceInfo();
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      cleanupRef.current(true);
    };
  }, []);

  useEffect(() => {
    if (!deviceInfo.hasMicrophone) {
      setIncludeMicrophone(false);
    }
    if (!deviceInfo.hasCamera) {
      setIncludeCamera(false);
    }
  }, [deviceInfo.hasCamera, deviceInfo.hasMicrophone]);

  cleanupRef.current = (preserveDownload = false) => {
    console.log('[recorder] Очистка ресурсов', { preserveDownload });
    stopStream(screenStreamRef.current);
    stopStream(userStreamRef.current);
    stopStream(composedStreamRef.current);

    audioMixerRef.current?.destroy();
    audioMixerRef.current = null;

    videoMixerRef.current?.destroy();
    videoMixerRef.current = null;

    recorderRef.current = null;
    screenStreamRef.current = null;
    userStreamRef.current = null;
    composedStreamRef.current = null;

    if (!preserveDownload && downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setDownloadName('');
    }

    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  };

  const cleanup = (preserveDownload = false) => {
    cleanupRef.current(preserveDownload);
  };

  const startRecording = async () => {
    if (isRecording) {
      return;
    }

    setIsLoading(true);
    try {
      console.log('[recorder] Запуск записи', {
        includeSystemAudio,
        includeMicrophone,
        includeCamera,
      });

      const screenSizes = getScreenSizes();
      const displayStream = await getDisplayMedia(includeSystemAudio, screenSizes);
      const userStream = await getUserMedia(includeMicrophone, includeCamera);

      screenStreamRef.current = displayStream;
      userStreamRef.current = userStream;

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = displayStream;
        previewVideoRef.current.muted = true;
        previewVideoRef.current.playsInline = true;
        await previewVideoRef.current.play().catch(() => undefined);
      }

      let videoSource: MediaStream = displayStream;

      if (includeCamera && userStream && cameraVideoRef.current && screenVideoRef.current) {
        const videoTrack = userStream.getVideoTracks()[0];
        if (!videoTrack) {
          messageApi.warning('Камера не передает изображение. Запись продолжится без неё.');
        } else {
          const cameraSettings = videoTrack.getSettings();
          const [cameraWidth, cameraHeight] = getCameraImageSizes(
            cameraSettings,
            screenSizes.width,
            screenSizes.height,
          );

          const container = canvasContainerRef.current ?? document.body;
          videoMixerRef.current = new VideoStreamMixer({
            container,
            firstStream: {
              stream: displayStream,
              videoElement: screenVideoRef.current,
              width: screenSizes.width,
              height: screenSizes.height,
            },
            secondStream: {
              stream: userStream,
              videoElement: cameraVideoRef.current,
              width: cameraWidth,
              height: cameraHeight,
              left: screenSizes.width - cameraWidth - 32,
              top: screenSizes.height - cameraHeight - 32,
            },
            sizes: screenSizes,
            previewClassName: 'previewCanvas',
          });
          videoMixerRef.current.init();
          const mixedStream = videoMixerRef.current.getVideoStream();
          if (mixedStream) {
            videoSource = mixedStream;
            if (previewVideoRef.current) {
              previewVideoRef.current.srcObject = mixedStream;
            }
          }
        }
      }

      const composedStream = new MediaStream();
      addTracksToStream(videoSource.getVideoTracks(), composedStream);

      if (displayStream.getAudioTracks().length > 0) {
        audioMixerRef.current = new AudioStreamMixer({
          systemAudioStream: displayStream,
          userAudioStream: userStream,
        });
        audioMixerRef.current.start();
        const audioStream = audioMixerRef.current.getAudioStream();
        if (audioStream) {
          addTracksToStream(audioStream.getAudioTracks(), composedStream);
        }
      } else if (userStream) {
        addTracksToStream(userStream.getAudioTracks(), composedStream);
      }

      composedStreamRef.current = composedStream;

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = composedStream;
        await previewVideoRef.current.play().catch(() => undefined);
      }

      recorderRef.current = createRecorder({ stream: composedStream, mimeType: RECORDER_MIME_TYPE });
      recorderRef.current.start();

      setIsRecording(true);
      messageApi.success('Запись началась. Когда закончите, нажмите «Остановить запись».');
    } catch (error) {
      console.error('Не удалось запустить запись', error);
      messageApi.error('Не удалось начать запись. Проверьте права на доступ к экрану.');
      cleanup();
    } finally {
      setIsLoading(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording || !recorderRef.current) {
      return;
    }

    setIsRecording(false);
    recorderRef.current.stop();

    try {
      const result = await recorderRef.current.getResult();
      const fileName = `screen-record-${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.webm`;
      const url = URL.createObjectURL(result);

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }

      setDownloadUrl(url);
      setDownloadName(fileName);
      messageApi.success('Запись сохранена. Файл готов к скачиванию.');
    } catch (error) {
      console.error('Ошибка при завершении записи', error);
      messageApi.error('Не удалось сохранить запись.');
    } finally {
      cleanup(true);
    }
  };

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div className="stack-gap">
          <div>
            <Typography.Title level={4}>Запись экрана в файл</Typography.Title>
            <Typography.Paragraph className="card-description">
              Выберите источники звука и изображения, начните запись, а затем скачайте готовый файл.
              Все операции происходят локально на вашем компьютере.
            </Typography.Paragraph>
          </div>
          {!deviceInfo.hasMicrophone && (
            <Alert
              type="warning"
              message="Микрофон не обнаружен"
              description="Голос не будет записан. Подключите микрофон и обновите страницу, если хотите записывать звук."
              showIcon
            />
          )}
          {!deviceInfo.hasCamera && (
            <Alert
              type="info"
              message="Камера не обнаружена"
              description="Видео с камеры не будет встроено в запись."
              showIcon
            />
          )}
          <div>
            <Typography.Text strong>Что включить в запись</Typography.Text>
            <Space size={[12, 12]} wrap style={{ marginTop: 12 }}>
              <Checkbox
                checked={includeSystemAudio}
                onChange={(event) => setIncludeSystemAudio(event.target.checked)}
              >
                Системный звук
              </Checkbox>
              <Tooltip title={deviceInfo.hasMicrophone ? '' : 'Подключите микрофон'}>
                <Checkbox
                  checked={includeMicrophone}
                  disabled={!deviceInfo.hasMicrophone}
                  onChange={(event) => setIncludeMicrophone(event.target.checked)}
                >
                  Микрофон
                </Checkbox>
              </Tooltip>
              <Tooltip title={deviceInfo.hasCamera ? '' : 'Камера не найдена'}>
                <Checkbox
                  checked={includeCamera}
                  disabled={!deviceInfo.hasCamera}
                  onChange={(event) => setIncludeCamera(event.target.checked)}
                >
                  Камера поверх экрана
                </Checkbox>
              </Tooltip>
            </Space>
          </div>
        </div>

        <div className="video-preview">
          <video ref={previewVideoRef} autoPlay muted playsInline controls={false} />
          <div ref={canvasContainerRef} />
          <video ref={screenVideoRef} className="hidden-video" muted playsInline />
          <video ref={cameraVideoRef} className="hidden-video" muted playsInline />
        </div>

        <Space size="middle" wrap>
          <Button
            type="primary"
            onClick={startRecording}
            disabled={isRecording}
            loading={isLoading}
          >
            Начать запись
          </Button>
          <Button danger onClick={stopRecording} disabled={!isRecording}>
            Остановить запись
          </Button>
          {isRecording && <Tag color="processing">Запись идёт</Tag>}
        </Space>

        <Divider />

        <Space direction="vertical" size={12}>
          <Typography.Text strong>Сохранение результата</Typography.Text>
          <Typography.Paragraph className="status-text">
            После остановки записи появится ссылка на скачивание файла в формате WEBM.
          </Typography.Paragraph>
          <Button type="default" disabled={downloadDisabled} href={downloadUrl ?? undefined} download={downloadName}>
            Скачать «{downloadName || 'запись'}»
          </Button>
        </Space>
      </Space>
    </Card>
  );
};

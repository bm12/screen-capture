export type RecorderController = {
  start: () => void;
  stop: () => void;
  getResult: () => Promise<Blob>;
  recorder: MediaRecorder;
};

export const createRecorder = ({
  stream,
  mimeType,
}: {
  stream: MediaStream;
  mimeType: string;
}): RecorderController => {
  const recorder = new MediaRecorder(stream, { mimeType });
  const data: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      data.push(event.data);
    }
  };

  const resultPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const recordedBlob = new Blob(data, { type: mimeType });
        resolve(recordedBlob);
      } catch (error) {
        reject(error);
      }
    };

    recorder.onerror = (event) => {
      reject(event.error);
    };
  });

  return {
    recorder,
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    getResult: () => resultPromise,
  };
};

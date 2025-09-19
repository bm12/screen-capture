export type RecorderController = {
  start: () => void;
  stop: () => void;
  getResult: () => Promise<Blob>;
  recorder: MediaRecorder;
  mimeType: string | null;
};

export const createRecorder = ({
  stream,
  mimeType,
  fallbackMimeTypes = [],
}: {
  stream: MediaStream;
  mimeType?: string;
  fallbackMimeTypes?: string[];
}): RecorderController => {
  const candidates = [mimeType, ...fallbackMimeTypes].filter(
    (value): value is string => Boolean(value),
  );

  const orderedCandidates = typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function'
      ? candidates.filter((candidate) => MediaRecorder.isTypeSupported(candidate))
      : candidates;

  let recorder: MediaRecorder | null = null;
  let selectedMimeType: string | null = null;

  for (const candidate of orderedCandidates) {
    try {
      recorder = new MediaRecorder(stream, { mimeType: candidate });
      selectedMimeType = candidate;
      break;
    } catch (error) {
      console.warn('[recorder] MIME-тип не поддерживается', { candidate, error });
    }
  }

  if (!recorder) {
    try {
      recorder = new MediaRecorder(stream);
      selectedMimeType = recorder.mimeType ?? null;
    } catch (error) {
      console.error('[recorder] Не удалось создать MediaRecorder', error);
      throw error;
    }
  }

  const data: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      data.push(event.data);
    }
  };

  const resultPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const recordedBlob = new Blob(data, { type: selectedMimeType ?? undefined });
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
    mimeType: selectedMimeType,
    start: () => recorder.start(),
    stop: () => recorder.stop(),
    getResult: () => resultPromise,
  };
};

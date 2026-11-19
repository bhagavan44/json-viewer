import {
  JsonWorkerMessage,
  JsonWorkerResponse,
  handleJsonRequest,
} from './utils/json-worker-handler';

// Compare and schema validation of large documents run here, off the main thread.
addEventListener('message', ({ data }: MessageEvent<JsonWorkerMessage>) => {
  const response: JsonWorkerResponse = { id: data.id, reply: handleJsonRequest(data.request) };
  postMessage(response);
});

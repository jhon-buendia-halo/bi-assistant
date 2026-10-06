import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface OtlpRequest {
  path: string;
  contentType: string;
  body: Buffer;
}

/** A local stand-in for an OTLP/HTTP receiver: answers 200 and records every request. */
export interface OtlpReceiver {
  url: string;
  requests: OtlpRequest[];
  /** Requests to `path` with a non-empty body. */
  received(path: string): OtlpRequest[];
  close(): Promise<void>;
}

export async function startOtlpReceiver(): Promise<OtlpReceiver> {
  const requests: OtlpRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        path: request.url ?? '',
        contentType: String(request.headers['content-type'] ?? ''),
        body: Buffer.concat(chunks),
      });
      response.statusCode = 200;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    received: (path) =>
      requests.filter((r) => r.path === path && r.body.length > 0),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

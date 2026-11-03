import http from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * A local OpenAI-compatible `/v1/embeddings` endpoint standing in for
 * `text-embedding-3-small`, the memory's embedding model (agents.md 2.1).
 * The app reaches it when started with `OPENAI_BASE_URL` set to `baseUrl`
 * and any `OPENAI_API_KEY`: the framework's OpenAI provider reads both from
 * the environment. Every text it embeds is recorded, so a test can tell
 * whether the memory was called at all.
 *
 * The vectors are a bag of the content words of a signal's question (or of
 * the whole text), as the backend's stub embedder in
 * `mastra-learning-store.spec.ts` builds them: two questions sharing their
 * content words score high, unrelated ones near 0. A test that needs two
 * texts to mean the same (a question in another language) gives `embed`
 * its own rule. Whether a real model finds them is the memory eval's
 * question (BA-190), not this suite's.
 */

export interface EmbeddingsStub {
  /** The value of `OPENAI_BASE_URL` (ends in `/v1`). */
  baseUrl: string;
  /** Every text embedded, oldest first. */
  inputs: string[];
  /** The vector of one text; the default is `bagOfWords`. */
  embed: (text: string) => number[];
  /**
   * Optional: a promise the stub awaits before answering a request whose
   * texts are `inputs` (they are recorded at once). Lets a test make the
   * memory slow.
   */
  hold?: (inputs: string[]) => Promise<void> | undefined;
  close(): Promise<void>;
}

/** `text-embedding-3-small` has 1536 dimensions. */
export const EMBEDDING_DIMENSIONS = 1536;

const STOP_WORDS = new Set(
  'a an the of in at on to by for and or is was were did do does who what which how many much'.split(
    ' ',
  ),
);

/** The question of a signal's text, else the whole text. */
function questionOf(text: string): string {
  // The framework joins a text's words with single spaces before it embeds.
  return (
    /Question: (.*?)(?=\s+(?:Approved|Rejected|Corrected) SQL|$)/s.exec(
      text,
    )?.[1] ?? text
  );
}

/** A unit vector with one count per content word, hashed into a dimension. */
export function bagOfWords(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = 0.01;
  for (const word of questionOf(text)
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? []) {
    if (STOP_WORDS.has(word)) continue;
    let hash = 7;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[1 + (hash % (EMBEDDING_DIMENSIONS - 1))] += 1;
  }
  return unit(vector);
}

/** The same unit vector for every text of one topic (dimension `topic`). */
export function topicVector(topic: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[topic] = 1;
  return vector;
}

function unit(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

export async function startEmbeddingsStub(): Promise<EmbeddingsStub> {
  const stub: EmbeddingsStub = {
    baseUrl: '',
    inputs: [],
    embed: bagOfWords,
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (data: Buffer) => chunks.push(data));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/embeddings')) {
        res.writeHead(404).end();
        return;
      }
      let body: { input?: unknown } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        res.writeHead(400).end();
        return;
      }
      const inputs = (
        Array.isArray(body.input) ? body.input : [body.input]
      ).map((value) => String(value ?? ''));
      stub.inputs.push(...inputs);
      const answer = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: inputs.map((text, index) => ({
              object: 'embedding',
              index,
              embedding: stub.embed(text),
            })),
            model: 'text-embedding-3-small',
            usage: {
              prompt_tokens: inputs.length,
              total_tokens: inputs.length,
            },
          }),
        );
      };
      const held = stub.hold?.(inputs);
      if (held) {
        void held.then(answer, () => res.destroy());
        return;
      }
      answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${port}/v1`;
  stub.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}

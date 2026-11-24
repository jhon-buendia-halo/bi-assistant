import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UsageError,
  clockTime,
  cuesToVtt,
  parseArgs,
  parseCues,
  renderPage,
  renderSummary,
  vttTime,
} from './walkthrough-lib.mjs';

const REQUIRED = ['--spec', 'e2e/x.spec.ts', '--grep', 'A run', '--title', 'T', '--summary', 's.md', '--out', '.context/artifacts/w'];

test('parseArgs reads every option and defaults the language to Spanish', () => {
  const opts = parseArgs([...REQUIRED, '--narration', 'n.json', '--keep-video']);
  assert.equal(opts.spec, 'e2e/x.spec.ts');
  assert.equal(opts.narration, 'n.json');
  assert.equal(opts.lang, 'es');
  assert.equal(opts.keepVideo, true);
});

test('parseArgs refuses a missing required option, an unknown one and a missing value', () => {
  assert.throws(() => parseArgs(REQUIRED.slice(2)), UsageError);
  assert.throws(() => parseArgs([...REQUIRED, '--nope', 'x']), UsageError);
  assert.throws(() => parseArgs([...REQUIRED, '--lang']), UsageError);
});

test('parseCues sorts the cues and ends each one before the next starts', () => {
  const lines = [
    JSON.stringify({ start: 5, end: 9, text: 'second' }),
    '',
    JSON.stringify({ start: 1, end: 6, text: 'first' }),
    JSON.stringify({ start: 'x', end: 2, text: 'bad' }),
  ].join('\n');
  assert.deepEqual(parseCues(lines), [
    { start: 1, end: 5, text: 'first' },
    { start: 5, end: 9, text: 'second' },
  ]);
});

test('a cue lasts at least half a second', () => {
  assert.deepEqual(parseCues(JSON.stringify({ start: 2, end: 2, text: 'x' })), [{ start: 2, end: 2.5, text: 'x' }]);
});

test('times read as WebVTT and as a clock', () => {
  assert.equal(vttTime(3723.456), '01:02:03.456');
  assert.equal(clockTime(75.9), '1:15');
  assert.equal(
    cuesToVtt([{ start: 0, end: 1.5, text: 'Hola' }]),
    'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHola\n',
  );
});

test('the summary renders headings, bullets, paragraphs, code and bold, escaped', () => {
  const html = renderSummary('## Qué cambió\n- Una run **en cola** `queued`\n- <b>x</b>\n\nTexto\nseguido');
  assert.equal(
    html,
    '<h2>Qué cambió</h2>\n<ul>\n<li>Una run <strong>en cola</strong> <code>queued</code></li>\n<li>&lt;b&gt;x&lt;/b&gt;</li>\n</ul>\n<p>Texto seguido</p>',
  );
});

test('the page embeds the video, the cues and a transcript, and escapes the title', () => {
  const html = renderPage({
    title: 'Cola <durable>',
    summaryMarkdown: 'Hecho.',
    videoBase64: 'AAAA',
    cues: [{ start: 0, end: 2, text: 'Una run espera </script>' }],
    lang: 'es',
  });
  assert.match(html, /<html lang="es">/);
  assert.match(html, /<h1>Cola &lt;durable&gt;<\/h1>/);
  assert.match(html, /src="data:video\/webm;base64,AAAA"/);
  assert.match(html, /<span class="t">0:00<\/span> Una run espera &lt;\/script&gt;/);
  // The cue JSON cannot close the script element.
  assert.doesNotMatch(html, /espera <\/script>/);
});

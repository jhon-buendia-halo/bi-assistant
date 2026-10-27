import { join } from 'path';
import {
  BACKEND_DIR,
  dataDirFrom,
  LoopInputError,
  parseFlags,
  resolveUserPath,
  runCommand,
} from './cli-args';

const SPEC = { before: 'string', tsv: 'boolean' } as const;

describe('loop command flags (agents-evals R225)', () => {
  it('reads values, = values and switches', () => {
    expect(parseFlags(['--before', 'a,b', '--tsv'], SPEC, 'u')).toEqual({
      before: 'a,b',
      tsv: true,
    });
    expect(parseFlags(['--before=x'], SPEC, 'u')).toEqual({ before: 'x' });
  });

  it('refuses unknown flags, bare arguments, repeats and missing values', () => {
    const bad = [
      ['--nope'],
      ['before'],
      ['--before', 'a', '--before', 'b'],
      ['--before'],
      ['--before', '--tsv'],
      ['--tsv=1'],
    ];
    for (const argv of bad) {
      expect(() => parseFlags(argv, SPEC, 'the usage')).toThrow(LoopInputError);
    }
    expect(() => parseFlags(['--nope'], SPEC, 'the usage')).toThrow(
      'Unknown flag "--nope"\nUsage: the usage',
    );
  });

  it('resolves typed paths where npm was started (INIT_CWD)', () => {
    expect(resolveUserPath('runs/a.json', { INIT_CWD: '/repo' })).toBe(
      '/repo/runs/a.json',
    );
    expect(resolveUserPath('/abs/a.json', { INIT_CWD: '/repo' })).toBe(
      '/abs/a.json',
    );
  });

  it('takes the data dir from --data-dir, else APP_DATA_DIR, else backend/data', () => {
    expect(dataDirFrom('d', { INIT_CWD: '/repo', APP_DATA_DIR: '/x' })).toBe(
      '/repo/d',
    );
    expect(dataDirFrom(undefined, { APP_DATA_DIR: '/x' })).toBe('/x');
    expect(dataDirFrom(undefined, {})).toBe(join(BACKEND_DIR, 'data'));
  });

  it('maps a refused input to exit 2 and a crash to exit 1', async () => {
    const err: string[] = [];
    const io = { out: () => undefined, err: (l: string) => err.push(l) };
    await expect(
      runCommand(io, () => {
        throw new LoopInputError('bad');
      }),
    ).resolves.toBe(2);
    await expect(
      runCommand(io, () => {
        throw new Error('boom');
      }),
    ).resolves.toBe(1);
    await expect(runCommand(io, () => 0)).resolves.toBe(0);
    expect(err[0]).toBe('bad');
  });
});

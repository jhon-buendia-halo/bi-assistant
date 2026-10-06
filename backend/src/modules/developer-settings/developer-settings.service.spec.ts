import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_DEVELOPER_SETTINGS,
  DEVELOPER_SETTINGS_FILE,
  normalizeEndpoint,
  readDeveloperSettings,
  resetStartupDeveloperSettings,
} from '../../infrastructure/developer-settings/developer-settings.file';
import { DeveloperSettingsService } from './developer-settings.service';

describe('DeveloperSettingsService', () => {
  let dataDir: string;
  const previousDataDir = process.env.APP_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'qti-developer-settings-'));
    process.env.APP_DATA_DIR = dataDir;
    resetStartupDeveloperSettings();
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    resetStartupDeveloperSettings();
    if (previousDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDataDir;
  });

  const file = () => join(dataDir, DEVELOPER_SETTINGS_FILE);

  it('reports the defaults and no restart when nothing is saved', () => {
    const service = new DeveloperSettingsService();
    service.onModuleInit();

    expect(service.getView()).toEqual({
      saved: DEFAULT_DEVELOPER_SETTINGS,
      active: DEFAULT_DEVELOPER_SETTINGS,
      restartRequired: false,
    });
  });

  it('saves to the file and requires a restart until the active copy matches', () => {
    const service = new DeveloperSettingsService();
    service.onModuleInit();

    const view = service.save({
      observabilityEnabled: true,
      phoenixEndpoint: ' http://localhost:6006/ ',
      otlpEndpoint: 'http://localhost:4318',
    });

    expect(view.saved).toEqual({
      observabilityEnabled: true,
      phoenixEndpoint: 'http://localhost:6006',
      otlpEndpoint: 'http://localhost:4318',
    });
    expect(view.active.observabilityEnabled).toBe(false);
    expect(view.restartRequired).toBe(true);
    const onDisk = JSON.parse(readFileSync(file(), 'utf8')) as {
      observabilityEnabled: boolean;
      updatedAt: unknown;
    };
    expect(onDisk.observabilityEnabled).toBe(true);
    expect(typeof onDisk.updatedAt).toBe('string');

    // A new process (restart) reads the saved file as its active copy.
    resetStartupDeveloperSettings();
    expect(service.getView().restartRequired).toBe(false);
  });

  it('no longer requires a restart when the save matches the active copy again', () => {
    const service = new DeveloperSettingsService();
    service.onModuleInit();
    service.save({ ...DEFAULT_DEVELOPER_SETTINGS, observabilityEnabled: true });

    const view = service.save({ ...DEFAULT_DEVELOPER_SETTINGS });

    expect(view.restartRequired).toBe(false);
  });

  it('rejects endpoints that are not http(s) URLs and keeps the saved setting', () => {
    const service = new DeveloperSettingsService();

    expect(() =>
      service.save({ ...DEFAULT_DEVELOPER_SETTINGS, phoenixEndpoint: 'nope' }),
    ).toThrow('Phoenix endpoint must be an http(s) URL');
    expect(() =>
      service.save({
        ...DEFAULT_DEVELOPER_SETTINGS,
        otlpEndpoint: 'ftp://localhost:4318',
      }),
    ).toThrow('OTLP endpoint must be an http(s) URL');
    expect(() => readFileSync(file())).toThrow();
  });

  it('falls back to defaults for a malformed file or invalid values', () => {
    writeFileSync(file(), '{ not json');
    expect(readDeveloperSettings(dataDir)).toEqual(DEFAULT_DEVELOPER_SETTINGS);

    writeFileSync(
      file(),
      JSON.stringify({
        observabilityEnabled: 'yes',
        phoenixEndpoint: 'http://phoenix:6006',
        otlpEndpoint: 42,
      }),
    );
    expect(readDeveloperSettings(dataDir)).toEqual({
      observabilityEnabled: false,
      phoenixEndpoint: 'http://phoenix:6006',
      otlpEndpoint: DEFAULT_DEVELOPER_SETTINGS.otlpEndpoint,
    });
  });

  it('normalizes endpoints', () => {
    expect(normalizeEndpoint('https://x.example.com//')).toBe(
      'https://x.example.com',
    );
    expect(normalizeEndpoint('')).toBeNull();
    expect(normalizeEndpoint('localhost:4318')).toBeNull();
  });

  describe('testEndpoint', () => {
    let server: Server | null = null;

    afterEach(async () => {
      if (server) await new Promise((r) => server!.close(r));
      server = null;
    });

    async function listen(status: number): Promise<string> {
      server = createServer((req, res) => {
        req.resume();
        res.statusCode = req.url === '/v1/traces' ? status : 404;
        res.end();
      });
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    it('reports a receiver that accepts the empty export as reachable', async () => {
      const endpoint = await listen(200);
      const result = await new DeveloperSettingsService().testEndpoint(
        endpoint,
      );
      expect(result.ok).toBe(true);
      expect(result.message).toMatch(
        new RegExp(
          `^Reachable — ${endpoint} accepted an OTLP trace export in \\d+ms$`,
        ),
      );
    });

    it('reports a non-2xx answer', async () => {
      const endpoint = await listen(415);
      await expect(
        new DeveloperSettingsService().testEndpoint(endpoint),
      ).resolves.toEqual({
        ok: false,
        message: 'Endpoint answered 415 — not an OTLP trace receiver',
      });
    });

    it('reports a closed port as unreachable', async () => {
      const endpoint = await listen(200);
      await new Promise((r) => server!.close(r));
      server = null;
      const result = await new DeveloperSettingsService().testEndpoint(
        endpoint,
      );
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/^Unreachable — /);
    });

    it('rejects a value that is not a URL without probing', async () => {
      await expect(
        new DeveloperSettingsService().testEndpoint('not a url'),
      ).resolves.toEqual({
        ok: false,
        message: 'Endpoint must be an http(s) URL',
      });
    });
  });
});

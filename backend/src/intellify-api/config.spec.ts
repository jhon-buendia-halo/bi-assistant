import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { intellifyApiConfig, parseApiKeys, readOrCreateApiKey } from './config';

describe('intellifyApiConfig', () => {
  it('uses the documented defaults', () => {
    expect(intellifyApiConfig({})).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 3100,
      apiKeys: [],
      db: {
        host: '127.0.0.1',
        port: 55432,
        database: 'intellify_mercer_demo',
        user: 'world_cup',
        password: 'world_cup_dev',
        ssl: false,
        schema: 'intellify',
      },
    });
  });

  it('reads overrides, WORLD_CUP_DB_PORT as the DB port fallback', () => {
    const config = intellifyApiConfig({
      INTELLIFY_API: 'off',
      INTELLIFY_API_PORT: '0',
      INTELLIFY_API_KEY: 'a, b ,',
      WORLD_CUP_DB_PORT: '55999',
      INTELLIFY_DB_SSL: 'true',
    });
    expect(config).toMatchObject({
      enabled: false,
      port: 0,
      apiKeys: ['a', 'b'],
      db: { port: 55999, ssl: true },
    });
    expect(
      intellifyApiConfig({ WORLD_CUP_DB_PORT: '1', INTELLIFY_DB_PORT: '2' }).db
        .port,
    ).toBe(2);
  });

  it('rejects an invalid port', () => {
    expect(() => intellifyApiConfig({ INTELLIFY_API_PORT: '70000' })).toThrow(
      /INTELLIFY_API_PORT/,
    );
  });

  it('parseApiKeys splits and trims', () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys(' x ,y')).toEqual(['x', 'y']);
  });
});

describe('readOrCreateApiKey', () => {
  it('creates a 0600 key file once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intellify-key-'));
    const key = readOrCreateApiKey(dir);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const file = join(dir, '.intellify-api-key');
    expect(readFileSync(file, 'utf8')).toBe(key);
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(readOrCreateApiKey(dir)).toBe(key);
  });

  it('reads an existing key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intellify-key-'));
    writeFileSync(join(dir, '.intellify-api-key'), 'existing\n');
    expect(readOrCreateApiKey(dir)).toBe('existing');
    expect(existsSync(join(dir, '.intellify-api-key'))).toBe(true);
  });
});

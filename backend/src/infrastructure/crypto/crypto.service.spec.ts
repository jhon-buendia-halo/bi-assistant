import { createCipheriv, createHash, randomBytes } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CryptoService, UnreadableSecretError } from './crypto.service';

/** Ciphertext as the backend wrote it when it fell back to the fixed secret. */
function sealWithFormerDevelopmentSecret(plaintext: string): string {
  const key = createHash('sha256').update('insecure-dev-secret').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString('base64'))
    .join(':');
}

describe('CryptoService', () => {
  const saved = {
    secret: process.env.APP_SECRET,
    dir: process.env.APP_DATA_DIR,
  };
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'qti-crypto-'));
    process.env.APP_DATA_DIR = dataDir;
    delete process.env.APP_SECRET;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (saved.secret === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = saved.secret;
    if (saved.dir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = saved.dir;
  });

  it('round-trips a value', () => {
    const crypto = new CryptoService();
    expect(crypto.decrypt(crypto.encrypt('sk-secret'))).toBe('sk-secret');
  });

  describe('without APP_SECRET', () => {
    it('creates an owner-only .app-secret in the data dir', () => {
      new CryptoService();

      const secretPath = join(dataDir, '.app-secret');
      expect(readFileSync(secretPath, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
      expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    });

    it('reuses the persisted secret on the next start', () => {
      const ciphertext = new CryptoService().encrypt('sk-secret');

      expect(new CryptoService().decrypt(ciphertext)).toBe('sk-secret');
    });

    it('never encrypts with the former development secret', () => {
      const ciphertext = new CryptoService().encrypt('sk-secret');
      process.env.APP_SECRET = 'insecure-dev-secret';

      expect(() => new CryptoService().decrypt(ciphertext)).toThrow(
        UnreadableSecretError,
      );
    });
  });

  it('prefers APP_SECRET and does not write the file', () => {
    process.env.APP_SECRET = 'from-the-environment';

    const ciphertext = new CryptoService().encrypt('sk-secret');

    expect(() => readFileSync(join(dataDir, '.app-secret'))).toThrow();
    expect(new CryptoService().decrypt(ciphertext)).toBe('sk-secret');
  });

  it('throws UnreadableSecretError for a value sealed with another secret', () => {
    process.env.APP_SECRET = 'first';
    const ciphertext = new CryptoService().encrypt('sk-secret');
    process.env.APP_SECRET = 'second';

    expect(() => new CryptoService().decrypt(ciphertext)).toThrow(
      UnreadableSecretError,
    );
  });

  describe('reencryptFormerSecret', () => {
    it('re-encrypts a value sealed with the former development secret', () => {
      process.env.APP_SECRET = 'real-secret';
      const crypto = new CryptoService();
      const former = sealWithFormerDevelopmentSecret('sk-legacy');

      const migrated = crypto.reencryptFormerSecret(former);

      expect(migrated).not.toBeNull();
      expect(crypto.decrypt(migrated!)).toBe('sk-legacy');
    });

    it('returns null for a value the current secret already opens', () => {
      const crypto = new CryptoService();

      expect(crypto.reencryptFormerSecret(crypto.encrypt('sk-x'))).toBeNull();
    });

    it('returns null for a value no known secret opens', () => {
      process.env.APP_SECRET = 'first';
      const ciphertext = new CryptoService().encrypt('sk-secret');
      process.env.APP_SECRET = 'second';

      expect(new CryptoService().reencryptFormerSecret(ciphertext)).toBeNull();
    });
  });
});

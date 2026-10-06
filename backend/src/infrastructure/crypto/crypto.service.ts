import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '../developer-settings/developer-settings.file';

const APP_SECRET_FILE_NAME = '.app-secret';

// The fixed secret the backend used when APP_SECRET was unset, before it
// persisted its own (BA-106). Kept only to re-encrypt keys sealed with it.
const FORMER_DEVELOPMENT_SECRET = 'insecure-dev-secret';

/** The stored ciphertext does not open with the current app secret. */
export class UnreadableSecretError extends Error {
  constructor() {
    super('Stored secret cannot be decrypted with the current app secret');
    this.name = 'UnreadableSecretError';
  }
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

// At-rest secret encryption, mirrored from data-readiness-agent (ADR-0009).
// AES-256-GCM with a 256-bit key derived from APP_SECRET. Ciphertext is a
// compact `iv:tag:data` triple, each part base64 — the random IV and GCM auth
// tag travel with the value so decryption is self-contained.
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private readonly formerKey = deriveKey(FORMER_DEVELOPMENT_SECRET);

  constructor() {
    this.key = deriveKey(process.env.APP_SECRET || this.persistedSecret());
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      tag.toString('base64'),
      data.toString('base64'),
    ].join(':');
  }

  /** Throws `UnreadableSecretError` when the current secret cannot open it. */
  decrypt(ciphertext: string): string {
    const plaintext = this.open(ciphertext, this.key);
    if (plaintext === null) throw new UnreadableSecretError();
    return plaintext;
  }

  /**
   * The same value re-encrypted with the current secret when only the former
   * development secret opens it; null when no migration is needed or possible.
   */
  reencryptFormerSecret(ciphertext: string): string | null {
    if (this.open(ciphertext, this.key) !== null) return null;
    const plaintext = this.open(ciphertext, this.formerKey);
    return plaintext === null ? null : this.encrypt(plaintext);
  }

  private open(ciphertext: string, key: Buffer): string | null {
    try {
      const [iv, tag, data] = ciphertext
        .split(':')
        .map((part) => Buffer.from(part, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return null;
    }
  }

  /**
   * No APP_SECRET: read `<data dir>/.app-secret`, or create it, the same way
   * the Electron main process and the CLI do.
   */
  private persistedSecret(): string {
    const dataDir = resolveDataDir();
    const secretPath = join(dataDir, APP_SECRET_FILE_NAME);
    try {
      if (existsSync(secretPath)) {
        const existing = readFileSync(secretPath, 'utf8').trim();
        if (existing) return existing;
      }
    } catch (error) {
      this.logger.warn(
        `Could not read ${secretPath}; generating a new app secret (${(error as Error).message})`,
      );
    }
    const secret = randomBytes(32).toString('hex');
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(secretPath, secret, { mode: 0o600 });
      this.logger.log(`APP_SECRET not set — created ${secretPath}`);
    } catch (error) {
      this.logger.error(
        `Could not persist ${secretPath}; stored API keys will not decrypt after a restart (${(error as Error).message})`,
      );
    }
    return secret;
  }
}

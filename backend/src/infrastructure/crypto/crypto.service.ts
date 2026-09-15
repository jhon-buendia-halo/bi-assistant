import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

// At-rest secret encryption, mirrored from data-readiness-agent (ADR-0009).
// AES-256-GCM with a 256-bit key derived from APP_SECRET. Ciphertext is a
// compact `iv:tag:data` triple, each part base64 — the random IV and GCM auth
// tag travel with the value so decryption is self-contained.
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor() {
    const secret = process.env.APP_SECRET;
    if (!secret) {
      this.logger.warn(
        'APP_SECRET not set — using an insecure development default. Set APP_SECRET in production.',
      );
    }
    this.key = createHash('sha256')
      .update(secret ?? 'insecure-dev-secret')
      .digest();
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

  decrypt(ciphertext: string): string {
    const [iv, tag, data] = ciphertext
      .split(':')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }
}

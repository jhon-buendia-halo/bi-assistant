import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

// At-rest encryption helper — imported by any module that persists a secret.
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}

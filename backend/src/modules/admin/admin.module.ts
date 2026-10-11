import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** The Admin area's API (admin R22, R34-R68; api.md 2.15). */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

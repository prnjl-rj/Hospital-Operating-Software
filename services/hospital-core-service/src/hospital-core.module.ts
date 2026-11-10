import { Module } from '@nestjs/common';
import { HospitalCoreController } from './hospital-core.controller';
import { HospitalCoreService } from './hospital-core.service';

@Module({
  controllers: [HospitalCoreController],
  providers: [HospitalCoreService],
  exports: [HospitalCoreService],
})
export class HospitalCoreModule {}


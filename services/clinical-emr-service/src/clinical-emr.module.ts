import { Module } from '@nestjs/common';
import { ClinicalEmrController } from './clinical-emr.controller';
import { ClinicalEmrService } from './clinical-emr.service';

@Module({
  controllers: [ClinicalEmrController],
  providers: [ClinicalEmrService],
  exports: [ClinicalEmrService],
})
export class ClinicalEmrModule {}


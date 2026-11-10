import { Module } from '@nestjs/common';
import { DiagnosticsPharmacyController } from './diagnostics-pharmacy.controller';
import { DiagnosticsPharmacyService } from './diagnostics-pharmacy.service';

@Module({
  controllers: [DiagnosticsPharmacyController],
  providers: [DiagnosticsPharmacyService],
  exports: [DiagnosticsPharmacyService],
})
export class DiagnosticsPharmacyModule {}


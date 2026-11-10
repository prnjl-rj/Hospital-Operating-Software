import { Module } from '@nestjs/common';
import { IdentityModule } from '../../identity-service/src/identity.module';
import { HospitalCoreModule } from '../../hospital-core-service/src/hospital-core.module';
import { ClinicalEmrModule } from '../../clinical-emr-service/src/clinical-emr.module';
import { DiagnosticsPharmacyModule } from '../../diagnostics-pharmacy-service/src/diagnostics-pharmacy.module';
import { OperationsBillingModule } from '../../operations-billing-service/src/operations-billing.module';
import { ApiGatewayController } from './api-gateway.controller';

@Module({
  imports: [
    IdentityModule,
    HospitalCoreModule,
    ClinicalEmrModule,
    DiagnosticsPharmacyModule,
    OperationsBillingModule,
  ],
  controllers: [ApiGatewayController],
})
export class ApiGatewayModule {}


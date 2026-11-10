import { Module } from '@nestjs/common';
import { OperationsBillingController } from './operations-billing.controller';
import { OperationsBillingService } from './operations-billing.service';
import { DocumentS3Service } from './document-s3.service';

@Module({
  controllers: [OperationsBillingController],
  providers: [OperationsBillingService, DocumentS3Service],
  exports: [OperationsBillingService, DocumentS3Service],
})
export class OperationsBillingModule {}


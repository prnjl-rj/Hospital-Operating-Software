import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient as DiagnosticsPrismaClient } from '../../../node_modules/.prisma/diagnostics-pharmacy-client';

@Injectable()
export class DiagnosticsPharmacyService implements OnModuleDestroy {
  public readonly prisma: DiagnosticsPrismaClient;

  constructor(prismaClient?: DiagnosticsPrismaClient) {
    this.prisma = prismaClient ?? new DiagnosticsPrismaClient();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // ===========================================================================
  // 1. Laboratory Service (Service 23) — Order, Specimen Barcode & Result Ready
  // ===========================================================================
  async createLabOrder(
    dto: {
      hospitalId: string;
      encounterRefId: string;
      patientRefId: string;
      orderingDoctorId: string;
      testCode: string;
      priority?: 'ROUTINE' | 'STAT_URGENT';
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const testCatalog = await this.prisma.labTestCatalog.findUnique({
      where: { testCode: dto.testCode },
    });
    if (!testCatalog) {
      throw new NotFoundException(`LAB_TEST_CODE_NOT_FOUND:${dto.testCode}`);
    }

    const count = await this.prisma.labOrder.count({ where: { hospitalId: dto.hospitalId } });
    const orderNumber = `LAB-ORD-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.labOrder.create({
        data: {
          hospitalId: dto.hospitalId,
          orderNumber,
          encounterRefId: dto.encounterRefId,
          patientRefId: dto.patientRefId,
          orderingDoctorId: dto.orderingDoctorId,
          testCode: testCatalog.testCode,
          testName: testCatalog.testName,
          priority: dto.priority ?? 'ROUTINE',
          status: 'ORDERED',
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.lab.order.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientRefId,
          payload: {
            labOrderId: order.id,
            orderNumber: order.orderNumber,
            encounterId: dto.encounterRefId,
            patientId: dto.patientRefId,
            testCode: testCatalog.testCode,
            testName: testCatalog.testName,
            priceMinor: testCatalog.priceMinor.toString(),
          },
        },
      });

      return order;
    });
  }

  async collectLabSpecimen(labOrderId: string) {
    const specimenBarcode = `SPEC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    return this.prisma.labOrder.update({
      where: { id: labOrderId },
      data: {
        specimenBarcode,
        status: 'SAMPLE_COLLECTED',
        sampleCollectedAt: new Date(),
      },
    });
  }

  async submitAndVerifyLabResult(
    labOrderId: string,
    dto: {
      enteredByTechId: string;
      verifiedByDoctorId?: string;
      parameters: Array<{
        parameterName: string;
        observedValue: string;
        unit: string;
        referenceRange: string;
        abnormalFlag?: 'NORMAL' | 'HIGH' | 'LOW' | 'CRITICAL_PANIC';
      }>;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const order = await this.prisma.labOrder.findUnique({ where: { id: labOrderId } });
    if (!order) throw new NotFoundException('LAB_ORDER_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const createdResults = [];
      for (const param of dto.parameters) {
        const res = await tx.labResult.create({
          data: {
            labOrderId,
            parameterName: param.parameterName,
            observedValue: param.observedValue,
            unit: param.unit,
            referenceRange: param.referenceRange,
            abnormalFlag: param.abnormalFlag ?? 'NORMAL',
            enteredByTechId: dto.enteredByTechId,
            verifiedByDoctorId: dto.verifiedByDoctorId ?? null,
            isFinalized: true,
          },
        });
        createdResults.push(res);
      }

      const updatedOrder = await tx.labOrder.update({
        where: { id: labOrderId },
        data: {
          status: 'RESULT_READY',
          completedAt: new Date(),
        },
        include: { results: true },
      });

      const hasCriticalPanic = createdResults.some((r) => r.abnormalFlag === 'CRITICAL_PANIC');

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.lab.result.ready',
          correlationId,
          hospitalId: order.hospitalId,
          partitionKey: order.patientRefId,
          payload: {
            labOrderId: order.id,
            orderNumber: order.orderNumber,
            encounterId: order.encounterRefId,
            patientId: order.patientRefId,
            orderingDoctorId: order.orderingDoctorId,
            testCode: order.testCode,
            hasCriticalPanic,
          },
        },
      });

      return updatedOrder;
    });
  }

  // ===========================================================================
  // 2. Pharmacy (Service 20) & Inventory FEFO Batch Deduction (Service 21)
  // ===========================================================================
  async createDispenseOrderFromPrescription(dto: {
    hospitalId: string;
    prescriptionRefId: string;
    patientRefId: string;
    doctorRefId: string;
    items: Array<{
      medicationCode: string;
      medicationName: string;
      quantityRequested: number;
    }>;
  }) {
    const existing = await this.prisma.pharmacyDispenseOrder.findUnique({
      where: { prescriptionRefId: dto.prescriptionRefId },
      include: { items: true },
    });
    if (existing) return existing;

    const count = await this.prisma.pharmacyDispenseOrder.count({
      where: { hospitalId: dto.hospitalId },
    });
    const dispenseOrderNumber = `DISP-2026-${String(count + 1).padStart(6, '0')}`;

    const itemsWithPrices = [];
    for (const item of dto.items) {
      const med = await this.prisma.medicationCatalog.findUnique({
        where: { skuCode: item.medicationCode },
      });
      itemsWithPrices.push({
        medicationCode: item.medicationCode,
        medicationName: item.medicationName,
        quantityRequested: item.quantityRequested,
        unitPriceMinor: med ? med.unitPriceMinor : BigInt(1000),
      });
    }

    return this.prisma.pharmacyDispenseOrder.create({
      data: {
        hospitalId: dto.hospitalId,
        dispenseOrderNumber,
        prescriptionRefId: dto.prescriptionRefId,
        patientRefId: dto.patientRefId,
        doctorRefId: dto.doctorRefId,
        status: 'PENDING_DISPENSE',
        items: {
          create: itemsWithPrices,
        },
      },
      include: { items: true },
    });
  }

  async dispenseMedicationOrderFefo(
    dispenseOrderId: string,
    dispensedByUserId: string,
    correlationId = `corr-${randomUUID()}`,
  ) {
    const order = await this.prisma.pharmacyDispenseOrder.findUnique({
      where: { id: dispenseOrderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('DISPENSE_ORDER_NOT_FOUND');
    if (order.status === 'DISPENSED') {
      throw new ConflictException('ORDER_ALREADY_DISPENSED');
    }

    return this.prisma.$transaction(async (tx) => {
      let totalChargeMinor = BigInt(0);

      for (const item of order.items) {
        const med = await tx.medicationCatalog.findUnique({
          where: { skuCode: item.medicationCode },
        });
        if (!med) {
          throw new BadRequestException(`MEDICATION_SKU_NOT_IN_CATALOG:${item.medicationCode}`);
        }

        // FEFO (First-Expiry-First-Out): select earliest expiring non-expired batch with sufficient stock
        const batch = await tx.inventoryBatch.findFirst({
          where: {
            medicationId: med.id,
            expiryDate: { gt: new Date() },
            quantityOnHand: { gte: item.quantityRequested },
          },
          orderBy: { expiryDate: 'asc' },
        });

        if (!batch) {
          throw new ConflictException(`INSUFFICIENT_FEFO_BATCH_STOCK:${item.medicationCode}`);
        }

        const remainingQty = batch.quantityOnHand - item.quantityRequested;
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: { quantityOnHand: remainingQty },
        });

        await tx.pharmacyDispenseItem.update({
          where: { id: item.id },
          data: {
            batchNumber: batch.batchNumber,
            quantityDispensed: item.quantityRequested,
          },
        });

        totalChargeMinor += item.unitPriceMinor * BigInt(item.quantityRequested);

        if (remainingQty <= med.reorderLevel) {
          await tx.outboxEvent.create({
            data: {
              eventType: 'hospital.inventory.reorder.triggered',
              correlationId,
              hospitalId: order.hospitalId,
              partitionKey: med.id,
              payload: {
                medicationId: med.id,
                skuCode: med.skuCode,
                remainingQty,
                reorderLevel: med.reorderLevel,
              },
            },
          });
        }
      }

      const completed = await tx.pharmacyDispenseOrder.update({
        where: { id: dispenseOrderId },
        data: {
          status: 'DISPENSED',
          dispensedByUserId,
          dispensedAt: new Date(),
        },
        include: { items: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.pharmacy.dispensed',
          correlationId,
          hospitalId: order.hospitalId,
          partitionKey: order.patientRefId,
          payload: {
            dispenseOrderId: completed.id,
            dispenseOrderNumber: completed.dispenseOrderNumber,
            prescriptionId: completed.prescriptionRefId,
            patientId: completed.patientRefId,
            totalChargeMinor: totalChargeMinor.toString(),
          },
        },
      });

      return completed;
    });
  }

  // ===========================================================================
  // 3. Radiology (Service 24), PACS Integration (Service 25) & Blood Bank (Service 29)
  // ===========================================================================
  async createRadiologyOrder(
    dto: {
      hospitalId: string;
      encounterRefId: string;
      patientRefId: string;
      orderingDoctorId: string;
      modality: 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND';
      bodyPart: string;
      clinicalIndication: string;
      priceMinor?: number;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    const count = await this.prisma.radiologyOrder.count({
      where: { hospitalId: dto.hospitalId },
    });
    const orderNumber = `RAD-ORD-2026-${String(count + 1).padStart(6, '0')}`;
    const studyInstanceUid = `1.2.840.113619.2.55.3.${Date.now()}.${count + 1}`;
    const accessionNumber = `ACC-2026-${String(count + 1).padStart(6, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.radiologyOrder.create({
        data: {
          hospitalId: dto.hospitalId,
          orderNumber,
          encounterRefId: dto.encounterRefId,
          patientRefId: dto.patientRefId,
          orderingDoctorId: dto.orderingDoctorId,
          modality: dto.modality,
          bodyPart: dto.bodyPart,
          clinicalIndication: dto.clinicalIndication,
          priceMinor: BigInt(dto.priceMinor ?? 180000),
          dicomStudy: {
            create: {
              studyInstanceUid,
              accessionNumber,
              modality: dto.modality,
              wadoViewerUrl: `https://pacs.hos.internal/wado-rs/studies/${studyInstanceUid}`,
            },
          },
        },
        include: { dicomStudy: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.radiology.order.created',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientRefId,
          payload: {
            radiologyOrderId: order.id,
            orderNumber: order.orderNumber,
            patientId: dto.patientRefId,
            modality: dto.modality,
            studyInstanceUid,
            priceMinor: order.priceMinor.toString(),
          },
        },
      });

      return order;
    });
  }

  async issueBloodUnit(bagNumber: string, patientRefId: string) {
    const unit = await this.prisma.bloodUnit.findUnique({ where: { bagNumber } });
    if (!unit) throw new NotFoundException('BLOOD_UNIT_NOT_FOUND');
    if (unit.status !== 'AVAILABLE') {
      throw new ConflictException(`BLOOD_UNIT_NOT_AVAILABLE:${unit.status}`);
    }
    return this.prisma.bloodUnit.update({
      where: { bagNumber },
      data: {
        status: 'ISSUED',
        issuedToPatientId: patientRefId,
      },
    });
  }
}


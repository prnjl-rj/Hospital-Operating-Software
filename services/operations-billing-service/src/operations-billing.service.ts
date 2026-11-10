import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient as OperationsPrismaClient } from '../../../node_modules/.prisma/operations-billing-client';

@Injectable()
export class OperationsBillingService implements OnModuleDestroy {
  public readonly prisma: OperationsPrismaClient;

  constructor(prismaClient?: OperationsPrismaClient) {
    this.prisma = prismaClient ?? new OperationsPrismaClient();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // ===========================================================================
  // 1. Billing Service (Service 26) — Folio Invoices & Line Item Accrual
  // ===========================================================================
  async createOrAppendInvoiceCharge(dto: {
    hospitalId: string;
    patientRefId: string;
    encounterRefId?: string;
    admissionRefId?: string;
    sourceService: 'APPOINTMENT' | 'LAB' | 'RADIOLOGY' | 'PHARMACY' | 'BED_TARIFF' | 'PROCEDURE';
    sourceRefId: string;
    description: string;
    quantity?: number;
    unitPriceMinor: number | bigint;
  }) {
    const qty = dto.quantity ?? 1;
    const unitMinor = BigInt(dto.unitPriceMinor);
    const lineTotal = unitMinor * BigInt(qty);

    return this.prisma.$transaction(async (tx) => {
      let invoice = await tx.invoice.findFirst({
        where: {
          hospitalId: dto.hospitalId,
          patientRefId: dto.patientRefId,
          status: 'OPEN',
        },
      });

      if (!invoice) {
        const count = await tx.invoice.count({ where: { hospitalId: dto.hospitalId } });
        const invoiceNumber = `INV-2026-${String(count + 1).padStart(6, '0')}`;
        invoice = await tx.invoice.create({
          data: {
            hospitalId: dto.hospitalId,
            invoiceNumber,
            patientRefId: dto.patientRefId,
            encounterRefId: dto.encounterRefId,
            admissionRefId: dto.admissionRefId,
            status: 'OPEN',
          },
        });
      }

      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          sourceService: dto.sourceService,
          sourceRefId: dto.sourceRefId,
          description: dto.description,
          quantity: qty,
          unitPriceMinor: unitMinor,
          totalMinor: lineTotal,
        },
      });

      const nextSubtotal = invoice.subtotalMinor + lineTotal;
      const nextTax = (nextSubtotal * BigInt(5)) / BigInt(100); // 5% healthcare GST where applicable
      const nextTotal = nextSubtotal + nextTax - invoice.discountMinor;
      const nextBalance = nextTotal - invoice.paidAmountMinor;

      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          subtotalMinor: nextSubtotal,
          taxMinor: nextTax,
          totalAmountMinor: nextTotal,
          balanceDueMinor: nextBalance,
        },
        include: { lineItems: true, payments: true },
      });
    });
  }

  async finalizeInvoice(invoiceId: string, finalizedByUserId: string, correlationId = `corr-${randomUUID()}`) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const finalized = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: inv.balanceDueMinor <= BigInt(0) ? 'PAID' : 'FINALIZED',
          finalizedByUserId,
          finalizedAt: new Date(),
        },
        include: { lineItems: true, payments: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.billing.invoice.finalized',
          correlationId,
          hospitalId: inv.hospitalId,
          partitionKey: inv.id,
          payload: {
            invoiceId: finalized.id,
            invoiceNumber: finalized.invoiceNumber,
            patientId: finalized.patientRefId,
            totalAmountMinor: finalized.totalAmountMinor.toString(),
            balanceDueMinor: finalized.balanceDueMinor.toString(),
          },
        },
      });

      return finalized;
    });
  }

  // ===========================================================================
  // 2. Payment Service (Service 27) — Strict Idempotent Financial Transactions
  // ===========================================================================
  async processPaymentIdempotent(
    dto: {
      hospitalId: string;
      invoiceId: string;
      patientRefId: string;
      idempotencyKey: string;
      amountMinor: number | bigint;
      paymentMethod: 'CASH' | 'CARD' | 'UPI' | 'NEFT' | 'INSURANCE_TPA';
      collectedByUserId: string;
    },
    correlationId = `corr-${randomUUID()}`,
  ) {
    if (!dto.idempotencyKey) {
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED_FOR_PAYMENTS');
    }

    // Rule 18 & Rule 27: Return existing transaction if idempotencyKey was already processed!
    const existingPayment = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existingPayment) {
      return { payment: existingPayment, idempotentReplay: true };
    }

    const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
    if (!invoice) throw new NotFoundException('INVOICE_NOT_FOUND');

    const amount = BigInt(dto.amountMinor);
    if (amount <= BigInt(0)) {
      throw new BadRequestException('PAYMENT_AMOUNT_MUST_BE_POSITIVE');
    }

    const count = await this.prisma.paymentTransaction.count({
      where: { hospitalId: dto.hospitalId },
    });
    const receiptNumber = `RCPT-2026-${String(count + 1).padStart(6, '0')}`;

    const payment = await this.prisma.$transaction(async (tx) => {
      const createdPayment = await tx.paymentTransaction.create({
        data: {
          hospitalId: dto.hospitalId,
          receiptNumber,
          invoiceId: dto.invoiceId,
          patientRefId: dto.patientRefId,
          idempotencyKey: dto.idempotencyKey,
          amountMinor: amount,
          paymentMethod: dto.paymentMethod,
          status: 'COMPLETED',
          collectedByUserId: dto.collectedByUserId,
        },
      });

      const nextPaid = invoice.paidAmountMinor + amount;
      const nextBalance =
        invoice.totalAmountMinor > nextPaid ? invoice.totalAmountMinor - nextPaid : BigInt(0);
      const nextStatus = nextBalance === BigInt(0) ? 'PAID' : 'PARTIALLY_PAID';

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmountMinor: nextPaid,
          balanceDueMinor: nextBalance,
          status: nextStatus,
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.payment.completed',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: invoice.id,
          payload: {
            paymentId: createdPayment.id,
            receiptNumber: createdPayment.receiptNumber,
            invoiceId: invoice.id,
            patientId: dto.patientRefId,
            amountMinor: amount.toString(),
            paymentMethod: dto.paymentMethod,
            invoiceStatus: nextStatus,
          },
        },
      });

      return createdPayment;
    });

    return { payment, idempotentReplay: false };
  }

  // ===========================================================================
  // 3. Insurance / TPA Claims (Service 28)
  // ===========================================================================
  async submitInsuranceClaim(dto: {
    hospitalId: string;
    invoiceId: string;
    patientRefId: string;
    tpaProviderName: string;
    policyNumber: string;
    claimedAmountMinor: number | bigint;
  }) {
    const count = await this.prisma.insuranceClaim.count({
      where: { hospitalId: dto.hospitalId },
    });
    const claimNumber = `CLM-2026-${String(count + 1).padStart(5, '0')}`;
    return this.prisma.insuranceClaim.create({
      data: {
        hospitalId: dto.hospitalId,
        claimNumber,
        invoiceId: dto.invoiceId,
        patientRefId: dto.patientRefId,
        tpaProviderName: dto.tpaProviderName,
        policyNumber: dto.policyNumber,
        claimedAmountMinor: BigInt(dto.claimedAmountMinor),
        status: 'PREAUTH_SUBMITTED',
      },
    });
  }

  // ===========================================================================
  // 4. Facility Housekeeping (Service 33), Notifications (Service 34) & Analytics KPIs (Service 37)
  // ===========================================================================
  async createHousekeepingTurnaroundTask(dto: {
    hospitalId: string;
    bedRefNumber: string;
    wardRefCode: string;
    assignedStaff?: string;
  }) {
    return this.prisma.housekeepingTask.create({
      data: {
        hospitalId: dto.hospitalId,
        bedRefNumber: dto.bedRefNumber,
        wardRefCode: dto.wardRefCode,
        assignedStaff: dto.assignedStaff ?? 'Housekeeping Unit A',
        status: 'PENDING',
      },
    });
  }

  async completeHousekeepingTask(taskId: string, correlationId = `corr-${randomUUID()}`) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.housekeepingTask.update({
        where: { id: taskId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.facility.cleaning.completed',
          correlationId,
          hospitalId: task.hospitalId,
          partitionKey: task.bedRefNumber,
          payload: {
            housekeepingTaskId: task.id,
            bedRefNumber: task.bedRefNumber,
            wardRefCode: task.wardRefCode,
          },
        },
      });

      return task;
    });
  }

  async queueNotification(dto: {
    hospitalId: string;
    recipientUserId?: string;
    recipientPhone?: string;
    recipientEmail?: string;
    channel: 'IN_APP' | 'EMAIL' | 'SMS';
    templateCode: string;
    subject: string;
    body: string;
    correlationId?: string;
  }) {
    return this.prisma.notificationRecord.create({
      data: {
        hospitalId: dto.hospitalId,
        recipientUserId: dto.recipientUserId,
        recipientPhone: dto.recipientPhone,
        recipientEmail: dto.recipientEmail,
        channel: dto.channel,
        templateCode: dto.templateCode,
        subject: dto.subject,
        body: dto.body,
        correlationId: dto.correlationId ?? `notif-${randomUUID()}`,
        status: 'DELIVERED',
      },
    });
  }

  async getExecutiveKpis(hospitalId: string) {
    const [invoices, payments, openHousekeeping, notifications, documents] = await Promise.all([
      this.prisma.invoice.count({ where: { hospitalId } }),
      this.prisma.paymentTransaction.findMany({
        where: { hospitalId, status: 'COMPLETED' },
      }),
      this.prisma.housekeepingTask.count({ where: { hospitalId, status: 'PENDING' } }),
      this.prisma.notificationRecord.count({ where: { hospitalId } }),
      this.prisma.documentRecord.count({ where: { hospitalId } }),
    ]);

    const totalRevenueMinor = payments.reduce((acc, p) => acc + p.amountMinor, BigInt(0));

    return {
      hospitalId,
      invoicesCount: invoices,
      completedPaymentsCount: payments.length,
      totalRevenueMinor: totalRevenueMinor.toString(),
      pendingHousekeepingTurnarounds: openHousekeeping,
      notificationsDispatched: notifications,
      medicalDocumentsArchived: documents,
      generatedAt: new Date().toISOString(),
    };
  }
}


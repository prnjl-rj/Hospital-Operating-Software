import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient as OperationsPrismaClient } from '../../../node_modules/.prisma/operations-billing-client';

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/dicom',
]);

const MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB limit for medical documents

export interface PresignUploadRequestDto {
  hospitalId: string;
  patientRefId: string;
  encounterRefId?: string;
  documentCategory:
    | 'LAB_REPORT'
    | 'DISCHARGE_SUMMARY'
    | 'CONSENT_FORM'
    | 'INSURANCE_DOC'
    | 'PRESCRIPTION_PDF';
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  contentSampleForChecksum?: string;
  uploadedByUserId: string;
}

@Injectable()
export class DocumentS3Service {
  private readonly prisma: OperationsPrismaClient;
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly kmsKeyArn: string;

  constructor(prisma?: OperationsPrismaClient) {
    this.prisma = prisma || new OperationsPrismaClient();
    const region = process.env.AWS_REGION || 'ap-south-1';
    this.bucketName = process.env.S3_BUCKET_DOCUMENTS || 'hos-medical-documents-dev';
    this.kmsKeyArn =
      process.env.AWS_KMS_KEY_ARN ||
      `arn:aws:kms:${region}:000000000000:key/hos-medical-docs-kms-key`;

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey:
          process.env.AWS_SECRET_ACCESS_KEY || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      ...(process.env.S3_ENDPOINT_OVERRIDE
        ? { endpoint: process.env.S3_ENDPOINT_OVERRIDE, forcePathStyle: true }
        : {}),
    });
  }

  // ===========================================================================
  // 1. Validate File Constraints, Persist Ownership Metadata & Generate Presigned PUT URL
  // ===========================================================================
  async createPresignedUpload(dto: PresignUploadRequestDto) {
    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(dto.mimeType)) {
      throw new BadRequestException(`UNSUPPORTED_DOCUMENT_MIME_TYPE:${dto.mimeType}`);
    }
    if (dto.fileSizeBytes <= 0 || dto.fileSizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
      throw new BadRequestException(
        `FILE_SIZE_EXCEEDS_LIMIT_MAX_${MAX_DOCUMENT_SIZE_BYTES}_BYTES`,
      );
    }

    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const s3ObjectKey = `hospitals/${dto.hospitalId}/patients/${dto.patientRefId}/${dto.documentCategory.toLowerCase()}/${randomUUID()}-${safeFileName}`;
    const checksumSha256 = createHash('sha256')
      .update(dto.contentSampleForChecksum || `${s3ObjectKey}:${dto.fileSizeBytes}`)
      .digest('hex');

    const putCommand = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3ObjectKey,
      ContentType: dto.mimeType,
      ContentLength: dto.fileSizeBytes,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.kmsKeyArn,
      Metadata: {
        'hospital-id': dto.hospitalId,
        'patient-ref-id': dto.patientRefId,
        'document-category': dto.documentCategory,
        'checksum-sha256': checksumSha256,
      },
    });

    const presignedUploadUrl = await getSignedUrl(this.s3Client, putCommand, {
      expiresIn: 900, // 15-minute presigned upload window
    });

    const correlationId = `doc-${randomUUID()}`;
    const record = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.documentRecord.create({
        data: {
          hospitalId: dto.hospitalId,
          patientRefId: dto.patientRefId,
          encounterRefId: dto.encounterRefId,
          documentCategory: dto.documentCategory,
          fileName: safeFileName,
          mimeType: dto.mimeType,
          fileSizeBytes: dto.fileSizeBytes,
          s3Bucket: this.bucketName,
          s3ObjectKey,
          kmsKeyArn: this.kmsKeyArn,
          checksumSha256,
          uploadedByUserId: dto.uploadedByUserId,
          retentionYears: 7,
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'hospital.document.uploaded',
          correlationId,
          hospitalId: dto.hospitalId,
          partitionKey: dto.patientRefId,
          payload: {
            documentId: doc.id,
            patientId: dto.patientRefId,
            documentCategory: dto.documentCategory,
            s3Bucket: this.bucketName,
            s3ObjectKey,
            checksumSha256,
          },
        },
      });

      return doc;
    });

    return {
      document: record,
      presignedUploadUrl,
      expiresInSeconds: 900,
    };
  }

  // ===========================================================================
  // 2. Access-Controlled Presigned GET Download URL Generation
  // ===========================================================================
  async createPresignedDownload(params: {
    documentId: string;
    requesterHospitalId: string;
    requesterUserId: string;
    requesterRoles: string[];
  }) {
    const doc = await this.prisma.documentRecord.findUnique({
      where: { id: params.documentId },
    });
    if (!doc) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }

    if (
      !params.requesterRoles.includes('SUPER_ADMIN') &&
      doc.hospitalId !== params.requesterHospitalId
    ) {
      throw new ForbiddenException('CROSS_HOSPITAL_DOCUMENT_ACCESS_DENIED');
    }

    const getCommand = new GetObjectCommand({
      Bucket: doc.s3Bucket,
      Key: doc.s3ObjectKey,
    });

    const presignedDownloadUrl = await getSignedUrl(this.s3Client, getCommand, {
      expiresIn: 300, // 5-minute short-lived download URL
    });

    return {
      documentId: doc.id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      checksumSha256: doc.checksumSha256,
      presignedDownloadUrl,
      expiresInSeconds: 300,
    };
  }

  async listPatientDocuments(hospitalId: string, patientRefId: string) {
    return this.prisma.documentRecord.findMany({
      where: { hospitalId, patientRefId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

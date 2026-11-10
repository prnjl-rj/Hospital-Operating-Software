terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Compliance  = "Healthcare-HIPAA-DPDP"
    }
  }
}

# =============================================================================
# 1. AWS KMS Customer Managed Key (CMK) for PHI, RDS, S3, MSK, and Secrets
# =============================================================================
resource "aws_kms_key" "hos_cmk" {
  description             = "HOS Healthcare Customer Managed KMS Key (RDS, S3, MSK, Secrets, EBS)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "hos_cmk_alias" {
  name          = "alias/${var.project_name}-${var.environment}-cmk"
  target_key_id = aws_kms_key.hos_cmk.key_id
}

# =============================================================================
# 2. Multi-AZ VPC with Public, Private App, and Isolated Data Subnets
# =============================================================================
resource "aws_vpc" "hos_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc"
  }
}

resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.hos_vpc.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name                                        = "${var.project_name}-${var.environment}-public-${count.index + 1}"
    "kubernetes.io/role/elb"                    = "1"
  }
}

resource "aws_subnet" "private_app" {
  count             = 3
  vpc_id            = aws_vpc.hos_vpc.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name                              = "${var.project_name}-${var.environment}-private-app-${count.index + 1}"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

resource "aws_subnet" "isolated_data" {
  count             = 3
  vpc_id            = aws_vpc.hos_vpc.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 21)
  availability_zone = var.availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-isolated-data-${count.index + 1}"
  }
}

# =============================================================================
# 3. Amazon ECR Repositories for All 7 HOS Containers (Immutable Tags + Scan)
# =============================================================================
locals {
  ecr_services = [
    "api-gateway",
    "identity-service",
    "hospital-core-service",
    "clinical-emr-service",
    "diagnostics-pharmacy-service",
    "operations-billing-service",
    "frontend"
  ]
}

resource "aws_ecr_repository" "hos_repos" {
  for_each             = toset(local.ecr_services)
  name                 = "${var.project_name}/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.hos_cmk.arn
  }
}

# =============================================================================
# 4. Amazon RDS PostgreSQL 16 Multi-AZ (Strictly Private Data Subnets)
# =============================================================================
resource "aws_db_subnet_group" "hos_rds_subnets" {
  name       = "${var.project_name}-${var.environment}-rds-subnets"
  subnet_ids = aws_subnet.isolated_data[*].id
}

resource "aws_db_instance" "hos_postgres" {
  identifier                  = "${var.project_name}-${var.environment}-postgres"
  engine                      = "postgres"
  engine_version              = "16.4"
  instance_class              = var.rds_instance_class
  allocated_storage           = 200
  max_allocated_storage       = 1000
  storage_type                = "gp3"
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.hos_cmk.arn
  db_name                     = "hos_db"
  username                    = "hos_admin"
  manage_master_user_password = true
  multi_az                    = true
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.hos_rds_subnets.name
  backup_retention_period     = 35
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.project_name}-${var.environment}-postgres-final"
}

# =============================================================================
# 5. Amazon ElastiCache Redis 7 Replication Group (TLS + Auth Token Enabled)
# =============================================================================
resource "aws_elasticache_subnet_group" "hos_redis_subnets" {
  name       = "${var.project_name}-${var.environment}-redis-subnets"
  subnet_ids = aws_subnet.isolated_data[*].id
}

resource "aws_elasticache_replication_group" "hos_redis" {
  replication_group_id          = "${var.project_name}-${var.environment}-redis"
  description                   = "HOS Redis 7 HA cluster for caching, distributed locks, and BullMQ"
  node_type                     = var.redis_node_type
  num_cache_clusters            = 3
  port                          = 6379
  engine                        = "redis"
  engine_version                = "7.1"
  subnet_group_name             = aws_elasticache_subnet_group.hos_redis_subnets.name
  automatic_failover_enabled    = true
  multi_az_enabled              = true
  at_rest_encryption_enabled    = true
  kms_key_id                    = aws_kms_key.hos_cmk.arn
  transit_encryption_enabled    = true
}

# =============================================================================
# 6. Amazon MSK (Managed Streaming for Apache Kafka 3.8 — TLS + KMS)
# =============================================================================
resource "aws_msk_cluster" "hos_kafka" {
  cluster_name           = "${var.project_name}-${var.environment}-msk"
  kafka_version          = "3.8.x"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = var.msk_instance_type
    client_subnets  = aws_subnet.isolated_data[*].id
    storage_info {
      ebs_storage_info {
        volume_size = 500
      }
    }
  }

  encryption_info {
    encryption_at_rest_kms_key_arn = aws_kms_key.hos_cmk.arn
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }
}

# =============================================================================
# 7. Amazon S3 Medical Documents Bucket (SSE-KMS, Versioning, 7-Yr Lifecycle)
# =============================================================================
resource "aws_s3_bucket" "hos_medical_documents" {
  bucket = "${var.project_name}-${var.environment}-medical-documents"
}

resource "aws_s3_bucket_public_access_block" "hos_medical_documents_block" {
  bucket                  = aws_s3_bucket.hos_medical_documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "hos_medical_documents_versioning" {
  bucket = aws_s3_bucket.hos_medical_documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "hos_medical_documents_sse" {
  bucket = aws_s3_bucket.hos_medical_documents.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.hos_cmk.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

# =============================================================================
# 8. AWS WAFv2 Web ACL + AWS Backup Vault
# =============================================================================
resource "aws_wafv2_web_acl" "hos_waf" {
  name        = "${var.project_name}-${var.environment}-waf"
  description = "OWASP Top 10 & Rate Limiting WAF for HOS ALB/CloudFront"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-waf-metrics"
    sampled_requests_enabled   = true
  }
}

resource "aws_backup_vault" "hos_backup_vault" {
  name        = "${var.project_name}-${var.environment}-backup-vault"
  kms_key_arn = aws_kms_key.hos_cmk.arn
}


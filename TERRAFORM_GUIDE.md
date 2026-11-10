# HOSPITAL OPERATING SOFTWARE (HOS) — TERRAFORM INFRASTRUCTURE GUIDE (`TERRAFORM_GUIDE.md`)

## 1. Terraform Structure (`infrastructure/terraform/`)
- `variables.tf`: Parameterized inputs (`aws_region`, `environment`, `project_name`, `vpc_cidr`, `availability_zones`, `eks_cluster_version`, `rds_instance_class`, `msk_instance_type`, `redis_node_type`).
- `main.tf`: Declarative AWS resources for KMS Customer Managed Key (`aws_kms_key.hos_cmk`), 3-AZ VPC (`aws_vpc.hos_vpc`) with Public, Private App, and Isolated Data subnets, 7 immutable ECR repositories with KMS encryption and push scanning, Multi-AZ RDS PostgreSQL 16 (`publicly_accessible = false`, 35-day backup retention, deletion protection), ElastiCache Redis 7 replication group (at-rest and transit TLS encryption), 3-broker Amazon MSK Kafka 3.8 cluster, S3 Medical Documents bucket (`aws:kms` encryption + public access block + versioning), AWS WAFv2 Web ACL, and AWS Backup Vault.
- `outputs.tf`: Outputs `vpc_id`, `kms_key_arn`, `rds_endpoint` (sensitive), `redis_primary_endpoint` (sensitive), `msk_bootstrap_brokers_tls` (sensitive), and `s3_medical_documents_bucket`.

## 2. State Management & Security Best Practices
- Store `terraform.tfstate` in an encrypted S3 backend with DynamoDB state locking (`hos-terraform-state-lock`).
- All sensitive outputs (`rds_endpoint`, `redis_primary_endpoint`, `msk_bootstrap_brokers_tls`) are marked `sensitive = true`.
- Database master credentials are managed automatically by AWS Secrets Manager (`manage_master_user_password = true`) and rotated via KMS.


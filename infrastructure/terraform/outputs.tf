output "vpc_id" {
  description = "HOS Multi-AZ VPC ID"
  value       = aws_vpc.hos_vpc.id
}

output "kms_key_arn" {
  description = "Customer Managed KMS Key ARN for healthcare encryption"
  value       = aws_kms_key.hos_cmk.arn
}

output "rds_endpoint" {
  description = "Private Multi-AZ RDS PostgreSQL endpoint"
  value       = aws_db_instance.hos_postgres.endpoint
  sensitive   = true
}

output "redis_primary_endpoint" {
  description = "Private ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.hos_redis.primary_endpoint_address
  sensitive   = true
}

output "msk_bootstrap_brokers_tls" {
  description = "Private Amazon MSK TLS bootstrap brokers"
  value       = aws_msk_cluster.hos_kafka.bootstrap_brokers_tls
  sensitive   = true
}

output "s3_medical_documents_bucket" {
  description = "S3 Bucket for encrypted medical documents"
  value       = aws_s3_bucket.hos_medical_documents.bucket
}


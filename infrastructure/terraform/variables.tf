variable "aws_region" {
  description = "AWS Region for Hospital Operating Software deployment"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project identifier prefix"
  type        = string
  default     = "hos-enterprise"
}

variable "vpc_cidr" {
  description = "CIDR block for the HOS VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "3 Availability Zones for Multi-AZ high availability"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
}

variable "eks_cluster_version" {
  description = "Amazon EKS Kubernetes version"
  type        = string
  default     = "1.31"
}

variable "rds_instance_class" {
  description = "Amazon RDS PostgreSQL Multi-AZ instance class"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "msk_instance_type" {
  description = "Amazon MSK Kafka broker instance type"
  type        = string
  default     = "kafka.m5.large"
}

variable "redis_node_type" {
  description = "Amazon ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.large"
}


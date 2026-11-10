# HOSPITAL OPERATING SOFTWARE (HOS) — AWS DEPLOYMENT GUIDE (`AWS_DEPLOYMENT.md`)

## 1. Prerequisites & Authentication
In accordance with **Section 5 (Credential and Access Management)**:
- Never use AWS root credentials.
- Authenticate via **AWS IAM Identity Center (SSO)** or temporary IAM role assumption:
  ```powershell
  aws configure sso
  aws sso login --profile hos-enterprise-admin
  aws sts get-caller-identity --profile hos-enterprise-admin
  ```

## 2. Step-by-Step Deployment Sequence
1. **Provision Infrastructure via Terraform (`infrastructure/terraform/`):**
   ```powershell
   cd infrastructure/terraform
   terraform init
   terraform validate
   terraform plan -var="environment=staging" -out=tfplan
   # Only run apply after reviewing the cost breakdown and plan output:
   terraform apply tfplan
   ```
2. **Build and Push Immutable Container Images to Amazon ECR:**
   ```powershell
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com
   docker build -f Dockerfile.backend -t <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/hos-enterprise/api-gateway:v1.0.0 .
   docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/hos-enterprise/api-gateway:v1.0.0
   ```
3. **Configure kubectl Context for Amazon EKS:**
   ```powershell
   aws eks update-kubeconfig --region ap-south-1 --name hos-enterprise-prod-eks
   ```
4. **Deploy HOS Helm Chart (`infrastructure/helm/hos-chart/`):**
   ```powershell
   helm upgrade --install hos-enterprise ./infrastructure/helm/hos-chart --namespace hos-prod --create-namespace
   ```


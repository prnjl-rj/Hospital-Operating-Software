# HOSPITAL OPERATING SOFTWARE (HOS) — CI/CD PIPELINE GUIDE (`CI_CD_GUIDE.md`)

## 1. Pipeline Overview (`.github/workflows/ci-cd.yml`)
The GitHub Actions workflow automates quality gates, security scanning, container publishing, and staged Kubernetes deployments across 4 stages and 14 steps:

1. **Stage 1 (`verify-and-test`):**
   - `npm ci` deterministic installation.
   - `npm run db:generate` across all 5 Prisma schemas.
   - TypeScript type checking (`npx tsc --noEmit`) and Frontend Vite production build (`npm --workspace=@hos/frontend run build`).
   - Automated Unit & Integration Test execution (`npm test`).
   - Dependency security audit (`npm audit --audit-level=high`).
2. **Stage 2 (`build-scan-push`):**
   - Multi-stage Docker builds (`Dockerfile.backend` and `frontend/Dockerfile`).
   - **Aqua Trivy** container image vulnerability scanning (`CRITICAL,HIGH`).
   - Passwordless **GitHub OIDC -> AWS IAM Role assumption** (`aws-actions/configure-aws-credentials@v4`) to push immutable SHA-tagged images to Amazon ECR.
3. **Stage 3 (`deploy-staging`):**
   - Automated Helm upgrade to `hos-staging` with `--atomic` flag.
   - Automated post-deployment `/api/v1/gateway/health` smoke verification.
4. **Stage 4 (`deploy-production`):**
   - Protected by a **GitHub Environment Manual Approval Gate** (`environment: production`) per **Rule 25**.
   - Executes `helm upgrade --install --atomic` and triggers automatic `helm rollback` if any post-deploy check fails.


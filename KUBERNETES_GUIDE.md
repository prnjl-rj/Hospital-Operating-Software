# HOSPITAL OPERATING SOFTWARE (HOS) — KUBERNETES & HELM PRODUCTION GUIDE (`KUBERNETES_GUIDE.md`)

## 1. Kubernetes Architecture (`infrastructure/k8s/hos-production-manifests.yaml`)
The HOS Kubernetes configuration targets **Amazon EKS 1.31** in namespace `hos-prod` with:
- **Zero-Downtime Rolling Updates:** `maxUnavailable: 0, maxSurge: 1` so clinical operations are never interrupted during deployments.
- **High Availability & Autoscaling:** `HorizontalPodAutoscaler` (`minReplicas: 3`, `maxReplicas: 15` on CPU 70% / Memory 75%) and `PodDisruptionBudget` (`minAvailable: 2`).
- **Hardened Pod Security:** `pod-security.kubernetes.io/enforce: restricted` with `runAsNonRoot: true` and `runAsUser: 1001`.
- **Network Segmentation:** `NetworkPolicy` enforcing default-deny ingress from outside `hos-prod`, allowing external traffic only through the AWS ALB Ingress (`hos-alb-ingress`) into `hos-api-gateway`.
- **Health & Observability Probes:** Liveness (`/api/v1/health/live`), Readiness (`/api/v1/gateway/health`), and Prometheus scrape annotations (`prometheus.io/path: "/api/v1/metrics"`).

---

## 2. Helm Chart (`infrastructure/helm/hos-chart/`)
- `Chart.yaml`: Chart v1.0.0 metadata.
- `values.yaml`: Environment-parameterized replica counts, ports, resource limits, and ECR image tags for all 6 backend services + frontend.
- `templates/deployment.yaml`: Parameterized multi-service Kubernetes Deployment generator.

## 3. Rollout & Rollback Commands
```powershell
# Deploy / Upgrade
helm upgrade --install hos-enterprise ./infrastructure/helm/hos-chart -n hos-prod --create-namespace

# Verify Rollout Status
kubectl rollout status deployment/hos-api-gateway -n hos-prod

# Instant Rollback on Failure
helm rollback hos-enterprise 1 -n hos-prod
```


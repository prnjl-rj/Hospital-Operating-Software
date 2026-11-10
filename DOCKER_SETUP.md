# BLOCK 06 — Docker and Local Development Infrastructure (`DOCKER_SETUP.md`)

## 1. Container Topology & Port Mapping

To coexist cleanly with any other workloads on your host machine, the Hospital Operating Software uses isolated container names (`hos-*`), a dedicated internal Docker bridge network (`hos-internal-net`), and dedicated host ports:

| Container Name | Image | Internal Docker DNS | Host Port Mapping | Purpose |
|---|---|---|---|---|
| `hos-postgres` | `postgres:16-alpine` | `postgres:5432` | `localhost:5435` | PostgreSQL 16 with 5 isolated microservice schemas & roles |
| `hos-redis` | `redis:7-alpine` | `redis:6379` | `localhost:6380` | Authenticated Redis 7 for caching, rate limiting & BullMQ |
| `hos-kafka` | `apache/kafka:3.8.0` | `kafka:29092` | `localhost:9094` | Apache Kafka in ZooKeeper-less **KRaft** mode |
| `hos-kafka-ui` | `provectuslabs/kafka-ui:latest` | `kafka-ui:8080` | `http://localhost:8085` | Web UI for Kafka topics, partitions, messages & consumer lag |
| `hos-prometheus` | `prom/prometheus:v2.51.0` | `prometheus:9090` | `http://localhost:9095` | Metrics scraping & alert rule evaluation |
| `hos-alertmanager` | `prom/alertmanager:v0.27.0` | `alertmanager:9093` | `http://localhost:9096` | Alert routing and webhook notifications |
| `hos-grafana` | `grafana/grafana:10.4.0` | `grafana:3000` | `http://localhost:3035` | Provisioned observability dashboards (`admin` / `hos_grafana_dev_pwd`) |
| `hos-api-gateway` | `Dockerfile.backend` | `api-gateway:4000` | `http://localhost:4000` | Multi-stage non-root NestJS API Gateway & Microservices |
| `hos-frontend` | `frontend/Dockerfile` | `frontend:80` | `http://localhost:5175` | Multi-stage Nginx production build of the 13-portal React UI |

---

## 2. Internal Docker DNS Rule

Inside containers on `hos-internal-net`:
- PostgreSQL is reached at `postgres:5432` (never `localhost:5435`).
- Redis is reached at `redis:6379` (never `localhost:6380`).
- Kafka is reached at `kafka:29092` (never `localhost:9094`).
- Prometheus is reached by Grafana at `http://prometheus:9090`.

---

## 3. Commands to Start & Verify Infrastructure

```powershell
# Start all backing & monitoring infrastructure
docker compose up -d

# Check container health & status
docker compose ps

# Start containerized microservices + frontend profile
docker compose --profile full-containers up -d --build
```

